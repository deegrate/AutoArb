const hre = require("hardhat")
const config = require('../config.json')

// -- IMPORT HELPER FUNCTIONS & CONFIG -- //
const { getTokenAndContract, getPoolContract, calculatePrice } = require('../helpers/helpers')
const { provider, uniswap, camelot } = require('../helpers/initialization.js')

// -- CONFIGURE VALUES HERE -- //
const EXCHANGE_TO_USE = camelot

// Using the wstETH Whale from original file
const UNLOCKED_ACCOUNT = '0x513c7e3a9c69ca3e22550ef58ac1c0088e918fff'
const AMOUNT = '20000' // Amount of input tokens to swap

async function main() {
  // Use the first configured pair
  const PAIR = config.PAIRS[0]
  const FEE = PAIR.camelotPoolFee // Since we use Camelot for manipulation

  console.log(`Using Pair: ${PAIR.name}`)

  // Fetch contracts
  const {
    token0: TOKEN_A,
    token1: TOKEN_B
  } = await getTokenAndContract(PAIR.baseToken, PAIR.quoteToken, provider)

  // We want to swap TOKEN_A for TOKEN_B or vice versa.
  // The whale holds wstETH (0x5979...). 
  // Let's check which token is wstETH.
  let inputToken, outputToken
  if (TOKEN_A.address.toLowerCase() === "0x5979D7b546E38E414F7E9822514be443A4800529".toLowerCase()) {
    inputToken = TOKEN_A
    outputToken = TOKEN_B
  } else {
    inputToken = TOKEN_B
    outputToken = TOKEN_A
  }

  const pool = await getPoolContract(EXCHANGE_TO_USE, inputToken.address, outputToken.address, FEE, provider)

  // Fetch price before we execute the swap
  const priceBefore = await calculatePrice(pool, inputToken, outputToken)

  // Send ETH to account to ensure they have enough ETH to create the transaction
  await hre.network.provider.send("hardhat_setBalance", [
    UNLOCKED_ACCOUNT,
    "0xDE0B6B3A7640000", // 1 ETH in hex
  ]);

  await manipulatePrice([inputToken, outputToken], FEE)

  // Fetch price after the swap
  const priceAfter = await calculatePrice(pool, inputToken, outputToken)

  const data = {
    'Price Before': `1 ${inputToken.symbol} = ${Number(priceBefore).toFixed(5)} ${outputToken.symbol}`,
    'Price After': `1 ${inputToken.symbol} = ${Number(priceAfter).toFixed(5)} ${outputToken.symbol}`,
  }

  console.table(data)
}

async function manipulatePrice(_path, _fee) {
  console.log(`\nBeginning Swap...\n`)

  console.log(`Input Token: ${_path[0].symbol}`)
  console.log(`Output Token: ${_path[1].symbol}\n`)

  const amount = hre.ethers.parseUnits(AMOUNT, _path[0].decimals)
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes

  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [UNLOCKED_ACCOUNT],
  })

  const signer = await hre.ethers.getSigner(UNLOCKED_ACCOUNT)

  const balance = await _path[0].contract.balanceOf(signer.address)
  console.log(`Balance of ${signer.address}: ${hre.ethers.formatUnits(balance, _path[0].decimals)} ${_path[0].symbol}`)

  if (balance < amount) {
    console.error("Insufficient balance!")
    return
  }

  const approval = await _path[0].contract.connect(signer).approve(await EXCHANGE_TO_USE.router.getAddress(), amount, { gasLimit: 125000 })
  await approval.wait()
  console.log("Approved!")

  let ExactInputSingleParams;
  if (EXCHANGE_TO_USE.name === "Camelot V3") {
    ExactInputSingleParams = {
      tokenIn: _path[0].address,
      tokenOut: _path[1].address,
      recipient: signer.address,
      deadline: deadline,
      amountIn: amount,
      amountOutMinimum: 0,
      limitSqrtPrice: 0
    }
  } else {
    ExactInputSingleParams = {
      tokenIn: _path[0].address,
      tokenOut: _path[1].address,
      fee: _fee,
      recipient: signer.address,
      deadline: deadline,
      amountIn: amount,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0
    }
  }

  const swap = await EXCHANGE_TO_USE.router.connect(signer).exactInputSingle(
    ExactInputSingleParams
  );
  await swap.wait()

  console.log(`Swap Complete!\n`)
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
