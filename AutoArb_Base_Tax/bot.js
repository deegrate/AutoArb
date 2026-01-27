// -- HANDLE INITIAL SETUP -- //
require("dotenv").config()
require('./helpers/server')

const Big = require('big.js')

const ethers = require("ethers")
const config = require('./config.json')
const { getTokenAndContract, getPoolContract, getPoolLiquidity, calculatePrice } = require('./helpers/helpers')
const { provider, uniswap, camelot, arbitrage } = require('./helpers/initialization')
const { simulateSwap } = require('./helpers/taxChecker')

// -- CONFIGURATION VALUES HERE -- //
const PROJECT_SETTINGS = config.PROJECT_SETTINGS
const GAS_CONFIG = config.GAS_CONFIG
const { writeTradeLog } = require('./helpers/logger')

let isExecuting = false

const main = async () => {
  const activePairs = []

  // Loop through all configured pairs
  for (const pairConfig of config.PAIRS) {
    try {
      const pairData = await setupPair(pairConfig)
      if (pairData) {
        activePairs.push(pairData)
      }
    } catch (e) {
      console.error(`Failed to setup pair ${pairConfig.name}:`, e.message)
    }
  }

  if (activePairs.length > 0) {
    console.log(`Starting Polling for ${activePairs.length} pairs...`)
    await startPolling(activePairs)
  } else {
    console.log("No valid pairs to monitor.")
  }
}

const startPolling = async (activePairs) => {
  console.log("Starting Polling Loop (Interval: 2000ms)...\n")
  let lastBlockChecked = await provider.getBlockNumber()

  setInterval(async () => {
    try {
      const currentBlock = await provider.getBlockNumber()
      if (currentBlock <= lastBlockChecked) return

      const fromBlock = lastBlockChecked + 1
      const toBlock = currentBlock

      // Flatten all pool addresses to listen to
      const addresses = []
      // Map address -> pairData for quick lookup
      const addressToPair = {}

      for (const p of activePairs) {
        if (p.uPool.target) {
          addresses.push(p.uPool.target)
          addressToPair[p.uPool.target.toLowerCase()] = p
        }
        if (p.cPool.target) {
          addresses.push(p.cPool.target)
          addressToPair[p.cPool.target.toLowerCase()] = p
        }
      }

      // Topics: V3 Swap OR V2 Swap
      // Uniswap V3 Swap Signature
      const v3SwapTopic = ethers.id("Swap(address,address,int256,int256,uint160,uint128,int24)")
      // Camelot/Aerodrome V2/V3 Swap Signature (Standard V2 is distinct, but let's check ABI)
      // Actually, if we just listen to ALL events from these addresses, we can filter by topic if needed.
      // But getLogs is more efficient with topics.
      // Let's use the two known signatures.
      const v2SwapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)")

      const logs = await provider.getLogs({
        address: addresses,
        topics: [[v3SwapTopic, v2SwapTopic]],
        fromBlock,
        toBlock
      })

      // Use a Set to avoid processing the same pair multiple times per block if multiple swaps occur
      // This "debounces" the checkPrice call for that block
      const processedPairs = new Set()

      for (const log of logs) {
        const pairInfo = addressToPair[log.address.toLowerCase()]
        if (pairInfo) {
          if (!processedPairs.has(pairInfo.pairConfig.name)) {
            processedPairs.add(pairInfo.pairConfig.name)

            // Trigger Logic
            await eventHandler(
              pairInfo.uPool,
              pairInfo.cPool,
              pairInfo.baseToken,
              pairInfo.quoteToken,
              pairInfo.pairConfig
            )
          }
        }
      }

      lastBlockChecked = toBlock

    } catch (error) {
      console.error("Polling Error:", error.message)
      // If filter not found, this loop naturally retries next time completely stateless
    }
  }, 2000)
}

const setupPair = async (pairConfig) => {
  const {
    baseToken: baseAddress,
    quoteToken: quoteAddress,
    uniswapPoolFee,
    aerodromePoolFee,
    name
  } = pairConfig

  // Backwards compatibility if config still uses camelotPoolFee
  const cFee = aerodromePoolFee || pairConfig.camelotPoolFee

  const { token0, token1 } = await getTokenAndContract(baseAddress, quoteAddress, provider)

  // Identify Base (e.g. WETH) and Quote (e.g. wstETH) tokens based on config addresses
  let baseToken, quoteToken

  // We compare addresses case-insensitive
  if (token0.address.toLowerCase() === baseAddress.toLowerCase()) {
    baseToken = token0
    quoteToken = token1
  } else {
    baseToken = token1
    quoteToken = token0
  }

  // console.log(`Setting up pair: ${name}`)
  // console.log(`Base: ${baseToken.symbol} (${baseToken.address})`)
  // console.log(`Quote: ${quoteToken.symbol} (${quoteToken.address})\n`)

  const uPool = await getPoolContract(uniswap, token0.address, token1.address, uniswapPoolFee, provider)
  const cPool = await getPoolContract(camelot, token0.address, token1.address, cFee, provider)

  console.log(`Using Pair: ${name} (${baseToken.symbol}/${quoteToken.symbol})`)
  console.log(`Uniswap Pool Address: ${uPool.target}`)
  console.log(`Aerodrome Pool Address: ${cPool.target}\n`)

  if (uPool.target === ethers.ZeroAddress || cPool.target === ethers.ZeroAddress) {
    console.warn(`WARNING: One of the pools is missing (0x000...). Skipping ${name}.\n`)
    return null
  }

  // Return the pair objects instead of setting up listeners
  return {
    uPool,
    cPool,
    baseToken,
    quoteToken,
    pairConfig
  }
}

const eventHandler = async (_uPool, _cPool, _baseToken, _quoteToken, _pairConfig) => {
  if (!isExecuting) {
    isExecuting = true

    const priceData = await checkPrice([_uPool, _cPool], _baseToken, _quoteToken)
    const exchangePath = await determineDirection(priceData.priceDifference)

    if (!exchangePath) {
      console.log(`No Arbitrage Currently Available [${_pairConfig.name}]\n`)
      console.log(`-----------------------------------------\n`)
      isExecuting = false
      return
    }

    const { isProfitable, amount, taxPct, netProfitBase, gasParams } = await determineProfitability(exchangePath, _baseToken, _quoteToken, _pairConfig, GAS_CONFIG, priceData)

    // Log to CSV regardless of profitability to show "scanned" items
    const logData = {
      timestamp: new Date().toISOString(),
      pair: _pairConfig.name,
      direction: `${exchangePath[0].name} -> ${exchangePath[1].name}`,
      uniswapPrice: priceData.uPrice,
      camelotPrice: priceData.cPrice,
      priceDiffPct: priceData.priceDifference,
      tradeAmountBase: ethers.formatUnits(amount > 0 ? amount : 0, _baseToken.decimals), // Approximate or 0
      grossProfitBase: "0", // Filled inside determineProfitability if successful, but here generic
      gasCostEth: "0",
      netProfitBase: netProfitBase || "0",
      taxPct: taxPct || "0",
      profitable: isProfitable
    }

    // We only log if we actually attempted a calculation (which determineProfitability does)
    // But determineProfitability is complex. Let's move writeTradeLog call inside determineProfitability?
    // No, cleaner to keep it here, but we need more data returned.
    // Actually, let's just log if profitable OR if we have significant tax info.
    // User wants to see "avoided" trades.
    writeTradeLog(logData)

    if (!isProfitable) {
      console.log(`No Arbitrage Currently Available [${_pairConfig.name}]\n`)
      console.log(`-----------------------------------------\n`)
      isExecuting = false
      return
    }

    if (PROJECT_SETTINGS.isDeployed) {
      const receipt = await executeTrade(exchangePath, _baseToken, _quoteToken, amount, _pairConfig, gasParams)
    } else {
      console.log("--- MONITOR MODE: Trade would execute here (Contract not deployed) ---\n")
    }

    isExecuting = false

    console.log("\nWaiting for swap event...\n")
  }
}

const checkPrice = async (_pools, _baseToken, _quoteToken) => {
  console.log(`Swap Detected, Checking Price...\n`)

  const currentBlock = await provider.getBlockNumber()

  const uPrice = await calculatePrice(_pools[0], _baseToken, _quoteToken)
  const cPrice = await calculatePrice(_pools[1], _baseToken, _quoteToken)

  const uFPrice = Number(uPrice).toFixed(PROJECT_SETTINGS.PRICE_UNITS)
  const cFPrice = Number(cPrice).toFixed(PROJECT_SETTINGS.PRICE_UNITS)
  const priceDifference = (((uFPrice - cFPrice) / cFPrice) * 100).toFixed(2)

  console.log(`Current Block: ${currentBlock}`)
  console.log(`-----------------------------------------`)
  console.log(`UNISWAP     | ${_baseToken.symbol}/${_quoteToken.symbol}\t | ${uFPrice}`)
  console.log(`AERODROME   | ${_baseToken.symbol}/${_quoteToken.symbol}\t | ${cFPrice}\n`)
  console.log(`Percentage Difference: ${priceDifference}%\n`)

  return {
    priceDifference,
    uPrice: uFPrice,
    cPrice: cFPrice
  }
}

const determineDirection = async (_priceDifference) => {
  console.log(`Determining Direction (Logging All Spreads)...\n`)

  if (_priceDifference > 0) {
    // Price Diff = (Uniswap - Aerodrome) / Aerodrome
    // If > 0, Uniswap Price > Aerodrome Price

    console.log(`Potential Arbitrage Direction:\n`)
    console.log(`Sell Base on\t -->\t ${uniswap.name} (Price: Higher)`)
    console.log(`Buy Base on\t -->\t ${camelot.name} (Price: Lower)\n`)
    return [uniswap, camelot]

  } else if (_priceDifference < 0) {
    // Price Diff < 0, Uniswap < Aerodrome

    console.log(`Potential Arbitrage Direction:\n`)
    console.log(`Sell Base on\t -->\t ${camelot.name} (Price: Higher)`)
    console.log(`Buy Base on\t -->\t ${uniswap.name} (Price: Lower)\n`)
    return [camelot, uniswap]

  } else {
    return null
  }
}

const calculateGasBid = async (profitPct) => {
  try {
    const feeHistory = await provider.send("eth_feeHistory", ["0x5", "latest", [25, 50, 90]])
    const baseFeeHex = feeHistory.baseFeePerGas[feeHistory.baseFeePerGas.length - 1]
    const baseFee = BigInt(baseFeeHex)

    const latestRewards = feeHistory.reward[feeHistory.reward.length - 1]
    const p50 = BigInt(latestRewards[1])
    const p90 = BigInt(latestRewards[2])

    let priorityTip
    let bidType = "Standard"

    if (Math.abs(parseFloat(profitPct)) > 5.0) {
      priorityTip = p90 * 110n / 100n
      bidType = "Aggressive (90th+)"
    } else {
      priorityTip = p50
      bidType = "Standard (50th)"
    }

    const maxFeePerGas = (baseFee * 2n) + priorityTip

    return {
      maxFeePerGas,
      maxPriorityFeePerGas: priorityTip,
      baseFee,
      bidType
    }

  } catch (e) {
    console.error("Error calculating Gas Bid:", e.message)
    const feeData = await provider.getFeeData()
    return {
      maxFeePerGas: feeData.gasPrice * 2n,
      maxPriorityFeePerGas: feeData.gasPrice,
      baseFee: feeData.gasPrice,
      bidType: "Fallback"
    }
  }
}

const determineProfitability = async (_exchangePath, _baseToken, _quoteToken, _pairConfig, _gasConfig, _priceData) => {
  console.log(`Determining Profitability...\n`)

  try {
    let fee = _pairConfig.uniswapPoolFee
    if (_exchangePath[0].name === "Aerodrome V2") {
      fee = _pairConfig.aerodromePoolFee || _pairConfig.camelotPoolFee
    }

    const currentSpreadPct = parseFloat(_priceData.priceDifference)

    const liquidity = await getPoolLiquidity(_exchangePath[0], _baseToken, _quoteToken, fee, provider)
    const liquidityBN = Big(liquidity[0])

    const reserveBasedLimit = liquidityBN.mul(0.02)

    let maxBaseAmountBN = Big("1000000000000000000000000")
    if (_pairConfig.maxBaseAmount) {
      try {
        maxBaseAmountBN = Big(ethers.parseUnits(_pairConfig.maxBaseAmount, _baseToken.decimals).toString())
      } catch (e) {
        console.error("Error parsing maxBaseAmount", e)
      }
    }

    let minAmount = reserveBasedLimit
    if (maxBaseAmountBN.lt(minAmount)) {
      minAmount = maxBaseAmountBN
    }

    console.log(`Liquidity Base: ${liquidityBN.toString()}, 2% Limit: ${reserveBasedLimit.toString()}`)
    console.log(`Max Config Limit: ${maxBaseAmountBN.toString()}`)
    console.log(`Selected Trade Amount: ${minAmount.toString()}\n`)

    const amountInBigInt = BigInt(minAmount.round().toFixed(0))

    let spotPrice
    if (_exchangePath[0].name === "Uniswap V3") {
      spotPrice = parseFloat(_priceData.uPrice)
    } else {
      spotPrice = parseFloat(_priceData.cPrice)
    }

    const quoteTokenReturned = await simulateSwap(
      _exchangePath[0],
      _baseToken,
      _quoteToken,
      amountInBigInt,
      config.PROJECT_SETTINGS.ARBITRAGE_ADDRESS,
      fee
    )

    let taxPct = "0"

    if (!quoteTokenReturned) {
      console.log("Simulation Failed (Step 1: Sell). Possible Honeypot or revert. Skipping.")
      return { isProfitable: false, amount: 0, taxPct: "HONEYPOT", netProfitBase: "0" }
    } else {
      const amountInFloat = parseFloat(ethers.formatUnits(amountInBigInt, _baseToken.decimals))
      const expectedQuoteFloat = amountInFloat * spotPrice
      const actualQuoteFloat = parseFloat(ethers.formatUnits(quoteTokenReturned, _quoteToken.decimals))

      if (expectedQuoteFloat > 0) {
        const tax = (expectedQuoteFloat - actualQuoteFloat) / expectedQuoteFloat * 100
        taxPct = tax.toFixed(2)
        console.log(`[TAX CHECK] Spot Expected: ${expectedQuoteFloat.toFixed(4)} | Actual: ${actualQuoteFloat.toFixed(4)} | Tax: ${taxPct}%`)
      }
    }

    let fee2 = _pairConfig.uniswapPoolFee
    if (_exchangePath[1].name === "Aerodrome V2") {
      fee2 = _pairConfig.aerodromePoolFee || _pairConfig.camelotPoolFee
    }

    const baseTokenReturned = await simulateSwap(
      _exchangePath[1],
      _quoteToken,
      _baseToken,
      quoteTokenReturned,
      config.PROJECT_SETTINGS.ARBITRAGE_ADDRESS,
      fee2
    )

    if (!baseTokenReturned) {
      console.log("Simulation Failed (Step 2: Buy). Possible Honeypot or revert. Skipping.")
      return { isProfitable: false, amount: 0, taxPct: taxPct, netProfitBase: "0" }
    }

    const amountOutWei = baseTokenReturned
    const amountInWei = amountInBigInt

    const grossProfitWei = amountOutWei - amountInWei

    const amountInFmt = ethers.formatUnits(amountInWei, _baseToken.decimals)
    const amountOutFmt = ethers.formatUnits(amountOutWei, _baseToken.decimals)
    const profitFmt = ethers.formatUnits(grossProfitWei, _baseToken.decimals)

    console.log(`SIMULATION RESULTS:`)
    console.log(`In:  ${amountInFmt} ${_baseToken.symbol}`)
    console.log(`Out: ${amountOutFmt} ${_baseToken.symbol}`)
    console.log(`Net: ${profitFmt} ${_baseToken.symbol}`)

    // -- DYNAMIC EIP-1559 GAS CALCULATION --
    const gasBid = await calculateGasBid(currentSpreadPct)

    const estimatedRealGasPrice = gasBid.baseFee + gasBid.maxPriorityFeePerGas
    const estimatedGasLimit = BigInt(_gasConfig.GAS_LIMIT)
    const totalGasCostWei = estimatedGasLimit * estimatedRealGasPrice

    let gasCostInBaseWei = totalGasCostWei

    if (_baseToken.symbol !== "WETH" && _baseToken.symbol !== "ETH") {
      const priceEthPerBase = parseFloat(_priceData.uPrice)
      if (priceEthPerBase > 0) {
        const gasInEthFloat = parseFloat(ethers.formatUnits(totalGasCostWei, 18))
        const gasInBaseFloat = gasInEthFloat / priceEthPerBase
        gasCostInBaseWei = ethers.parseUnits(gasInBaseFloat.toFixed(_baseToken.decimals), _baseToken.decimals)
      }
    }

    const netProfitWei = grossProfitWei - gasCostInBaseWei
    const netProfitBase = ethers.formatUnits(netProfitWei, _baseToken.decimals)
    const gasCostFmt = ethers.formatUnits(gasCostInBaseWei, _baseToken.decimals)

    console.log(`Gas Strategy: ${gasBid.bidType}`)
    console.log(`Gas Bid: MaxFee ${ethers.formatUnits(gasBid.maxFeePerGas, "gwei")} Gwei | Tip ${ethers.formatUnits(gasBid.maxPriorityFeePerGas, "gwei")} Gwei`)
    console.log(`Est. Gas Cost: ${gasCostFmt} ${_baseToken.symbol}`)
    console.log(`-----------------------------------------`)
    console.log(`Net Profit: ${netProfitBase} ${_baseToken.symbol}`)
    console.log(`-----------------------------------------\n`)

    if (gasCostInBaseWei * 2n > grossProfitWei) {
      console.log(`[GAS GUARD] Gas Cost (${gasCostFmt}) exceeds 50% of Gross Profit (${profitFmt}). Skipping.`)
      return { isProfitable: false, amount: 0, taxPct: taxPct, netProfitBase: netProfitBase }
    }

    if (netProfitWei > 0) {
      return {
        isProfitable: true,
        amount: amountInWei,
        taxPct: taxPct,
        netProfitBase: netProfitBase,
        gasParams: {
          maxFeePerGas: gasBid.maxFeePerGas,
          maxPriorityFeePerGas: gasBid.maxPriorityFeePerGas
        }
      }
    } else {
      return { isProfitable: false, amount: 0, taxPct: taxPct, netProfitBase: netProfitBase }
    }

  } catch (error) {
    console.error("Error in determineProfitability", error)
    return { isProfitable: false, amount: 0, taxPct: "ERROR", netProfitBase: "0" }
  }
}

const executeTrade = async (_exchangePath, _baseToken, _quoteToken, _amount, _pairConfig, _gasParams) => {
  console.log(`Attempting Arbitrage...\n`)

  let routerPath = [
    await _exchangePath[0].router.getAddress(),
    await _exchangePath[1].router.getAddress()
  ]

  let tokenPath = [
    _baseToken.address,
    _quoteToken.address
  ]

  const account = new ethers.Wallet(process.env.PRIVATE_KEY, provider)

  // Approvals
  await _baseToken.contract.connect(account).approve(routerPath[0], _amount)
  await _quoteToken.contract.connect(account).approve(routerPath[1], _amount) // Note: _amount might be approximate for 2nd leg

  const tokenBalanceBefore = await _baseToken.contract.balanceOf(account.address)
  const ethBalanceBefore = await provider.getBalance(account.address)

  const isCamelot = [
    _exchangePath[0].name === "Camelot V3",
    _exchangePath[1].name === "Camelot V3"
  ]

  if (PROJECT_SETTINGS.isDeployed) {
    try {
      const transaction = await arbitrage.connect(account).executeTrade(
        routerPath,
        tokenPath,
        isCamelot,
        _pairConfig.uniswapPoolFee,
        _amount,
        {
          maxFeePerGas: _gasParams ? _gasParams.maxFeePerGas : undefined,
          maxPriorityFeePerGas: _gasParams ? _gasParams.maxPriorityFeePerGas : undefined,
          type: 2
        }
      )

      await transaction.wait(0)
    } catch (e) {
      console.error("Trade Execution Failed:", e)
    }
  }

  console.log(`Trade Complete:\n`)

  const tokenBalanceAfter = await _baseToken.contract.balanceOf(account.address)
  const ethBalanceAfter = await provider.getBalance(account.address)

  const tokenBalanceDifference = tokenBalanceAfter - tokenBalanceBefore
  const ethBalanceDifference = ethBalanceBefore - ethBalanceAfter

  const data = {
    'ETH Balance Before': ethers.formatUnits(ethBalanceBefore, 18),
    'ETH Balance After': ethers.formatUnits(ethBalanceAfter, 18),
    'ETH Spent (gas)': ethers.formatUnits(ethBalanceDifference.toString(), 18),
    '-': {},
    'Base Token Balance BEFORE': ethers.formatUnits(tokenBalanceBefore, _baseToken.decimals),
    'Base Token Balance AFTER': ethers.formatUnits(tokenBalanceAfter, _baseToken.decimals),
    'Base Token Gained/Lost': ethers.formatUnits(tokenBalanceDifference.toString(), _baseToken.decimals),
    '-': {},
    'Total Gained/Lost': `${ethers.formatUnits((tokenBalanceDifference - ethBalanceDifference).toString(), _baseToken.decimals)}`
  }

  console.table(data)
}

main()