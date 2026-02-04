require("dotenv").config()
const ethers = require('ethers')

const IUniswapV3Factory = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json')
const IQuoter = require('@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json')
const ISwapRouter = require('@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json')

// Arbitrum Precompiles ABIs
const { IArbGasInfo, INodeInterface } = require('./abi')
const IArbitrage = require('../artifacts/contracts/AutoArb.sol/AutoArb.json')

/**
 * Smart Initializer for Trading Bots
 * @param {Object} config - The configuration json object
 * @param {string} chain - 'arbitrum' or 'base'
 */
module.exports = (config, chain = 'arbitrum') => {
  let provider
  const isLocal = config.PROJECT_SETTINGS.isLocal

  // -- PROVIDER SETUP --
  if (isLocal) {
    provider = new ethers.WebSocketProvider(`ws://127.0.0.1:8545/`)
  } else {
    if (chain === 'base') {
      // Base Provider Priority
      if (process.env.BASE_ALCHEMY_KEY) {
        provider = new ethers.JsonRpcProvider(
          `https://base-mainnet.g.alchemy.com/v2/${process.env.BASE_ALCHEMY_KEY}`,
          undefined,
          { batchMaxCount: 1 }
        )
      } else if (process.env.ALCHEMY_API_KEY) {
        provider = new ethers.WebSocketProvider(`wss://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`)
      } else {
        provider = new ethers.JsonRpcProvider("https://mainnet.base.org")
      }
    } else {
      // Arbitrum Provider (Default)
      // Ensure ARB_ALCHEMY_KEY in .env starts with https:// for JsonRpc, or use WSS
      // Falling back to ALCHEMY_API_KEY if specific one missing
      const key = process.env.ARB_ALCHEMY_KEY || process.env.ALCHEMY_API_KEY
      if (key && key.startsWith('http')) {
        provider = new ethers.JsonRpcProvider(key)
      } else if (key) {
        provider = new ethers.WebSocketProvider(`wss://arb-mainnet.g.alchemy.com/v2/${key}`)
      } else {
        provider = new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc")
      }
    }
  }

  // Common Contracts
  const uniswap = {
    name: "Uniswap V3",
    factory: new ethers.Contract(config.UNISWAP.FACTORY_V3 || config.UNISWAP.FACTORY_ADDRESS, IUniswapV3Factory.abi, provider),
    quoter: new ethers.Contract(config.UNISWAP.QUOTER_V3 || config.UNISWAP.QUOTER_ADDRESS, IQuoter.abi, provider),
    router: new ethers.Contract(config.UNISWAP.ROUTER_V3 || config.UNISWAP.ROUTER_ADDRESS, ISwapRouter.abi, provider)
  }

  // Secondary DEX (Camelot or Aerodrome)
  let camelot
  if (chain === 'base') {
    camelot = {
      name: "Aerodrome V2",
      factory: new ethers.Contract(config.AERODROME.FACTORY_V2, ['function getPool(address tokenA, address tokenB, bool stable) view returns (address pool)'], provider),
      router: new ethers.Contract(config.AERODROME.ROUTER_V2, [
        'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)',
        'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
      ], provider)
    }
  } else {
    // Arbitrum Camelot
    camelot = {
      name: "Camelot V3",
      factory: new ethers.Contract(config.CAMELOT.FACTORY_V3 || config.CAMELOT.FACTORY_ADDRESS, ['function poolByPair(address tokenA, address tokenB) view returns (address pool)'], provider),
      quoter: new ethers.Contract(config.CAMELOT.QUOTER_V3 || config.CAMELOT.QUOTER_ADDRESS, ['function quoteExactOutputSingle(address tokenIn, address tokenOut, uint256 amount, uint160 limitSqrtPrice) external returns (uint256 amountIn)', 'function quoteExactInputSingle(address tokenIn, address tokenOut, uint256 amountIn, uint160 limitSqrtPrice) external returns (uint256 amountOut)'], provider),
      router: new ethers.Contract(config.CAMELOT.ROUTER_V3, ['function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)'], provider)
    }
  }

  // Arbitrage Contract
  const arbitrage = new ethers.Contract(config.PROJECT_SETTINGS.ARBITRAGE_ADDRESS, IArbitrage.abi, provider)

  // Arbitrum Specific Precompiles
  let arbGasInfo, nodeInterface
  if (chain === 'arbitrum') {
    arbGasInfo = new ethers.Contract("0x000000000000000000000000000000000000006C", IArbGasInfo, provider)
    nodeInterface = new ethers.Contract("0x00000000000000000000000000000000000000C8", INodeInterface, provider)
  }

  return {
    provider,
    uniswap,
    camelot, // This variable name is preserved for backward compatibility in bot.js (representing Secondary DEX)
    arbitrage,
    arbGasInfo,
    nodeInterface
  }
}