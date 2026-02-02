require("dotenv").config()
const ethers = require("ethers")
const config = require('./config.json')
const IBiswapFactory = [
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
]
const ICamelotFactory = [
    "function poolByPair(address tokenA, address tokenB) external view returns (address pool)"
]

const { provider } = require('./helpers/initialization')

const checkPools = async (pair) => {
    const uFactory = new ethers.Contract(config.UNISWAP.FACTORY_V3, IBiswapFactory, provider)
    const cFactory = new ethers.Contract(config.CAMELOT.FACTORY_V3, ICamelotFactory, provider) // Camelot V3 might use different method? V3 is usually getPool.
    // Wait, Camelot V3 is Algebra? Or Uniswap V3 Fork?
    // bot.js uses poolByPair for Camelot? Let's check helpers.js

    // Actually, let's just use helpers.js logic if possible, or copy it.
    // helpers.js:
    // if name == Camelot V3 -> poolByPair
    // else -> getPool

    console.log(`Checking Pools for ${pair.name}...`)
    try {
        const uPool = await uFactory.getPool(pair.baseToken, pair.quoteToken, pair.uniswapPoolFee)
        console.log(`Uniswap Pool: ${uPool}`)
    } catch (e) {
        console.error(`Uniswap Pool Check Failed:`, e.message)
    }

    try {
        // Camelot V3 Factory? config says 0x1a3c...
        // Let's assume poolByPair is correct for Camelot logic in bot.
        // Wait, bot.js helpers says poolByPair.
        // But is Camelot V3 actually using poolByPair? AlgebraFactory uses poolByPair? 
        // Let's rely on the ABI I just defined.
        const cPool = await cFactory.poolByPair(pair.baseToken, pair.quoteToken)
        console.log(`Camelot Pool: ${cPool}`)
    } catch (e) {
        // Try getPool if poolByPair fails (maybe it is standard V3)
        try {
            const cFactoryV3 = new ethers.Contract(config.CAMELOT.FACTORY_V3, IBiswapFactory, provider)
            const cPool = await cFactoryV3.getPool(pair.baseToken, pair.quoteToken, pair.camelotPoolFee)
            console.log(`Camelot Pool (getPool): ${cPool}`)
        } catch (e2) {
            console.error(`Camelot Pool Check Failed:`, e.message)
        }
    }
}

const main = async () => {
    for (const pair of config.PAIRS) {
        await checkPools(pair)
    }
}

main()
