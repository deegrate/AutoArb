require("dotenv").config()
const ethers = require("ethers")
const config = require('./config.json')
const IERC20 = require('@openzeppelin/contracts/build/contracts/ERC20.json')

const { provider } = require('./helpers/initialization')

const checkToken = async (name, address) => {
    try {
        console.log(`Checking ${name} at ${address}...`)
        const code = await provider.getCode(address)
        if (code === '0x') {
            console.error(`FAILED ${name}: No Code at address!`)
            return
        }
        const contract = new ethers.Contract(address, IERC20.abi, provider)
        const symbol = await contract.symbol()
        const decimals = await contract.decimals()
        console.log(`Success: ${symbol} (Decimals: ${decimals})`)
    } catch (e) {
        console.error(`FAILED ${name}:`, e.message)
    }
}

const main = async () => {
    // List from config
    const pairs = config.PAIRS
    for (const pair of pairs) {
        // Check Base
        await checkToken(pair.name + " BASE", pair.baseToken)
    }
}

main()
