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
  provider = new ethers.WebSocketProvider(`wss://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`)
}

// -- SETUP UNISWAP/CAMELOT CONTRACTS -- //
const uniswap = {
  name: "Uniswap V3",
  factory: new ethers.Contract(config.UNISWAP.FACTORY_V3, IUniswapV3Factory.abi, provider),
  quoter: new ethers.Contract(config.UNISWAP.QUOTER_V3, IQuoter.abi, provider),
  router: new ethers.Contract(config.UNISWAP.ROUTER_V3, ISwapRouter.abi, provider)
}

const camelot = {
  name: "Camelot V3",
  factory: new ethers.Contract(config.CAMELOT.FACTORY_V3, ['function poolByPair(address tokenA, address tokenB) view returns (address pool)'], provider),
  quoter: new ethers.Contract(config.CAMELOT.QUOTER_V3, ['function quoteExactOutputSingle(address tokenIn, address tokenOut, uint256 amount, uint160 limitSqrtPrice) external returns (uint256 amountIn)', 'function quoteExactInputSingle(address tokenIn, address tokenOut, uint256 amountIn, uint160 limitSqrtPrice) external returns (uint256 amountOut)'], provider),
  router: new ethers.Contract(config.CAMELOT.ROUTER_V3, ['function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)'], provider)
}

const IArbitrage = require('../artifacts/contracts/Arbitrage.sol/Arbitrage.json')
const arbitrage = new ethers.Contract(config.PROJECT_SETTINGS.ARBITRAGE_ADDRESS, IArbitrage.abi, provider)

// Arbitrum Precompiles
const { IArbGasInfo, INodeInterface } = require('./abi')
const arbGasInfo = new ethers.Contract("0x000000000000000000000000000000000000006C", IArbGasInfo, provider)
const nodeInterface = new ethers.Contract("0x00000000000000000000000000000000000000C8", INodeInterface, provider)

module.exports = {
  provider,
  uniswap,
  camelot,
  arbitrage,
  arbGasInfo,
  nodeInterface
}