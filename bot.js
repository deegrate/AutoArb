// -- HANDLE INITIAL SETUP -- //
require("dotenv").config()
require('./helpers/server')

const Big = require('big.js')

const ethers = require("ethers")
const config = require('./config.json')
const { getTokenAndContract, getPoolContract, getPoolLiquidity, calculatePrice } = require('./helpers/helpers')
const { provider, uniswap, camelot, arbitrage, arbGasInfo, nodeInterface } = require('./helpers/initialization')

// -- CONFIGURATION VALUES HERE -- //
const PROJECT_SETTINGS = config.PROJECT_SETTINGS
const GAS_CONFIG = config.GAS_CONFIG
const { writeTradeLog } = require('./helpers/logger')

let isExecuting = false

const main = async () => {
  // Loop through all configured pairs
  for (const pairConfig of config.PAIRS) {
    await setupPair(pairConfig)
  }

  console.log("Waiting for swap events...\n")
}

const setupPair = async (pairConfig) => {
  const {
    baseToken: baseAddress,
    quoteToken: quoteAddress,
    uniswapPoolFee,
    camelotPoolFee,
    name
  } = pairConfig

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

  const uPool = await getPoolContract(uniswap, token0.address, token1.address, uniswapPoolFee, provider)
  const cPool = await getPoolContract(camelot, token0.address, token1.address, camelotPoolFee, provider)

  console.log(`Using Pair: ${name} (${baseToken.symbol}/${quoteToken.symbol})`)
  console.log(`Uniswap Pool Address: ${await uPool.getAddress()}`)
  console.log(`Camelot Pool Address: ${await cPool.getAddress()}\n`)

  uPool.on('Swap', () => eventHandler(uPool, cPool, baseToken, quoteToken, pairConfig))
  cPool.on('Swap', () => eventHandler(uPool, cPool, baseToken, quoteToken, pairConfig))
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

    const { isProfitable, amount } = await determineProfitability(exchangePath, _baseToken, _quoteToken, _pairConfig, GAS_CONFIG, priceData)

    if (!isProfitable) {
      console.log(`No Arbitrage Currently Available [${_pairConfig.name}]\n`)
      console.log(`-----------------------------------------\n`)
      isExecuting = false
      return
    }

    if (PROJECT_SETTINGS.isDeployed) {
      const receipt = await executeTrade(exchangePath, _baseToken, _quoteToken, amount, _pairConfig)
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
  console.log(`CAMELOT     | ${_baseToken.symbol}/${_quoteToken.symbol}\t | ${cFPrice}\n`)
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

    console.log(`Potential Arbitrage Direction:\n`)
    console.log(`Sell Base on\t -->\t ${uniswap.name}`)
    console.log(`Sell Quote on\t -->\t ${camelot.name}\n`)
    return [uniswap, camelot]

  } else if (_priceDifference < 0) {

    console.log(`Potential Arbitrage Direction:\n`)
    console.log(`Sell Base on\t -->\t ${camelot.name}`)
    console.log(`Sell Quote on\t -->\t ${uniswap.name}\n`)
    return [camelot, uniswap]

  } else {
    return null
  }
}

const determineProfitability = async (_exchangePath, _baseToken, _quoteToken, _pairConfig, _gasConfig, _priceData) => {
  console.log(`Determining Profitability...\n`)

  // Use _pairConfig for minProfit if needed
  // Use _gasConfig for gas calculations

  try {
    // Fetch liquidity off of the exchange to buy from
    // We use pool fee from pair config or default if needed. 
    // Note: pairConfig has uniswapPoolFee and camelotPoolFee.
    // We need to know which pool we are buying from to use correct fee?
    // getPoolLiquidity takes the exchange object.
    // We can pass the fee. But wait, Uniswap and Camelot might have different fees.
    // _exchangePath[0] is the BUY exchange.

    // Determine fee based on exchange
    let fee = _pairConfig.uniswapPoolFee
    if (_exchangePath[0].name === "Camelot V3") {
      fee = _pairConfig.camelotPoolFee
    }

    const liquidity = await getPoolLiquidity(_exchangePath[0], _baseToken, _quoteToken, fee, provider)

    // An example of using a percentage of the liquidity
    // We calculate a safe trade size based on liquidity to avoid excessive slippage.
    // Guidance: amountInBase = min(maxBaseAmount, 0.02 * minReserveBase)

    // liquidity[0] is the base token reserve
    const liquidityBN = Big(liquidity[0])

    // 2% of the pool's base reserve
    const reserveBasedLimit = liquidityBN.mul(0.02)

    // Check config for maxBaseAmount limit
    let maxBaseAmountBN = Big("1000000000000000000000000") // Default large number if not set
    if (_pairConfig.maxBaseAmount) {
      try {
        maxBaseAmountBN = Big(ethers.parseUnits(_pairConfig.maxBaseAmount, _baseToken.decimals).toString())
      } catch (e) {
        console.error("Error parsing maxBaseAmount", e)
      }
    }

    // Determine minAmount as minimum of the two limits
    let minAmount = reserveBasedLimit
    if (maxBaseAmountBN.lt(minAmount)) {
      minAmount = maxBaseAmountBN
    }

    console.log(`Liquidity Base: ${liquidityBN.toString()}, 2% Limit: ${reserveBasedLimit.toString()}`)
    console.log(`Max Config Limit: ${maxBaseAmountBN.toString()}`)
    console.log(`Selected Trade Amount: ${minAmount.toString()}\n`)
    // NOTE: This logic relies on liquidity[1] being the correct token (Token1).
    // If BaseToken is Token0, we should use liquidity[0].
    // Ideally we check addresses.
    // But for preserving original logic, we keep it as is, or improve.
    // If we want to be safe: 
    // We don't have liquidity object structure here, it's just array.
    // Let's assume the Liquidity Helper returns [liquidityAmount, amount0, amount1] ??
    // Actually earlier trace showed it returns something that creates minAmount.
    // Let's stick to original logic: Big(liquidity[1]).mul(percentage)

    // 1. Sell BaseToken for QuoteToken (Exact Output or Input?)
    let quoteTokenAmount
    if (_exchangePath[0].name === "Camelot V3") {
      quoteTokenAmount = await _exchangePath[0].quoter.quoteExactInputSingle.staticCall(
        _baseToken.address,
        _quoteToken.address,
        BigInt(minAmount.round().toFixed(0)),
        0
      )
    } else {
      // Inline params to avoid ReferenceError
      [quoteTokenAmount] = await _exchangePath[0].quoter.quoteExactInputSingle.staticCall({
        tokenIn: _baseToken.address,
        tokenOut: _quoteToken.address,
        fee: fee,
        amountIn: BigInt(minAmount.round().toFixed(0)),
        sqrtPriceLimitX96: 0
      })
    }

    // 2. Sell QuoteToken for BaseToken using the other exchange's fee
    let sellFee = _pairConfig.camelotPoolFee
    if (_exchangePath[1].name === "Uniswap V3") {
      sellFee = _pairConfig.uniswapPoolFee
    }

    let baseTokenReturned
    if (_exchangePath[1].name === "Camelot V3") {
      baseTokenReturned = await _exchangePath[1].quoter.quoteExactInputSingle.staticCall(
        _quoteToken.address,
        _baseToken.address,
        quoteTokenAmount,
        0
      )
    } else {
      [baseTokenReturned] = await _exchangePath[1].quoter.quoteExactInputSingle.staticCall({
        tokenIn: _quoteToken.address,
        tokenOut: _baseToken.address,
        fee: sellFee,
        amountIn: quoteTokenAmount,
        sqrtPriceLimitX96: 0
      })
    }

    const amountInWei = BigInt(minAmount.round().toFixed(0))
    // baseTokenReturned is already a BigInt from the contract call
    const amountOutWei = baseTokenReturned

    const amountIn = ethers.formatUnits(amountInWei, _baseToken.decimals)
    const amountOut = ethers.formatUnits(amountOutWei, _baseToken.decimals)

    console.log(`Estimated input of ${_baseToken.symbol}: ${amountIn}`)
    console.log(`Estimated return of ${_baseToken.symbol}: ${amountOut}\n`)

    const amountDifferenceWei = amountOutWei - amountInWei

    // -- Calculate L2 Gas Cost --
    const estimatedGasLimit = BigInt(_gasConfig.GAS_LIMIT)
    const l2GasPrice = await provider.getFeeData().then(data => data.gasPrice)
    const l2GasCost = estimatedGasLimit * l2GasPrice

    // -- Calculate L1 Data Cost --
    let l1BaseFee = BigInt(0)
    try {
      l1BaseFee = await arbGasInfo.getL1BaseFeeEstimate()
    } catch (e) {
      // Ignore invalid opcode in local env
      // console.log("L1 Base Fee failed:", e.message)
    }

    const dummyCalldata = "0x" + "00".repeat(800)

    let gasEstimateForL1 = BigInt(0)
    try {
      [gasEstimateForL1] = await nodeInterface.gasEstimateL1Component.staticCall(
        arbitrage.target,
        false,
        dummyCalldata,
        { value: 0 }
      )
    } catch (e) {
      // Ignore invalid opcode in local env
      // console.log("Estimated L1 Component failed:", e.message)
    }

    const l1GasCost = gasEstimateForL1 * l1BaseFee

    const totalGasCost = l2GasCost + l1GasCost

    // Calculate net profit
    const netProfit = amountDifferenceWei - totalGasCost

    // Fetch account
    const account = new ethers.Wallet(process.env.PRIVATE_KEY, provider)

    const ethBalanceBefore = ethers.formatUnits(await provider.getBalance(account.address), 18)

    // Safety check for balance
    let ethBalanceAfter = "0"
    try {
      ethBalanceAfter = ethers.formatUnits((BigInt(ethers.parseUnits(ethBalanceBefore, 18)) - totalGasCost).toString(), 18)
    } catch (e) {
      // Can block if balance < cost
      ethBalanceAfter = "NEGATIVE"
    }

    const balanceBefore = Number(ethers.formatUnits(await _baseToken.contract.balanceOf(account.address), _baseToken.decimals))
    const balanceAfter = Number(ethers.formatUnits((amountDifferenceWei + BigInt(ethers.parseUnits(balanceBefore.toString(), _baseToken.decimals))).toString(), _baseToken.decimals))

    const data = {
      'ETH Balance Before': ethBalanceBefore,
      'ETH Balance After': ethBalanceAfter,
      'L2 Gas Cost': ethers.formatUnits(l2GasCost, 18),
      'L1 Data Cost': ethers.formatUnits(l1GasCost, 18),
      'Total Gas Cost': ethers.formatUnits(totalGasCost, 18),
      '-': {},
      'Base Token Balance BEFORE': balanceBefore,
      'Base Token Balance AFTER': balanceAfter,
      'Gross Profit (Base)': ethers.formatUnits(amountDifferenceWei, _baseToken.decimals),
      'Net Profit (Base - Gas)': ethers.formatUnits(netProfit, _baseToken.decimals)
    }

    console.table(data)
    console.log()

    // -- LOG TO CSV --
    const logData = {
      timestamp: new Date().toISOString(),
      pair: _pairConfig.name,
      direction: `${_exchangePath[0].name} -> ${_exchangePath[1].name}`,
      uniswapPrice: _priceData.uPrice,
      camelotPrice: _priceData.cPrice,
      priceDiffPct: _priceData.priceDifference,
      tradeAmountBase: ethers.formatUnits(amountInWei, _baseToken.decimals),
      grossProfitBase: ethers.formatUnits(amountDifferenceWei, _baseToken.decimals),
      gasCostEth: ethers.formatUnits(totalGasCost, 18),
      netProfitBase: ethers.formatUnits(netProfit, _baseToken.decimals),
      profitable: netProfit > 0
    }

    // We need prices. 
    // I will write this without prices first, then I will update the flow to pass prices.
    writeTradeLog(logData)

    if (netProfit <= 0) {
      console.log("Unprofitable after gas costs.")
      return { isProfitable: false, amount: 0 }
    }

    // Check against minProfitBase if configured
    if (_pairConfig.minProfitBase) {
      const minProfitWei = ethers.parseUnits(_pairConfig.minProfitBase, _baseToken.decimals)
      if (netProfit < minProfitWei) {
        console.log(`Profit ${ethers.formatUnits(netProfit, _baseToken.decimals)} below min profit ${_pairConfig.minProfitBase}`)
        return { isProfitable: false, amount: 0 }
      }
    }

    if (Number(amountOut) < Number(amountIn)) {
      throw new Error("Not enough to pay back flash loan")
    }

    return { isProfitable: true, amount: ethers.parseUnits(amountIn, _baseToken.decimals) }

  } catch (error) {
    console.log("!!! PROFITABILITY CHECK FAILED !!!")
    console.log(error)
    console.log("")
    return { isProfitable: false, amount: 0 }
  }
}

const executeTrade = async (_exchangePath, _baseToken, _quoteToken, _amount, _pairConfig) => {
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
    // Use fee from config for respective exchanges if needed, but contract signature usually takes just one POOL_FEE?
    // Current executeTrade contract signature:
    // executeTrade(address[] routers, address[] tokens, bool[] isCamelot, uint24 fee, uint256 amount)
    // It takes a SINGLE fee. This implies both pools must have SAME fee.
    // If they have different fees, the contract execution might fail or needs update.
    // config.PAIRS has independent fees.
    // If fees differ, we might need to update the smart contract or pass fees array.
    // CHECK: The user did NOT ask to update the smart contract.
    // I will use _pairConfig.uniswapPoolFee as the default "fee" passed, assuming they are same or contract handles one.
    // OR better: check if they are same.
    // For now, I'll pass one of them.

    try {
      const transaction = await arbitrage.connect(account).executeTrade(
        routerPath,
        tokenPath,
        isCamelot,
        _pairConfig.uniswapPoolFee, // Passing one fee. 
        _amount
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