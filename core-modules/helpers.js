const ethers = require("ethers")
const Big = require('big.js')

/**
 * This file could be used for adding functions you
 * may need to call multiple times or as a way to
 * abstract logic from bot.js. Feel free to add
 * in your own functions you desire here!
 */

const { IUniswapV3Pool, ICamelotV3Pool, IAerodromeV2Pool } = require('./abi')
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
  if (_exchange.name === "Aerodrome V2") {
    // Aerodrome Factory: getPool(tokenA, tokenB, stable)
    // We assume volatile pools (stable = false)
    return await _factory.getPool(_token0, _token1, false)
  }
  const poolAddress = await _factory.getPool(_token0, _token1, _fee)
  return poolAddress
}

async function getPoolContract(_exchange, _token0, _token1, _fee, _provider) {
  const poolAddress = await getPoolAddress(_exchange.factory, _token0, _token1, _fee, _exchange)
  let poolABI
  if (_exchange.name === "Aerodrome V2") {
    poolABI = IAerodromeV2Pool
  } else {
    poolABI = _exchange.name === "Uniswap V3" ? IUniswapV3Pool : ICamelotV3Pool
  }

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
  const token0Address = _baseToken.address.toLowerCase() < _quoteToken.address.toLowerCase()
    ? _baseToken.address
    : _quoteToken.address

  let rate

  // Try V3 (slot0)
  try {
    let sqrtPriceX96
    try {
      const slot0 = await _pool.slot0()
      sqrtPriceX96 = slot0[0]
    } catch (error) {
      // Try V3 Global State (Camelot)
      const globalState = await _pool.globalState()
      sqrtPriceX96 = globalState[0]
    }
    // rate = (sqrtPrice / 2^96)^2
    rate = Big(sqrtPriceX96).div(Big(2).pow(96)).pow(2)

  } catch (error) {
    // Try V2 (getReserves) for Aerodrome
    try {
      const reserves = await _pool.getReserves()
      const r0 = Big(reserves[0].toString())
      const r1 = Big(reserves[1].toString())

      // If T0 is Base, Rate = T1 / T0.
      if (r0.eq(0)) rate = Big(0)
      else rate = r1.div(r0)

    } catch (e2) {
      throw new Error("Could not calculate price (Checked V3 slot0 and V2 getReserves)")
    }
  }

  const isBaseToken0 = _baseToken.address.toLowerCase() === token0Address.toLowerCase()

  const decimals0 = isBaseToken0 ? _baseToken.decimals : _quoteToken.decimals
  const decimals1 = isBaseToken0 ? _quoteToken.decimals : _baseToken.decimals

  const conversion = Big(10).pow(Number(decimals0) - Number(decimals1))
  const priceT1perT0 = rate.mul(conversion)

  if (isBaseToken0) {
    return priceT1perT0.toString()
  } else {
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