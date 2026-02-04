require("dotenv").config()
const ethers = require('ethers')

/**
 * This file could be used for initializing some
 * of the main contracts such as the V3 router & 
 * factory. This is also where we initialize the
 * main Arbitrage contract.
 */

const config = require('../config.json')
const IUniswapV3Factory = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json')
const IQuoter = require('@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json')
const ISwapRouter = require('@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json')

let provider

if (config.PROJECT_SETTINGS.isLocal) {
  provider = new ethers.WebSocketProvider(`ws://127.0.0.1:8545/`)
} else {
  // Base Mainnet (HTTP/WSS)
  // Prioritize dedicated Base key with Ethers.js Batching Fix
  if (process.env.BASE_ALCHEMY_KEY) {
    console.log("DEBUG: Using Dedicated BASE_ALCHEMY_KEY with Batching Fix");
    provider = new ethers.JsonRpcProvider(
      `https://base-mainnet.g.alchemy.com/v2/${process.env.BASE_ALCHEMY_KEY}`,
      undefined,
      { batchMaxCount: 1 }
    )
  } else if (process.env.ALCHEMY_API_KEY) {
    console.log("DEBUG: Using Shared ALCHEMY_API_KEY (Warning: May be Arbitrum-only)");
    provider = new ethers.WebSocketProvider(`wss://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`)
  } else {
    console.log("Using Public RPC: https://mainnet.base.org")
    provider = new ethers.JsonRpcProvider("https://mainnet.base.org")
  }
}

// -- SETUP UNISWAP/AERODROME CONTRACTS -- //
const uniswap = {
  name: "Uniswap V3",
  factory: new ethers.Contract(config.UNISWAP.FACTORY_V3, IUniswapV3Factory.abi, provider),
  quoter: new ethers.Contract(config.UNISWAP.QUOTER_V3, IQuoter.abi, provider),
  router: new ethers.Contract(config.UNISWAP.ROUTER_V3, ISwapRouter.abi, provider)
}

// Re-purposing the "camelot" variable to be "Aerodrome" to minimize bot.js refactoring
const camelot = {
  name: "Aerodrome V2",
  // Aerodrome Factory uses getPool(tokenA, tokenB, stable)
  // We define a simple interface here for initialization, 
  // but logic in helpers.js handles the specific function calls.
  factory: new ethers.Contract(config.AERODROME.FACTORY_V2, ['function getPool(address tokenA, address tokenB, bool stable) view returns (address pool)'], provider),
  // Router V2 Interface 
  router: new ethers.Contract(config.AERODROME.ROUTER_V2, [
    'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)',
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
  ], provider)
}

const IArbitrage = require('../artifacts/contracts/AutoArb.sol/AutoArb.json')
const arbitrage = new ethers.Contract(config.PROJECT_SETTINGS.ARBITRAGE_ADDRESS, IArbitrage.abi, provider)

module.exports = {
  provider,
  uniswap,
  camelot,
  arbitrage
}