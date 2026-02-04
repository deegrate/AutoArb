require("dotenv").config()
const ethers = require("ethers")
const config = require('./config.json')
const { provider, uniswap, camelot } = require('./helpers/initialization')
const { getPoolAddress } = require('./helpers/helpers')
const IERC20 = require('@openzeppelin/contracts/build/contracts/ERC20.json')

const TOKENS = {
    "PENDLE": "0x0c880f6761f1af8d9aa9c466984b80dab9a8c9e8",
    "GMX": "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a",
    "MAGIC": "0x539bdE0d7Dbd336b79148AA742883198BBF60342",
    "WETH": "0x82af49447d8a07e3bd95bd0d56f35241523fbab1"
}

const main = async () => {
    console.log("Starting Debugging for PENDLE/GMX/MAGIC...\n")

    // 1. Check Token Contracts
    for (const [name, address] of Object.entries(TOKENS)) {
        try {
            const code = await provider.getCode(address)
            if (code === '0x') {
                console.error(`[FATAL] ${name} (${address}) has NO CODE.`)
                continue
            }
            const contract = new ethers.Contract(address, IERC20.abi, provider)
            const symbol = await contract.symbol().catch(() => "Unknown")
            const decimals = await contract.decimals().catch(() => "Unknown")
            console.log(`[OK] ${name}: ${symbol} (Decimals: ${decimals})`)
        } catch (e) {
            console.error(`[ERROR] Checking ${name}:`, e.message)
        }
    }
    console.log("\n------------------------------------------------\n")

    // 2. Check Pools against WETH
    const baseToken = TOKENS.WETH
    const targetTokens = ["PENDLE", "GMX", "MAGIC"]
    const FEES = [500, 3000, 10000]

    for (const tokenName of targetTokens) {
        const quoteToken = TOKENS[tokenName]
        console.log(`Checking Pools for pair ${tokenName}/WETH...`)

        // Uniswap V3
        for (const fee of FEES) {
            try {
                const pool = await getPoolAddress(uniswap.factory, baseToken, quoteToken, fee, uniswap)
                if (pool && pool !== "0x0000000000000000000000000000000000000000") {
                    console.log(`  [Uniswap V3] Fee ${fee}: FOUND at ${pool}`)
                } else {
                    // console.log(`  [Uniswap V3] Fee ${fee}: Not found`)
                }
            } catch (e) {
                console.error(`  [Uniswap V3] Error checking fee ${fee}:`, e.message)
            }
        }

        // Camelot V3
        try {
            // Camelot uses poolByPair, so fee is ignored but getPoolAddress signature takes it?
            // helpers.js: getPoolAddress(_factory, _token0, _token1, _fee, _exchange)
            // if exchange.name === "Camelot V3", it ignores fee and calls poolByPair.
            const pool = await getPoolAddress(camelot.factory, baseToken, quoteToken, 0, camelot)
            if (pool && pool !== "0x0000000000000000000000000000000000000000") {
                console.log(`  [Camelot V3] FOUND at ${pool}`)
            } else {
                console.log(`  [Camelot V3] Not found`)
            }
        } catch (e) {
            console.error(`  [Camelot V3] Error checking:`, e.message)
        }
        console.log("")
    }

    process.exit(0)
}

main()
