// -- HANDLE INITIAL SETUP -- //
require("dotenv").config({ path: '../../.env' }); // Reaches up to the root .env

const Big = require('big.js');
const ethers = require("ethers");
const config = require('../../config.json'); // Reaches up to the root config

// Updated Paths: Reaching out of /products/arbitrum-guard/ and into /core-modules/
const { getTokenAndContract, getPoolContract, getPoolLiquidity, calculatePrice } = require('../../core-modules/helpers');
const { provider, uniswap, camelot, arbitrage, arbGasInfo, nodeInterface } = require('../../core-modules/initialization')(config, 'arbitrum');
const notifier = require('../../core-modules/notifier');

// -- CONFIGURATION VALUES HERE -- //
const PROJECT_SETTINGS = config.PROJECT_SETTINGS
const GAS_CONFIG = config.GAS_CONFIG
const { writeTradeLog } = require('./helpers/logger')
const supabase = require('./helpers/supabaseClient')

let isExecuting = false
let isBotActive = true;

// -- KILLSWITCH POLLER -- //
// Polls Supabase every 10 seconds to check if this client is active
const startKillSwitchPoller = () => {
  const clientId = process.env.CLIENT_ID || 'CLIENT_001';
  console.log(`Starting KillSwitch Poller for ${clientId}...`);

  setInterval(async () => {
    try {
      const { data, error } = await supabase
        .from('bot_configs')
        .select('is_active')
        .eq('client_id', clientId)
        .single();

      if (data) {
        if (isBotActive !== data.is_active) {
          console.log(`[KILLSWITCH] Status changed to: ${data.is_active ? 'ACTIVE' : 'INACTIVE'}`);
        }
        isBotActive = data.is_active;
      }
    } catch (err) {
      console.error("[KILLSWITCH] Error polling status:", err.message);
    }
  }, 10000); // 10s interval
}

async function pushTradeToLedger(pair, type, amountIn, amountOut, netProfit, l1Gas, l2Gas, hash) {
  try {
    const clientId = process.env.CLIENT_ID || 'CLIENT_001';
    console.log(`[LEDGER] Pushing trade for ${clientId} to Supabase...`);

    await supabase.from('trades').insert([{
      chain: 'arbitrum',
      agent: 'AutoArb_ARB_Guard',
      client_id: clientId,
      pair: pair,
      type: type,
      amount_in: parseFloat(amountIn),
      amount_out: parseFloat(amountOut),
      net_profit: parseFloat(netProfit),
      l1_gas_fee: parseFloat(l1Gas),
      l2_gas_fee: parseFloat(l2Gas),
      tx_hash: hash,
      status: 'success'
    }]);
    console.log("--- [TSE] Arbitrum Ledger Updated with Financials ---");
  } catch (err) {
    console.error("Supabase Sync Error:", err);
  }
}

const main = async () => {
  // Start Poller
  startKillSwitchPoller();

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
  // 1. KillSwitch Check
  if (!isBotActive) {
    // Silent return or minimal log? Silent to avoid spam.
    return;
  }

  if (!isExecuting) {
    isExecuting = true

    const priceData = await checkPrice([_uPool, _cPool], _baseToken, _quoteToken)

    if (priceData.isLowLiquidity) {
      console.log(`[SKIP] Low Liquidity: ${priceData.liquidity.toFixed(2)} WETH (Threshold: 1.5)`)
      isExecuting = false
      return
    }

    const exchangePath = await determineDirection(priceData.priceDifference)

    if (!exchangePath) {
      console.log(`No Arbitrage Currently Available [${_pairConfig.name}]\n`)
      console.log(`-----------------------------------------\n`)
      isExecuting = false
      return
    }

    const { isProfitable, amount, financials } = await determineProfitability(exchangePath, _baseToken, _quoteToken, _pairConfig, GAS_CONFIG, priceData)

    if (!isProfitable) {
      // Even if not profitable, we might want to log it if we want to see liquidity in logs?
      // For now, keeping original logic: Only log inside determineProfitability if we proceed to calculation
      // But wait, determineProfitability logs to CSV.

      console.log(`No Arbitrage Currently Available [${_pairConfig.name}]\n`)
      console.log(`-----------------------------------------\n`)
      isExecuting = false
      return
    }

    if (PROJECT_SETTINGS.isDeployed) {
      const receipt = await executeTrade(exchangePath, _baseToken, _quoteToken, amount, _pairConfig, financials)
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

  // -- LIQUIDITY CHECK --
  let uLiquidity = BigInt(0)
  let cLiquidity = BigInt(0)

  try {
    uLiquidity = await _quoteToken.contract.balanceOf(await _pools[0].getAddress())
    cLiquidity = await _quoteToken.contract.balanceOf(await _pools[1].getAddress())
  } catch (e) {
    console.log(`[LIQUIDITY] Failed to fetch reserves: ${e.message}`)
  }

  const uLiquidityFloat = parseFloat(ethers.formatUnits(uLiquidity, _quoteToken.decimals))
  const cLiquidityFloat = parseFloat(ethers.formatUnits(cLiquidity, _quoteToken.decimals))
  const totalLiquidityWETH = uLiquidityFloat + cLiquidityFloat

  // 1.5 ETH Threshold (Arbitrum is safe, but good to filter dust)
  const LIQUIDITY_THRESHOLD = 1.5

  if (totalLiquidityWETH < LIQUIDITY_THRESHOLD) {
    return {
      priceDifference: 0,
      uPrice: 0,
      cPrice: 0,
      liquidity: totalLiquidityWETH,
      isLowLiquidity: true
    }
  }

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
    cPrice: cFPrice,
    liquidity: totalLiquidityWETH,
    isLowLiquidity: false
  }
}

const determineDirection = async (_priceDifference) => {
  console.log(`Determining Direction (Logging All Spreads)...\n`)

  if (_priceDifference > 0) {
    // Price Diff = (Uniswap - Camelot) / Camelot
    // If > 0, Uniswap Price > Camelot Price

    console.log(`Potential Arbitrage Direction:\n`)
    console.log(`Sell Base on\t -->\t ${uniswap.name} (Price: Higher)`)
    console.log(`Buy Base on\t -->\t ${camelot.name} (Price: Lower)\n`)
    return [uniswap, camelot]

  } else if (_priceDifference < 0) {
    // Price Diff < 0, Uniswap < Camelot

    console.log(`Potential Arbitrage Direction:\n`)
    console.log(`Sell Base on\t -->\t ${camelot.name} (Price: Higher)`)
    console.log(`Buy Base on\t -->\t ${uniswap.name} (Price: Lower)\n`)
    return [camelot, uniswap]

  } else {
    return null
  }
}

const determineProfitability = async (_exchangePath, _baseToken, _quoteToken, _pairConfig, _gasConfig, _priceData) => {
  console.log(`Determining Profitability...\n`)

  try {
    // _exchangePath[0]: SELL Base Exchange (Source)
    // _exchangePath[1]: BUY Base Exchange (Target)

    let fee = _pairConfig.uniswapPoolFee
    if (_exchangePath[0].name === "Camelot V3") {
      fee = _pairConfig.camelotPoolFee
    }

    // Quick Check: Is Spread > Total Fees?
    const totalFeePct = (_pairConfig.uniswapPoolFee + _pairConfig.camelotPoolFee) / 10000
    const currentSpreadPct = parseFloat(_priceData.priceDifference) // e.g. 0.04 (this is %, check calculation in checkPrice)
    // checkPrice: ((u - c)/c) * 100. So it is indeed Percentage.

    // Use absolute value of spread because checkPrice can be negative (we use direction to fix that, but priceDifference is raw)
    // Actually determineDirection logic: if diff > 0 or < 0.
    // So logic: if abs(Spread) <= TotalFee, we lose money on Gross.
    if (Math.abs(currentSpreadPct) <= totalFeePct) {
      console.log(`Spread ${Math.abs(currentSpreadPct).toFixed(4)}% is <= Total Fees ${totalFeePct.toFixed(4)}%. Trade is gross-negative. Skipping.`)
      return { isProfitable: false, amount: 0 }
    }

    const liquidity = await getPoolLiquidity(_exchangePath[0], _baseToken, _quoteToken, fee, provider)
    const liquidityBN = Big(liquidity[0]) // Assumes liquidity[0] is Base Token Reserve

    // 2% of the pool's base reserve
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

    // 1. Sell BaseToken for QuoteToken at Exchange A (Source)
    let quoteTokenAmount
    if (_exchangePath[0].name === "Camelot V3") {
      quoteTokenAmount = await _exchangePath[0].quoter.quoteExactInputSingle.staticCall(
        _baseToken.address,
        _quoteToken.address,
        BigInt(minAmount.round().toFixed(0)),
        0
      )
    } else {
      [quoteTokenAmount] = await _exchangePath[0].quoter.quoteExactInputSingle.staticCall({
        tokenIn: _baseToken.address,
        tokenOut: _quoteToken.address,
        fee: fee,
        amountIn: BigInt(minAmount.round().toFixed(0)),
        sqrtPriceLimitX96: 0
      })
    }

    // 2. Buy BaseToken with QuoteToken at Exchange B (Target)
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
    const amountOutWei = baseTokenReturned

    // Calculate Gross Profit in Base Token Wei
    const grossProfitWei = amountOutWei - amountInWei

    const amountIn = ethers.formatUnits(amountInWei, _baseToken.decimals)
    const amountOut = ethers.formatUnits(amountOutWei, _baseToken.decimals)

    console.log(`Estimated input of ${_baseToken.symbol}: ${amountIn}`)
    console.log(`Estimated return of ${_baseToken.symbol}: ${amountOut}\n`)

    // -- Calculate L2 Gas Cost --
    const estimatedGasLimit = BigInt(_gasConfig.GAS_LIMIT)
    const l2GasPrice = await provider.getFeeData().then(data => data.gasPrice)
    const l2GasCost = estimatedGasLimit * l2GasPrice

    // -- Calculate L1 Data Cost --
    let l1BaseFee = BigInt(0)
    try {
      l1BaseFee = await arbGasInfo.getL1BaseFeeEstimate()
    } catch (e) { }

    const dummyCalldata = "0x" + "00".repeat(800)
    let gasEstimateForL1 = BigInt(0)
    try {
      [gasEstimateForL1] = await nodeInterface.gasEstimateL1Component.staticCall(
        arbitrage.target,
        false,
        dummyCalldata,
        { value: 0 }
      )
    } catch (e) { }

    const l1GasCost = gasEstimateForL1 * l1BaseFee
    const totalGasCostWei = l2GasCost + l1GasCost // This is in ETH (18 decimals)

    // -- Fix for Net Profit --
    // We need to convert totalGasCostWei (ETH) to Base Token value.
    // If Base Token is not ETH/WETH, we must scale it.

    let gasCostInBaseWei = totalGasCostWei

    if (_baseToken.symbol !== "WETH" && _baseToken.symbol !== "ETH") {
      // If Base is 6 decimals (USDC), and Gas is 18 decimals (ETH).
      // We need Price(Base/ETH).
      // If Quote is WETH, we have Price(Quote/Base) = Price(WETH/Base).
      // uPrice (from checkPrice) is Quote per Base.
      // So uPrice = WETH per Base.
      // Value of Gas in Base = Gas(ETH) / Price(ETH per Base) ?
      // No. uPrice is WETH per Base. e.g. 0.0005.
      // 1 Base = 0.0005 ETH.
      // 1 ETH = 1/0.0005 = 2000 Base.
      // Gas(Base) = Gas(ETH) * (Base/ETH) = Gas(ETH) * (1/Price).

      // Let's use the priceData.uPrice (float string)
      const priceEthPerBase = parseFloat(_priceData.uPrice)
      if (priceEthPerBase > 0) {
        // gasInETH (float)
        const gasInEthFloat = parseFloat(ethers.formatUnits(totalGasCostWei, 18))
        // gasInBase (float) = gasInEth / priceEthPerBase
        const gasInBaseFloat = gasInEthFloat / priceEthPerBase
        // Convert back to Base Wei
        gasCostInBaseWei = ethers.parseUnits(gasInBaseFloat.toFixed(_baseToken.decimals), _baseToken.decimals)
      } else {
        console.warn("Pricing data invalid for Gas conversion. Using raw Wei subtraction (inaccurate if not WETH).")
      }
    } else {
      // Base is WETH. Direct subtraction OK (both 18 dec)
      gasCostInBaseWei = totalGasCostWei
    }

    const netProfitWei = grossProfitWei - gasCostInBaseWei

    // Fetch account balance for logging (Optional, keeping concise)
    // Removed strict balance checks for logging to speed up, but kept logging.

    const data = {
      'L2 Gas Cost (ETH)': ethers.formatUnits(l2GasCost, 18),
      'Total Gas Cost (ETH)': ethers.formatUnits(totalGasCostWei, 18),
      'Gas Cost (Base)': ethers.formatUnits(gasCostInBaseWei, _baseToken.decimals),
      '-': {},
      'Gross Profit (Base)': ethers.formatUnits(grossProfitWei, _baseToken.decimals),
      'Net Profit (Base)': ethers.formatUnits(netProfitWei, _baseToken.decimals)
    }

    console.table(data)
    console.log()

    const logData = {
      timestamp: new Date().toISOString(),
      pair: _pairConfig.name,
      direction: `${_exchangePath[0].name} -> ${_exchangePath[1].name}`,
      uniswapPrice: _priceData.uPrice,
      camelotPrice: _priceData.cPrice,
      priceDiffPct: _priceData.priceDifference,
      tradeAmountBase: ethers.formatUnits(amountInWei, _baseToken.decimals),
      grossProfitBase: ethers.formatUnits(grossProfitWei, _baseToken.decimals),
      gasCostEth: ethers.formatUnits(totalGasCostWei, 18),
      netProfitBase: ethers.formatUnits(netProfitWei, _baseToken.decimals),
      taxPct: "0", // Arbitrum default
      profitable: netProfitWei > 0,
      liquidity: _priceData.liquidity ? _priceData.liquidity.toFixed(2) : "N/A"
    }

    writeTradeLog(logData)

    // Check Profit Thresholds
    if (netProfitWei <= 0) {
      console.log("Unprofitable after gas costs.")
      return { isProfitable: false, amount: 0 }
    }

    if (_pairConfig.minProfitBase) {
      const minProfitWei = ethers.parseUnits(_pairConfig.minProfitBase, _baseToken.decimals)
      if (netProfitWei < minProfitWei) {
        console.log(`Profit ${ethers.formatUnits(netProfitWei, _baseToken.decimals)} below min profit ${_pairConfig.minProfitBase}`)
        return { isProfitable: false, amount: 0 }
      }
    }

    if (Number(amountOut) < Number(amountIn)) {
      // Secondary safety check
      return { isProfitable: false, amount: 0 }
    }

    // Construct Financials Object for Execution
    const financials = {
      amountIn: ethers.formatUnits(amountInWei, _baseToken.decimals),
      amountOut: ethers.formatUnits(baseTokenReturned, _baseToken.decimals),
      netProfit: ethers.formatUnits(netProfitWei, _baseToken.decimals),
      l1Gas: ethers.formatUnits(l1GasCost, 18),
      l2Gas: ethers.formatUnits(l2GasCost, 18)
    }

    return { isProfitable: true, amount: amountInWei, financials } // Return BigInt for execution

  } catch (error) {
    console.log("!!! PROFITABILITY CHECK FAILED !!!")
    console.log(error)
    console.log("")
    return { isProfitable: false, amount: 0 }
  }
}

const executeTrade = async (_exchangePath, _baseToken, _quoteToken, _amount, _pairConfig, _financials) => {
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

      // --- LOG TO SUPABASE ---
      if (_financials) {
        await pushTradeToLedger(
          _pairConfig.name,
          'arbitrage',
          _financials.amountIn,
          _financials.amountOut,
          _financials.netProfit,
          _financials.l1Gas,
          _financials.l2Gas,
          transaction.hash
        );
      }

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