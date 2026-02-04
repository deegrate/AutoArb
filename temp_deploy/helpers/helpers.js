const ethers = require("ethers")
const Big = require('big.js')

/**
 * This file could be used for adding functions you
 * may need to call multiple times or as a way to
 * abstract logic from bot.js. Feel free to add
 * in your own functions you desire here!
 */

const { IUniswapV3Pool, ICamelotV3Pool } = require('./abi')
const IERC20 = require('@openzeppelin/contracts/build/contracts/ERC20.json')

async function getTokenAndContract(_token0Address, _token1Address, _provider) {
  const token0Contract = new ethers.Contract(_token0Address, IERC20.abi, _provider)
  const token1Contract = new ethers.Contract(_token1Address, IERC20.abi, _provider)

  const token0 = {
    contract: token0Contract,
    address: _token0Address,
    symbol: await token0Contract.symbol(),
    decimals: await token0Contract.decimals(),
  }

  const token1 = {
    contract: token1Contract,
    address: _token1Address,
    symbol: await token1Contract.symbol(),
    decimals: await token1Contract.decimals(),
  }

  return { token0, token1 }
}

async function getPoolAddress(_factory, _token0, _token1, _fee, _exchange) {
  if (_exchange.name === "Camelot V3") {
    return await _factory.poolByPair(_token0, _token1)
  }
  const poolAddress = await _factory.getPool(_token0, _token1, _fee)
  return poolAddress
}

async function getPoolContract(_exchange, _token0, _token1, _fee, _provider) {
  const poolAddress = await getPoolAddress(_exchange.factory, _token0, _token1, _fee, _exchange)
  const poolABI = _exchange.name === "Uniswap V3" ? IUniswapV3Pool : ICamelotV3Pool
  const pool = new ethers.Contract(poolAddress, poolABI, _provider)
  return pool
}

async function getPoolLiquidity(_exchange, _token0, _token1, _fee, _provider) {
  const poolAddress = await getPoolAddress(_exchange.factory, _token0.address, _token1.address, _fee, _exchange)

  const token0Balance = await _token0.contract.balanceOf(poolAddress)
  const token1Balance = await _token1.contract.balanceOf(poolAddress)

  return [token0Balance, token1Balance]
}

async function calculatePrice(_pool, _baseToken, _quoteToken) {
  // Uniswap V3: Price is always Token1 per Token0
  // token0 is the smaller address
  const token0Address = _baseToken.address.toLowerCase() < _quoteToken.address.toLowerCase()
    ? _baseToken.address
    : _quoteToken.address

  // Get sqrtPriceX96...
  let sqrtPriceX96
  try {
    const slot0 = await _pool.slot0()
    sqrtPriceX96 = slot0[0]
  } catch (error) {
    try {
      const globalState = await _pool.globalState()
      sqrtPriceX96 = globalState[0]
    } catch (error2) {
      throw error
    }
  }

  // Calculate raw price (Token1 per Token0)
  // rate = (sqrtPrice / 2^96)^2
  const rate = Big(sqrtPriceX96).div(Big(2).pow(96)).pow(2)

  // Adjust for decimals
  // Price of T0 in terms of T1? No. 
  // Real Price T1/T0 = raw * 10^(dec0 - dec1)

  // Let's rely on base/quote identity.
  // if Base is Token0: We want Quote (T1) per Base (T0). -> T1/T0.
  // This is the formatted price derived from raw rate.

  // if Base is Token1: We want Quote (T0) per Base (T1). -> T0/T1.
  // This is 1 / formatted price.

  const isBaseToken0 = _baseToken.address.toLowerCase() === token0Address.toLowerCase()

  // Get Decimals
  const decimals0 = isBaseToken0 ? _baseToken.decimals : _quoteToken.decimals
  const decimals1 = isBaseToken0 ? _quoteToken.decimals : _baseToken.decimals

  // Calculate Rate Adjusted (T1 per T0)
  // Conversion factor = 10 ^ (Dec0 - Dec1)
  const conversion = Big(10).pow(Number(decimals0) - Number(decimals1))
  const priceT1perT0 = rate.mul(conversion)

  if (isBaseToken0) {
    // Return T1 per T0 (Quote per Base)
    return priceT1perT0.toString()
  } else {
    // Return T0 per T1 (Quote per Base)
    // Avoid division by zero
    if (priceT1perT0.eq(0)) return "0"
    return Big(1).div(priceT1perT0).toString()
  }
}

async function calculateDifference(_uPrice, _sPrice) {
  return (((_uPrice - _sPrice) / _sPrice) * 100).toFixed(2)
}

module.exports = {
  getTokenAndContract,
  getPoolAddress,
  getPoolContract,
  getPoolLiquidity,
  calculatePrice,
  calculateDifference,
}