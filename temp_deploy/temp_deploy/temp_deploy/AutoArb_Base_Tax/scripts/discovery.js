const ethers = require('ethers')
require("dotenv").config()
const config = require('../config.json')
const { provider } = require('../helpers/initialization')

// Trusted Base Assets on Arbitrum
const TARGET_TOKENS = new Set([
    "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1".toLowerCase(), // WETH
    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831".toLowerCase(), // USDC
    "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8".toLowerCase(), // USDC.e
    "0x912CE59144191C1204E64559FE8253a0e49E6548".toLowerCase(), // ARB
    "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f".toLowerCase()  // WBTC
])

const TOKEN_SYMBOLS = {
    "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1": "WETH",
    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831": "USDC",
    "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8": "USDC.e",
    "0x912CE59144191C1204E64559FE8253a0e49E6548": "ARB",
    "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f": "WBTC"
}

// Uniswap V3 Factory ABI (PoolCreated)
const UNISWAP_V3_FACTORY_ABI = [
    "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)"
]

// Camelot V3 (Algebra) Factory ABI
// Algebra Factory event typically: event Pool(address indexed token0, address indexed token1, address pool)
// But could also match PoolCreated signature in some forks. We'll listen for both constructs if needed.
// Based on Algebra source: event Pool(address indexed token0, address indexed token1, address pool);
const CAMELOT_V3_FACTORY_ABI = [
    "event Pool(address indexed token0, address indexed token1, address pool)",
    "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)" // Just in case
]

const main = async () => {
    console.log("--- STARTING DISCOVERY AGENT (MONITOR MODE) ---")
    console.log("Listening for new pools on Uniswap V3 and Camelot V3...")

    const uFactory = new ethers.Contract(config.UNISWAP.FACTORY_V3, UNISWAP_V3_FACTORY_ABI, provider)
    const cFactory = new ethers.Contract(config.CAMELOT.FACTORY_V3, CAMELOT_V3_FACTORY_ABI, provider)

    // -- Event Listeners --

    // Uniswap V3
    uFactory.on('PoolCreated', (token0, token1, fee, tickSpacing, poolAddress, event) => {
        handleNewPool("Uniswap V3", token0, token1, poolAddress, fee)
    })

    // Camelot V3
    // Note: Algebra 'Pool' event has 3 args. 'PoolCreated' has 5.
    // We attach listeners for what's in the ABI.

    cFactory.on('Pool', (token0, token1, poolAddress, event) => {
        handleNewPool("Camelot V3", token0, token1, poolAddress, null)
    })

    // Fallback if Camelot uses standard PoolCreated
    try {
        cFactory.on('PoolCreated', (token0, token1, fee, tickSpacing, poolAddress, event) => {
            handleNewPool("Camelot V3", token0, token1, poolAddress, fee)
        })
    } catch (e) {
        // Event might not exist in ABI/Contract logic, ignore
    }

    // Keep process alive
    process.stdin.resume()
}

async function handleNewPool(dex, token0, token1, poolAddress, fee) {
    const t0 = token0.toLowerCase()
    const t1 = token1.toLowerCase()

    const isT0Trusted = TARGET_TOKENS.has(t0)
    const isT1Trusted = TARGET_TOKENS.has(t1)

    if (isT0Trusted || isT1Trusted) {
        const symbol0 = TOKEN_SYMBOLS[ethers.getAddress(t0)] || t0
        const symbol1 = TOKEN_SYMBOLS[ethers.getAddress(t1)] || t1

        console.log(`\n[${dex}] NEW POOL DETECTED!`)
        console.log(`Pair: ${symbol0} / ${symbol1}`)
        console.log(`Address: ${poolAddress}`)
        if (fee) console.log(`Fee: ${fee}`)
        console.log(`Timestamp: ${new Date().toISOString()}`)
        console.log("---------------------------------------------")
    } else {
        // console.log(`[${dex}] Ignored Pair: ${token0} / ${token1} (No Trusted Base Asset)`)
    }
}

main().catch(console.error)
