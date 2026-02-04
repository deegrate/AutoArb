const ethers = require('ethers')
const config = require('./config.json')
const { provider, uniswap, camelot } = require('./helpers/initialization')
const { getTokenAndContract, getPoolContract } = require('./helpers/helpers')

async function main() {
    for (const pair of config.PAIRS) {
        console.log(`[DEBUG] Setting up ${pair.name}...`)
        try {
            // 1. Tokens
            console.log("  Fetching tokens...")
            const { token0, token1 } = await getTokenAndContract(pair.baseToken, pair.quoteToken, provider)
            console.log(`  Tokens: ${token0.symbol} / ${token1.symbol}`)

            // 2. Uniswap
            console.log("  Fetching Uniswap Pool...")
            const uPool = await getPoolContract(uniswap, token0.address, token1.address, pair.uniswapPoolFee, provider)
            console.log(`  Uniswap: ${uPool.target}`)

            // 3. Aerodrome
            console.log("  Fetching Aerodrome Pool...")
            const cFee = pair.aerodromePoolFee || 3000
            const cPool = await getPoolContract(camelot, token0.address, token1.address, cFee, provider)
            console.log(`  Aerodrome: ${cPool.target}`)

        } catch (e) {
            console.error(`  FAIL: ${e.message}`)
            console.error(e)
        }
    }
}

main()
