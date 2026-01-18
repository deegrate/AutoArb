const hre = require("hardhat")
const config = require('../config.json')

// -- IMPORT HELPER FUNCTIONS & CONFIG -- //
const { getTokenAndContract, getPoolContract, calculatePrice } = require('../helpers/helpers')
const { provider, uniswap, camelot } = require('../helpers/initialization.js')

// -- CONFIGURE VALUES HERE -- //
const EXCHANGE_TO_USE = camelot

const UNLOCKED_ACCOUNT = '0x513c7e3a9c69ca3e22550ef58ac1c0088e918fff' // wstETH Whale 
const AMOUNT = '1000' // Amount of tokens to swap

async function main() {
  // Fetch contracts
  const {
    token0: ARB_AGAINST,
    token1: ARB_FOR
  } = await getTokenAndContract(config.TOKENS.ARB_AGAINST, config.TOKENS.ARB_FOR, provider)

  const pool = await getPoolContract(EXCHANGE_TO_USE, ARB_AGAINST.address, ARB_FOR.address, config.TOKENS.POOL_FEE, provider)

  // Fetch price of SHIB/WETH before we execute the swap
  const priceBefore = await calculatePrice(pool, ARB_AGAINST, ARB_FOR)

  // Send ETH to account to ensure they have enough ETH to create the transaction
  // Set balance of the impersonated account directly to ensure it has ETH for gas
  await hre.network.provider.send("hardhat_setBalance", [
    UNLOCKED_ACCOUNT,
    "0xDE0B6B3A7640000", // 1 ETH in hex
  ]);

  await manipulatePrice([ARB_FOR, ARB_AGAINST])

  // Fetch price of SHIB/WETH after the swap
  const priceAfter = await calculatePrice(pool, ARB_AGAINST, ARB_FOR)

  const data = {
    'Price Before': `1 ${ARB_FOR.symbol} = ${Number(priceBefore).toFixed(0)} ${ARB_AGAINST.symbol}`,
    'Price After': `1 ${ARB_FOR.symbol} = ${Number(priceAfter).toFixed(0)} ${ARB_AGAINST.symbol}`,
  }

  console.table(data)
}

async function manipulatePrice(_path) {
  console.log(`\nBeginning Swap...\n`)

  console.log(`Input Token: ${_path[0].symbol}`)
  console.log(`Output Token: ${_path[1].symbol}\n`)

  const fee = config.TOKENS.POOL_FEE
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
      fee: fee,
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
