require("dotenv").config();
const { ethers } = require("ethers");
const { exec } = require("child_process");
const { sendAlert } = require('../../core-modules/notifier');

// --- CONFIGURATION ---
const WALLET_ADDRESS = "0x65EcEAA0024E628C90ECc418A1907719Bafe4845";
const LOSS_THRESHOLD_PCT = 5.0; // 5% Loss Trigger
const CHECK_INTERVAL_MS = 60000; // 1 Minute

const CHAINS = {
    ARBITRUM: "https://arb-mainnet.g.alchemy.com/v2/_fk7nNm4e6xAvW5ixLxf-",
    BASE: "https://base-mainnet.g.alchemy.com/v2/JwquhDoHFlYs7qEiHhOiw"
};

let initialBalance = null;

async function getTotalBalance() {
    let total = 0;
    for (const [name, url] of Object.entries(CHAINS)) {
        try {
            const provider = new ethers.JsonRpcProvider(url);
            const bal = await provider.getBalance(WALLET_ADDRESS);
            const balEth = parseFloat(ethers.formatEther(bal));
            // console.log(`[GUARDIAN] ${name}: ${balEth.toFixed(4)} ETH`);
            total += balEth;
        } catch (e) {
            console.error(`[GUARDIAN] Failed to check ${name}: ${e.message}`);
        }
    }
    return total;
}

async function monitor() {
    try {
        const currentBalance = await getTotalBalance();

        if (initialBalance === null) {
            initialBalance = currentBalance;
            console.log(`[GUARDIAN] Initialized. Baseline: ${initialBalance.toFixed(4)} ETH`);
            console.log(`[GUARDIAN] Monitoring for ${LOSS_THRESHOLD_PCT}% drop...`);
            return;
        }

        // Avoid division by zero if balance is 0
        if (initialBalance === 0) {
            console.log(`[GUARDIAN] Initial balance is 0. Waiting for funds...`);
            initialBalance = currentBalance; // Reset if funds arrive? Or keep 0? 
            // If it stays 0, loss is 0. If it goes up, loss is negative (profit).
            return;
        }

        const loss = ((initialBalance - currentBalance) / initialBalance) * 100;
        console.log(`[GUARDIAN] Current: ${currentBalance.toFixed(4)} ETH | Loss: ${loss.toFixed(2)}%`);

        if (loss >= LOSS_THRESHOLD_PCT) {
            console.error("!!! CRITICAL LOSS DETECTED: INITIATING EMERGENCY SHUTDOWN !!!");

            const panicMsg = `⚠️ *CRITICAL RECOVERY ALERT*\\n\\n` +
                `The Guardian has detected a *${loss.toFixed(2)}%* loss.\\n` +
                `*ACTION:* All bots have been EMERGENCY STOPPED.`;

            await sendAlert(panicMsg, 'GUARDIAN-SHIELD');

            // Kill all PM2 processes immediately
            exec("pm2 stop all", (err) => {
                if (err) console.error("Failed to execute PM2 stop:", err);
                else console.log("PM2 STOP ALL EXECUTED SUCCESSFULLY.");
                process.exit(1);
            });
        }
    } catch (err) {
        console.error("[GUARDIAN] Monitoring Error:", err.message);
    }
}

console.log("--- Millennium-Guardian Started ---");
setInterval(monitor, CHECK_INTERVAL_MS);
monitor();
