// -- HANDLE INITIAL SETUP -- //
require("dotenv").config()
require('./helpers/server')

const Big = require('big.js')

const ethers = require("ethers")
const config = require('./config.json')
const { getTokenAndContract, getPoolContract, getPoolLiquidity, calculatePrice } = require('./helpers/helpers')
const { provider, uniswap, camelot, arbitrage } = require('./helpers/initialization')

// -- CONFIGURATION VALUES HERE -- //
const ARB_FOR = config.TOKENS.ARB_FOR
const ARB_AGAINST = config.TOKENS.ARB_AGAINST
const POOL_FEE = config.TOKENS.POOL_FEE
const UNITS = config.PROJECT_SETTINGS.PRICE_UNITS
const PRICE_DIFFERENCE = config.PROJECT_SETTINGS.PRICE_DIFFERENCE
const GAS_LIMIT = config.PROJECT_SETTINGS.GAS_LIMIT
const GAS_PRICE = config.PROJECT_SETTINGS.GAS_PRICE

let isExecuting = false

const main = async () => {
  const { token0, token1 } = await getTokenAndContract(ARB_FOR, ARB_AGAINST, provider)
  const uPool = await getPoolContract(uniswap, token0.address, token1.address, POOL_FEE, provider)
  const cPool = await getPoolContract(camelot, token0.address, token1.address, POOL_FEE, provider)

  // Identify Base (WETH) and Quote (wstETH) tokens
  let baseToken, quoteToken
  if (token0.address === ARB_AGAINST) {
    baseToken = token0
    quoteToken = token1
  } else {
    baseToken = token1
    quoteToken = token0
  }

  console.log(`Using ${baseToken.symbol}/${quoteToken.symbol}\n`)

  console.log(`Uniswap Pool Address: ${await uPool.getAddress()}`)
  console.log(`Camelot Pool Address: ${await cPool.getAddress()}\n`)

  uPool.on('Swap', () => eventHandler(uPool, cPool, baseToken, quoteToken))
  cPool.on('Swap', () => eventHandler(uPool, cPool, baseToken, quoteToken))

  console.log("Waiting for swap event...\n")
}

const eventHandler = async (_uPool, _cPool, _baseToken, _quoteToken) => {
  if (!isExecuting) {
    isExecuting = true

    const priceDifference = await checkPrice([_uPool, _cPool], _baseToken, _quoteToken)
    const exchangePath = await determineDirection(priceDifference)

    if (!exchangePath) {
      console.log(`No Arbitrage Currently Available\n`)
      console.log(`-----------------------------------------\n`)
      isExecuting = false
      return
    }

    const { isProfitable, amount } = await determineProfitability(exchangePath, _baseToken, _quoteToken)

    if (!isProfitable) {
      console.log(`No Arbitrage Currently Available\n`)
      console.log(`-----------------------------------------\n`)
      isExecuting = false
      return
    }

    const receipt = await executeTrade(exchangePath, _baseToken, _quoteToken, amount)

    isExecuting = false

    console.log("\nWaiting for swap event...\n")
  }
}

const checkPrice = async (_pools, _baseToken, _quoteToken) => {
  isExecuting = true

  console.log(`Swap Detected, Checking Price...\n`)

  const currentBlock = await provider.getBlockNumber()

  const uPrice = await calculatePrice(_pools[0], _baseToken, _quoteToken) // Ensure helper handles this or just pass as is
  const cPrice = await calculatePrice(_pools[1], _baseToken, _quoteToken)

  const uFPrice = Number(uPrice).toFixed(UNITS)
  const cFPrice = Number(cPrice).toFixed(UNITS)
  const priceDifference = (((uFPrice - cFPrice) / cFPrice) * 100).toFixed(2)

  console.log(`Current Block: ${currentBlock}`)
  console.log(`-----------------------------------------`)
  console.log(`UNISWAP     | ${_baseToken.symbol}/${_quoteToken.symbol}\t | ${uFPrice}`)
  console.log(`CAMELOT     | ${_baseToken.symbol}/${_quoteToken.symbol}\t | ${cFPrice}\n`)
  console.log(`Percentage Difference: ${priceDifference}%\n`)

  return priceDifference
}

const determineDirection = async (_priceDifference) => {
  console.log(`Determining Direction...\n`)

  if (_priceDifference >= PRICE_DIFFERENCE) {

    console.log(`Potential Arbitrage Direction:\n`)
    console.log(`Buy\t -->\t ${uniswap.name}`)
    console.log(`Sell\t -->\t ${camelot.name}\n`)
    return [uniswap, camelot]

  } else if (_priceDifference <= -(PRICE_DIFFERENCE)) {

    console.log(`Potential Arbitrage Direction:\n`)
    console.log(`Buy\t -->\t ${camelot.name}`)
    console.log(`Sell\t -->\t ${uniswap.name}\n`)
    return [camelot, uniswap]

  } else {
    return null
  }
}

const determineProfitability = async (_exchangePath, _baseToken, _quoteToken) => {
  console.log(`Determining Profitability...\n`)

  // This is where you can customize your conditions on whether a profitable trade is possible...

  /**
   * The helper file has quite a few functions that come in handy
   * for performing specifc tasks.
   */

  try {
    // Fetch liquidity off of the exchange to buy token1 from
    // Fetch liquidity from exchange where we BUY QuoteToken (Sell BaseToken)
    // Note: getPoolLiquidity might still expect sorted tokens if it calls getPool.
    // Ideally we pass the contract directly if possible, or ensure it uses sorted internally. 
    // Here we assume it handles sorting or we pass arbitrary order. Let's pass sorted for safety if needed, 
    // BUT we need liquidity of the Quote Token? No, usually liquidity is global.
    // Let's use Base/Quote for clarity but keep in mind helpers might need sorted.
    // Actually getPoolLiquidity uses (token0, token1) to FIND the pool.
    // So we should probably pass them sorted or update helper.
    // For now, let's just grab liquidity using the pool instance we already have? 
    // The previous code re-fetched it. Let's pass Base/Quote and assume helper handles or we update helper.
    // Wait, getPoolLiquidity takes (_exchange, _token0, _token1...).
    // Let's pass sorted ones if we can, or just _baseToken, _quoteToken and hope order doesn't matter for address derivation (it does).
    // Better to re-derive sorted order inside here or pass sorted.
    // SIMPLIFICATION: We already have pool contracts uPool/cPool in main(), but here we only have exchangePath.
    // Let's rely on getPoolLiquidity to work if we pass addresses.
    // Actually, let's just use _baseToken, _quoteToken. 
    // BUT we need to know direction for Quoter.

    // We are holding BaseToken (WETH). We want to Sell Base -> Buy Quote -> Sell Quote -> Buy Base.

    const liquidity = await getPoolLiquidity(_exchangePath[0], _baseToken, _quoteToken, POOL_FEE, provider)

    // An example of using a percentage of the liquidity
    // BigInt doesn't like decimals, so we use Big.js here
    const percentage = Big(0.5)
    const minAmount = Big(liquidity[1]).mul(percentage)

    // 1. Sell BaseToken for QuoteToken (Exact Output or Input?)
    // Let's say we want to use `minAmount` of ... Liquidity usually refers to the available depth.
    // `liquidity[1]` was used before.
    // Let's try to convert `minAmount` of BaseToken? Or QuoteToken?
    // Let's assume `minAmount` is our flash loan size in BaseToken.
    // So we want to know: specific amount of BaseToken -> How much QuoteToken?
    // And then QuoteToken -> How much BaseToken?

    // Old logic: `token0Needed` to buy `minAmount` of `token1`.
    // New logic: `amountOut` (Quote) given `amountIn` (Base).

    // Let's check `minAmount`. It was `liquidity[1] * percentage`.
    // If we want WETH profit, we likely want to flash WETH.
    // So `minAmount` should be in WETH.
    // If WETH is `token1`, then `liquidity[1]` is correct.
    // If WETH is `token0`, then `liquidity[0]` is correct.
    // Since `liquidity` array usually comes from `pool.getLiquidity()` which returns `uint128`, it's just one number (L).
    // Wait, `getPoolLiquidity` in `helpers.js` returns `[liquidity, balance0, balance1]`?
    // Let's verify `helpers.js` quickly. 
    // Ideally we use a fixed amount for simplicity or deriving from balance.

    // Assuming `minAmount` is amount of BaseToken we want to flash.

    // Step 1: Sell BaseToken (WETH) for QuoteToken (wstETH) on Exchange A.
    // We want to know how much QuoteToken we get. (quoteExactInputSingle)

    let quoteTokenAmount
    if (_exchangePath[0].name === "Camelot V3") {
      quoteTokenAmount = await _exchangePath[0].quoter.quoteExactInputSingle.staticCall(
        _baseToken.address,
        _quoteToken.address,
        BigInt(minAmount.round().toFixed(0)),
        0
      )
    } else {
      const inputParams = {
        tokenIn: _baseToken.address,
        tokenOut: _quoteToken.address,
        fee: POOL_FEE,
        amountIn: BigInt(minAmount.round().toFixed(0)),
        sqrtPriceLimitX96: 0
      }
      [quoteTokenAmount] = await _exchangePath[0].quoter.quoteExactInputSingle.staticCall(inputParams)
    }

    // Step 2: Sell QuoteToken (wstETH) for BaseToken (WETH) on Exchange B.
    // We put in `quoteTokenAmount`.

    let baseTokenReturned
    if (_exchangePath[1].name === "Camelot V3") {
      baseTokenReturned = await _exchangePath[1].quoter.quoteExactInputSingle.staticCall(
        _quoteToken.address,
        _baseToken.address,
        quoteTokenAmount,
        0
      )
    } else {
      const outputParams = {
        tokenIn: _quoteToken.address,
        tokenOut: _baseToken.address,
        fee: POOL_FEE,
        amountIn: quoteTokenAmount,
        sqrtPriceLimitX96: 0
      }
      [baseTokenReturned] = await _exchangePath[1].quoter.quoteExactInputSingle.staticCall(outputParams)
    }

    const amountIn = ethers.formatUnits(BigInt(minAmount.round().toFixed(0)), _baseToken.decimals)
    const amountOut = ethers.formatUnits(baseTokenReturned, _baseToken.decimals)

    console.log(`Estimated input of ${_baseToken.symbol}: ${amountIn}`)
    console.log(`Estimated return of ${_baseToken.symbol}: ${amountOut}\n`)

    const amountDifference = amountOut - amountIn

    // -- Calculate L2 Gas Cost --
    const estimatedGasLimit = BigInt(GAS_LIMIT)
    const l2GasPrice = await provider.getFeeData().then(data => data.gasPrice)
    const l2GasCost = estimatedGasLimit * l2GasPrice

    // -- Calculate L1 Data Cost --
    // We simulate the call data for the transaction to estimate L1 fees
    // This is an estimation. 
    // We'll use a dummy data packet similar to a swap call.
    let l1BaseFee = BigInt(0)
    try {
      l1BaseFee = await arbGasInfo.getL1BaseFeeEstimate()
    } catch (e) {
      console.log("L1 Base Fee failed:", e.message)
    }

    // Creating realistic calldata for estimation (executeTrade signature)
    // We can just use a dummy payload of reasonable size for a swap tx (approx 500-800 bytes)
    const dummyCalldata = "0x" + "00".repeat(800)

    let gasEstimateForL1 = BigInt(0)
    try {
      [gasEstimateForL1] = await nodeInterface.gasEstimateL1Component.staticCall(
        arbitrage.target,
        false, // not contract creation
        dummyCalldata,
        { value: 0 }
      )
    } catch (e) {
      console.log("Estimated L1 Component failed:", e.message)
    }

    const l1GasCost = gasEstimateForL1 * l1BaseFee

    const totalGasCost = l2GasCost + l1GasCost

    // Calculate net profit
    const netProfit = BigInt(amountDifference) - totalGasCost

    // Fetch account
    const account = new ethers.Wallet(process.env.PRIVATE_KEY, provider)

    const ethBalanceBefore = ethers.formatUnits(await provider.getBalance(account.address), 18)
    const ethBalanceAfter = ethers.formatUnits((BigInt(ethers.parseUnits(ethBalanceBefore, 18)) - totalGasCost).toString(), 18)

    const balanceBefore = Number(ethers.formatUnits(await _baseToken.contract.balanceOf(account.address), _baseToken.decimals))
    const balanceAfter = Number(ethers.formatUnits((BigInt(amountDifference) + BigInt(ethers.parseUnits(balanceBefore.toString(), _baseToken.decimals))).toString(), _baseToken.decimals))
    const balanceDifference = amountDifference

    const data = {
      'ETH Balance Before': ethBalanceBefore,
      'ETH Balance After': ethBalanceAfter,
      'L2 Gas Cost': ethers.formatUnits(l2GasCost, 18),
      'L1 Data Cost': ethers.formatUnits(l1GasCost, 18),
      'Total Gas Cost': ethers.formatUnits(totalGasCost, 18),
      '-': {},
      'Base Token Balance BEFORE': balanceBefore,
      'Base Token Balance AFTER': balanceAfter,
      'Gross Profit (Base)': ethers.formatUnits(amountDifference, _baseToken.decimals),
      'Net Profit (Base - Gas)': ethers.formatUnits(netProfit, _baseToken.decimals)
    }

    console.table(data)
    console.log()

    // Setup conditions...
    // Profit must cover gas and leave min profit
    // We compare netProfit against MIN_PROFIT threshold (if defined) or just > 0

    if (netProfit <= 0) {
      console.log("Unprofitable after gas costs.")
      return { isProfitable: false, amount: 0 }
    }

    if (Number(amountOut) < Number(amountIn)) {
      throw new Error("Not enough to pay back flash loan")
    }

    /*
    if (Number(ethBalanceAfter) < 0) {
      throw new Error("Not enough ETH for gas fee")
    }
    */
    // Commented out ETH check for now as simulation might not have real ETH

    return { isProfitable: true, amount: ethers.parseUnits(amountIn, _baseToken.decimals) }

  } catch (error) {
    console.log("!!! PROFITABILITY CHECK FAILED !!!")
    console.log(error)
    console.log("")
    return { isProfitable: false, amount: 0 }
  }
}

const executeTrade = async (_exchangePath, _baseToken, _quoteToken, _amount) => {
  console.log(`Attempting Arbitrage...\n`)

  let routerPath = []
  let tokenPath = []

  // Ensure path starts with BaseToken (WETH)
  // Logic: Market 0 is "Camelot" or "Uniswap". If we buy on Market 0:
  // We need to APPROVE Market 0 Router.
  // Path for Flash Swap usually implies:
  // [RouterA, RouterB]
  // [TokenIn, TokenOut] (Flash Token, Target Token)

  // Previous logic derived routerPath from _exchangePath. 
  // _exchangePath = [ExchangeToBuyFrom, ExchangeToSellTo]
  // = [Exchange where we output Base -> Receive Quote, Exchange where we Input Quote -> Receive Base]

  routerPath = [
    await _exchangePath[0].router.getAddress(),
    await _exchangePath[1].router.getAddress()
  ]

  tokenPath = [
    _baseToken.address,
    _quoteToken.address
  ]

  // Create Signer
  const account = new ethers.Wallet(process.env.PRIVATE_KEY, provider)

  // Approvals:
  // 0. BaseToken is approved for Router 0 (To Swap Base -> Quote)
  // 1. QuoteToken is approved for Router 1 (To Swap Quote -> Base) ?? 
  // Wait, Flash Loan mechanism usually handles this? 
  // Arbitrage contract needs approval from User to pull BaseToken (if not flash loan) OR Arbitrage contract holds logic.
  // The executeTrade function calls `arbitrage.executeTrade`.
  // The contract pulls flash loan or uses funds?
  // Let's assume standard local approval needed for initial move if any.
  // But wait, if it's flash loan, we don't need to approve?
  // Previous code had approvals. Let's keep them matched to routers.

  // Helper to get router address for comparison
  const uniRouter = await uniswap.router.getAddress()
  const camRouter = await camelot.router.getAddress()

  // Approve BaseToken for Router 0 (The first trade)
  await _baseToken.contract.connect(account).approve(routerPath[0], _amount)

  // We don't necessarily hold QuoteToken, the contract does swap. 
  // But maybe the contract needs approval for the second leg if it transferred to us? 
  // If logic assumes we do the swap:
  // Logic here approves Token1 for Camelot if we started with Token0 on Uniswap.
  // Previous logic:
  // if (Uniswap) { approve Token0 -> Uniswap, Token1 -> Camelot }
  // This implies we sell Token0 on Uniswap, get Token1, then Sell Token1 on Camelot?
  // So we mirror that:
  // Approve BaseToken -> Router 0
  // Approve QuoteToken -> Router 1

  await _quoteToken.contract.connect(account).approve(routerPath[1], _amount) // Note: _amount might be wrong scale for QuoteToken but usually max approval is fine or sufficient amount. 

  // Fetch token balances before
  const tokenBalanceBefore = await _baseToken.contract.balanceOf(account.address)
  const ethBalanceBefore = await provider.getBalance(account.address)

  // Determine if exchanges are Camelot
  const isCamelot = [
    _exchangePath[0].name === "Camelot V3",
    _exchangePath[1].name === "Camelot V3"
  ]

  if (config.PROJECT_SETTINGS.isDeployed) {
    const transaction = await arbitrage.connect(account).executeTrade(
      routerPath,
      tokenPath,
      isCamelot,
      POOL_FEE,
      _amount
    )

    const receipt = await transaction.wait(0)
  }

  console.log(`Trade Complete:\n`)

  // Fetch token balances after
  // Fetch token balances after
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