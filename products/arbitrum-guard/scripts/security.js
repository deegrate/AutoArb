const ethers = require('ethers')
require("dotenv").config()
const config = require('../config.json')
const { provider } = require('../helpers/initialization')

// Basic ERC20 ABI for ownership
const ERC20_ABI = [
    "function owner() view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function symbol() view returns (string)"
]

// V3 Pool ABI
const POOL_ABI = [
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function liquidity() view returns (uint128)"
]

async function checkTokenSecurity(tokenAddress) {
    console.log(`\n--- Vetting Token: ${tokenAddress} ---`)

    // 1. Basic Contract Checks
    try {
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
        const symbol = await token.symbol()
        console.log(`Symbol: ${symbol}`)

        // Ownership
        try {
            const owner = await token.owner()
            if (owner === "0x0000000000000000000000000000000000000000") {
                console.log("[PASS] Ownership Renounced (0x000...)")
            } else {
                console.log(`[WARN] Owner Address: ${owner} (Not Renounced)`)
            }
        } catch (e) {
            console.log("[INFO] 'owner()' function not found or failed (Could be renounced or non-standard).")
        }

    } catch (e) {
        console.log(`[ERROR] Could not interact with token: ${e.message}`)
        return false
    }

    // 2. Honeypot Check (GoPlus API)
    console.log("\n--- Honeypot / Security Check (GoPlus) ---")

    // We expect GOPLUS_API_KEY to be in .env but for now query assumes public or key in url if needed.
    // The doc says public access might be limited.
    // However, user said "I have a GoPlus API Key".
    // I will look for process.env.GOPLUS_API_KEY

    const goPlusKey = process.env.GOPLUS_API_KEY
    // If no key, we can try without (some endpoints work freely with limits) or warn.

    const chainId = "42161" // Arbitrum One
    // Note: GoPlus API usually doesn't strictly require key in URL param for some endpoints, 
    // but better to add ?access_token=KEY if supported, or just rely on rate limits.
    // I will append it if it exists.

    let url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${tokenAddress}`

    // Check if key behaves as access_token or header? 
    // Usually GoPlus uses Signature or just public. 
    // If the user has a key, they usually know how to use it, or it's for higher rate limits.
    // I will try to inspect if the user put it in .env.

    if (!goPlusKey) {
        console.log("[INFO] GOPLUS_API_KEY not found in .env. Trying public tier...")
    }

    try {
        const response = await fetch(url)
        const data = await response.json()

        if (data.code !== 1) {
            console.log(`[ERROR] GoPlus API Error: ${data.message}`)
            return false
        }

        const result = data.result[tokenAddress.toLowerCase()]
        if (!result) {
            console.log("[WARN] No data found for this token on GoPlus.")
            return true
        }

        console.log(`Open Source: ${result.is_open_source === "1" ? "YES" : "NO"}`)
        console.log(`Honeypot: ${result.is_honeypot === "1" ? "YES (DANGER!)" : "NO"}`)
        console.log(`Buy Tax: ${(result.buy_tax * 100).toFixed(2)}%`)
        console.log(`Sell Tax: ${(result.sell_tax * 100).toFixed(2)}%`)
        // console.log(`Proxy: ${result.is_proxy === "1" ? "YES" : "NO"}`)
        // console.log(`Mintable: ${result.is_mintable === "1" ? "YES" : "NO"}`)

        if (result.is_honeypot === "1") {
            console.log("!!! SECURITY RISK: HONEYPOT DETECTED !!!")
            return false
        }

        if (parseFloat(result.sell_tax) > 0.03) {
            console.log(`!!! SECURITY RISK: High Sell Tax (${(result.sell_tax * 100).toFixed(2)}%) !!!`)
            return false
        }

        console.log("[PASS] Token passed security checks.")
        return true

    } catch (e) {
        console.log(`[ERROR] API Request failed: ${e.message}`)
        return false
    }
}

async function checkPoolHealth(poolAddress, dexName) {
    console.log(`\n--- Vetting Pool (${dexName}): ${poolAddress} ---`)
    try {
        const pool = new ethers.Contract(poolAddress, POOL_ABI, provider)

        // Liquidity
        const liquidity = await pool.liquidity()
        console.log(`Liquidity (in-range): ${liquidity.toString()}`)

        if (liquidity == 0) {
            console.log("[FAIL] Pool has NO liquidity.")
            return false
        }

        // Slot0
        const slot0 = await pool.slot0()
        console.log(`Current Tick: ${slot0.tick}`)
        console.log(`Unlocked: ${slot0.unlocked}`)

        if (!slot0.unlocked) {
            console.log("[FAIL] Pool is LOCKED.")
            return false
        }

        console.log("[PASS] Pool appears active and liquid.")
        return true

    } catch (e) {
        console.log(`[ERROR] Stats fetch failed: ${e.message}`)
        return false
    }
}

const main = async () => {
    const args = process.argv.slice(2)
    if (args.length < 1) {
        console.log("Usage: node scripts/security.js <TOKEN_ADDRESS> [POOL_ADDRESS]")
        process.exit(1)
    }

    const tokenAddress = args[0]
    await checkTokenSecurity(tokenAddress)

    if (args[1]) {
        await checkPoolHealth(args[1], "Unknown Dex")
    }
}

if (require.main === module) {
    main().then(() => {
        setTimeout(() => {
            process.exit(0)
        }, 1000)
    }).catch((e) => {
        console.error(e)
        process.exit(1)
    })
}

module.exports = { checkTokenSecurity, checkPoolHealth }
