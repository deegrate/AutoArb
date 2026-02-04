// Helpers for exporting ABIs

// Uniswap V3
const IUniswapV3Pool = require("@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json")

// Camelot V3
// We use a custom ABI here as Camelot V3 pools uses globalState instead of slot0
const ICamelotV3Pool = [
  {
    "anonymous": false, "inputs":
      [
        { "indexed": true, "internalType": "address", "name": "sender", "type": "address" },
        { "indexed": true, "internalType": "address", "name": "recipient", "type": "address" },
        { "indexed": false, "internalType": "int256", "name": "amount0", "type": "int256" },
        { "indexed": false, "internalType": "int256", "name": "amount1", "type": "int256" },
        { "indexed": false, "internalType": "uint160", "name": "sqrtPriceX96", "type": "uint160" },
        { "indexed": false, "internalType": "uint128", "name": "liquidity", "type": "uint128" },
        { "indexed": false, "internalType": "int24", "name": "tick", "type": "int24" }
      ],
    "name": "Swap", "type": "event"
  },
  {
    "inputs": [], "name": "slot0", "outputs":
      [
        { "internalType": "uint160", "name": "sqrtPriceX96", "type": "uint160" },
        { "internalType": "int24", "name": "tick", "type": "int24" },
        { "internalType": "uint16", "name": "observationIndex", "type": "uint16" },
        { "internalType": "uint16", "name": "observationCardinality", "type": "uint16" },
        { "internalType": "uint16", "name": "observationCardinalityNext", "type": "uint16" },
        { "internalType": "uint32", "name": "feeProtocol", "type": "uint32" },
        { "internalType": "bool", "name": "unlocked", "type": "bool" }
      ],
    "stateMutability": "view", "type": "function"
  },
  {
    "inputs": [], "name": "globalState", "outputs":
      [
        { "internalType": "uint160", "name": "price", "type": "uint160" },
        { "internalType": "int24", "name": "tick", "type": "int24" },
        { "internalType": "uint16", "name": "fee", "type": "uint16" },
        { "internalType": "uint16", "name": "timepointIndex", "type": "uint16" },
        { "internalType": "uint8", "name": "communityFeeToken0", "type": "uint8" },
        { "internalType": "uint8", "name": "communityFeeToken1", "type": "uint8" },
        { "internalType": "bool", "name": "unlocked", "type": "bool" }
      ],
    "stateMutability": "view", "type": "function"
  }
]

// Arbitrum Precompiles
const IArbGasInfo = [
  "function getL1BaseFeeEstimate() external view returns (uint256)"
]

const INodeInterface = [
  "function gasEstimateL1Component(address to, bool contractCreation, bytes calldata data) external payable returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)"
]

// Aerodrome V2 (Uniswap V2 / Velodrome Style)
const IAerodromeV2Pool = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external",
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)"
]

module.exports = {
  IUniswapV3Pool: IUniswapV3Pool.abi,
  ICamelotV3Pool,
  IArbGasInfo,
  INodeInterface,
  IAerodromeV2Pool
}