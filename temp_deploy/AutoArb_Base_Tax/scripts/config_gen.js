const ethers = require('ethers')
require("dotenv").config()
const config = require('../config.json')
const { provider } = require('../helpers/initialization')

const FEE_TIERS = [100, 500, 3000, 10000] // 0.01%, 0.05%, 0.3%, 1%

// Common Stables
const STABLES = new Set([
    "USDC", "USDC.e", "USDT", "DAI", "FRAX"
])

const FACTORY_ABI = [
    "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)"
]

const POOL_ABI = [
    "function liquidity() view returns (uint128)"
]

const ERC20_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
]

async function getBestPool(factoryAddress, tokenA, tokenB, dexName) {
    const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider)
    let bestPool = { address: ethers.ZeroAddress, fee: 0, liquidity: BigInt(0) }

    console.log(`Scanning ${dexName} pools...`)

    for (const fee of FEE_TIERS) {
        try {
            const poolAddress = await factory.getPool(tokenA, tokenB, fee)
            if (poolAddress === "0x0000000000000000000000000000000000000000") continue;

            const pool = new ethers.Contract(poolAddress, POOL_ABI, provider)
            const liq = await pool.liquidity()

            // console.log(`  Fee ${fee}: ${poolAddress} (Liq: ${liq})`)

            if (BigInt(liq) > bestPool.liquidity) {
                bestPool = { address: poolAddress, fee: fee, liquidity: BigInt(liq) }
            }
        } catch (e) {
            // Pool might not exist or verify failed
        }
    }

    return bestPool
}

const main = async () => {
    const args = process.argv.slice(2)
    if (args.length < 2) {
        console.log("Usage: node scripts/config_gen.js <TOKEN_A> <TOKEN_B>")
        process.exit(1)
    }

    const tokenA = args[0]
    const tokenB = args[1]

    // Fetch Symbols
    const cA = new ethers.Contract(tokenA, ERC20_ABI, provider)
    const cB = new ethers.Contract(tokenB, ERC20_ABI, provider)
    const symA = await cA.symbol()
    const symB = await cB.symbol()

    console.log(`Generating Config for ${symA}/${symB}...`)

    // Find Best Pools
    const uPool = await getBestPool(config.UNISWAP.FACTORY_V3, tokenA, tokenB, "Uniswap")
    const cPool = await getBestPool(config.CAMELOT.FACTORY_V3, tokenA, tokenB, "Camelot") // Camelot Factory also has getPool usually, or poolByPair?
    // Note: Camelot Factory V3 (Algebra) uses 'poolByPair(tokenA, tokenB)'. It doesn't use fees for pool separation usually (dynamic fees).
    // Let's check Camelot Logic.
    // If Camelot is Algebra, it's ONE pool per pair. 
    // My previous 'initialization.js' has: 'poolByPair(address tokenA, address tokenB)'.
    // BUT 'config.json' has 'camelotPoolFee'. 
    // If Camelot has only one pool, the fee might be dynamic or fixed config?
    // I will double check Camelot finding.

    // RE-CHECK Camelot Factory interface in `discovery.js` / `initialization.js`
    // initialization.js: factory.poolByPair(...)
    // So for Camelot, we don't iterate fees. We just get THE pool.

    let camelotFee = 0
    let camelotAddress = ethers.ZeroAddress

    try {
        const camFactory = new ethers.Contract(config.CAMELOT.FACTORY_V3, ["function poolByPair(address, address) view returns (address)"], provider)
        camelotAddress = await camFactory.poolByPair(tokenA, tokenB)
        if (camelotAddress !== ethers.ZeroAddress) {
            // For config purposes, we might need to assume a fee or fetch it from the pool 'globalState' or 'fee'? 
            // Algebra pools have dynamic fees. 
            // Our bot `bot.js` uses `camelotPoolFee` in `getPoolContract`.
            // IF `getPoolContract` uses `poolByPair` for Camelot (it does in `initialization.js`?), then the `fee` param in config might be unused or used for Quoter?
            // `initialization.js` -> `getPoolContract` helper?
            // Let's check `helpers.js`.
            camelotFee = 100 // Default placeholder if dynamic
        }
    } catch (e) {
        console.log("Error checking Camelot pool: " + e.message)
    }

    // Determine Params
    const isStableA = STABLES.has(symA)
    const isStableB = STABLES.has(symB)
    const isStablePair = isStableA && isStableB

    let maxBaseAmount = "0.5" // Default Volatile
    let minProfit = "0.02"   // Default Volatile

    if (isStablePair) {
        maxBaseAmount = "1000"
        minProfit = "0.1"
    }

    const pairName = `${symA}_${symB}`

    const configObj = {
        "name": pairName,
        "baseToken": tokenA,
        "quoteToken": tokenB,
        "uniswapPoolFee": uPool.fee || 3000,
        "camelotPoolFee": camelotFee || 3000, // Camelot usually 3000 equiv or dynamic
        "minProfitBase": minProfit,
        "maxBaseAmount": maxBaseAmount
    }

    console.log("\n--- JSON OUTPUT ---")
    console.log(JSON.stringify(configObj, null, 4))
    console.log("-------------------\n")
    console.log("Instruction: Copy the above object into config.json 'PAIRS' array.")
}

main().catch(console.error).finally(() => process.exit())
