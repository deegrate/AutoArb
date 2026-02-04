const ethers = require("ethers")
require("dotenv").config()
const fs = require('fs')

const RPC_URL = `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
const provider = new ethers.JsonRpcProvider(RPC_URL)

const tokens = {
    "WETH": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    "USDC (Native)": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "USDC.e (Bridged)": "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    "GRAIL": "0x3d9907F9a368ad0a51Be60f7Da3b97cf940982D8"
}

const uniswapFactoryAddress = "0x1F98431c8aD98523631AE4a59f267346ea31F984"
const factoryAbi = ["function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"]
const factory = new ethers.Contract(uniswapFactoryAddress, factoryAbi, provider)
const poolAbi = ["function liquidity() external view returns (uint128)"]

const logStream = fs.createWriteStream('verification_results.txt', { flags: 'w' })
const log = (msg) => {
    console.log(msg)
    logStream.write(msg + '\n')
}

const checkTokens = async () => {
    log("--- Checking Tokens ---")
    for (const [name, address] of Object.entries(tokens)) {
        try {
            const contract = new ethers.Contract(address, ["function symbol() view returns (string)", "function decimals() view returns (uint8)"], provider)
            const symbol = await contract.symbol()
            const decimals = await contract.decimals()
            log(`${name}: ${address} -> ${symbol} (${decimals} dec)`)
        } catch (e) {
            log(`${name}: ${address} -> ERROR: ${e.message}`)
        }
    }
}

const checkPool = async (tokenA, tokenB, fee, name) => {
    try {
        const poolAddress = await factory.getPool(tokenA, tokenB, fee)
        if (poolAddress === "0x0000000000000000000000000000000000000000") {
            log(`Pool ${name} (Fee ${fee}): DOES NOT EXIST`)
            return
        }
        const pool = new ethers.Contract(poolAddress, poolAbi, provider)
        const liq = await pool.liquidity()
        log(`Pool ${name} (Fee ${fee}): ${poolAddress} -> Liquidity: ${liq.toString()}`)
    } catch (e) {
        log(`Pool ${name} (Fee ${fee}): ERROR ${e.message}`)
    }
}

const main = async () => {
    await checkTokens()

    log("\n--- Checking Uniswap Pools ---")

    // USDC.e / USDC
    // Note: token order for getPool doesn't technically matter for factory read, but let's pass them.
    await checkPool(tokens["USDC.e (Bridged)"], tokens["USDC (Native)"], 100, "USDC.e/USDC")
    await checkPool(tokens["USDC.e (Bridged)"], tokens["USDC (Native)"], 500, "USDC.e/USDC")

    // GRAIL / WETH
    await checkPool(tokens["GRAIL"], tokens["WETH"], 3000, "GRAIL/WETH")
    await checkPool(tokens["GRAIL"], tokens["WETH"], 10000, "GRAIL/WETH")

    logStream.end()
}

main()
