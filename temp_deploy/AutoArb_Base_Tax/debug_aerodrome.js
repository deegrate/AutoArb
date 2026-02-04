const ethers = require('ethers')
const config = require('./config.json')

const provider = new ethers.JsonRpcProvider("https://mainnet.base.org")

const ABI = [
    'function getPool(address tokenA, address tokenB, bool stable) view returns (address pool)'
]

const factory = new ethers.Contract(config.AERODROME.FACTORY_V2, ABI, provider)

async function main() {
    // Hardcoded Check
    const AERO_H = "0x940181a94a35a4569e4529a3cdfb74e38fd98631"
    const WETH_H = "0x4200000000000000000000000000000000000006"

    console.log("--- HARDCODED ---")
    try {
        const p = await factory.getPool(AERO_H, WETH_H, false)
        console.log(`H_AERO: ${p}`)
    } catch (e) { console.log(`H_ERR: ${e.message}`) }

    console.log("--- CONFIG LOOP ---")
    for (const pair of config.PAIRS) {
        console.log(`[${pair.name}]`)
        // console.log(` B: '${pair.baseToken}'`)
        // console.log(` Q: '${pair.quoteToken}'`)
        try {
            const v = await factory.getPool(pair.baseToken, pair.quoteToken, false)
            console.log(` V: ${v}`)
            const s = await factory.getPool(pair.baseToken, pair.quoteToken, true)
            console.log(` S: ${s}`)
        } catch (e) { console.log(` ERR: ${e.message}`) }
    }
}

main()
