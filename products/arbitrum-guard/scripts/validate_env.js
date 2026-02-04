require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
    const key = process.env.PRIVATE_KEY;
    console.log("Checking Private Key...");

    if (!key) {
        console.error("Error: PRIVATE_KEY is missing or empty.");
        return;
    }

    console.log("Key length:", key.length);

    // Check for common issues
    if (!key.startsWith("0x")) {
        console.warn("Warning: Private key does not start with '0x'. Ethers might handle it, but Hardhat config often prefers hex strings.");
    }

    try {
        const wallet = new ethers.Wallet(key);
        console.log("Success! Wallet address derived:", wallet.address);
    } catch (error) {
        console.error("Invalid Private Key:", error.message);
    }
}

main();
