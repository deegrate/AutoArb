require('dotenv').config();
const { ethers } = require('ethers');
const config = require('../config.json');

// Artifacts (Ensure these paths match your local build folder)
const IUniswapV3Factory = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json');
const IQuoter = require('@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json');
const ISwapRouter = require('@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json');

let provider;

if (config.PROJECT_SETTINGS.isLocal) {
  provider = new ethers.WebSocketProvider(`ws://127.0.0.1:8545/`);
} else {
  // STABILITY FIX: Using JsonRpcProvider for server environments
  // Ensure ARB_ALCHEMY_KEY in .env starts with https://
  provider = new ethers.JsonRpcProvider(process.env.ARB_ALCHEMY_KEY);
}

// Initialization of Contracts
const uniswap = new ethers.Contract(config.UNISWAP.FACTORY_ADDRESS, IUniswapV3Factory.abi, provider);
const camelot = new ethers.Contract(config.CAMELOT.FACTORY_ADDRESS, IUniswapV3Factory.abi, provider);

// Exporting the unified provider and contracts
module.exports = {
  provider,
  uniswap,
  camelot
};