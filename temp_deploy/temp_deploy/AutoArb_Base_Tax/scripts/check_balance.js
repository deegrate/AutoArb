require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
    const key = process.env.PRIVATE_KEY;
    const provider = new ethers.JsonRpcProvider(`https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`);

    // Handle prefix
    const privateKey = key.startsWith("0x") ? key : "0x" + key;
    const wallet = new ethers.Wallet(privateKey, provider);

    const network = await provider.getNetwork();
    console.log("Connected to Chain ID:", network.chainId.toString()); // Should be 42161

    console.log("Checking Balance for:", wallet.address);
    const balance = await provider.getBalance(wallet.address);
    console.log("Balance:", ethers.formatEther(balance), "ETH");

    if (balance === 0n) {
        console.error("!!! WALLET IS EMPTY !!!");
    } else if (balance < ethers.parseEther("0.005")) {
        console.warn("Warning: Low balance. Deployment might fail.");
    }
}

main().catch(console.error);
