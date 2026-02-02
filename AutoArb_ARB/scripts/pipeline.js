const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { findCandidates } = require('./screener');
const { checkTokenSecurity, checkPoolHealth } = require('./security');
const { generateConfig } = require('./config_gen');

// Helper for CLI input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));

async function main() {
    console.log("==========================================");
    console.log("   AUTO-ARB PIPELINE: ANALYTICAL ENGINE   ");
    console.log("==========================================\n");

    // --- PHASE 1: DISCOVERY ---
    console.log(">>> PHASE 1: ANALYTICAL DISCOVERY (DexScreener)");
    const candidates = await findCandidates();

    if (candidates.length === 0) {
        console.log("No candidates found. Exiting.");
        process.exit(0);
    }

    console.log(`\nFound ${candidates.length} candidates.`);

    // Display Top 10
    const topCandidates = candidates.slice(0, 10);
    console.table(topCandidates.map((c, i) => ({
        Index: i + 1,
        Pair: c.symbols,
        "Liquidity Ratio": c.ratioStr,
        "Uni Liq": `$${(c.uLiq / 1000).toFixed(1)}k`,
        "Cam Liq": `$${(c.cLiq / 1000).toFixed(1)}k`
    })));

    // --- PHASE 2: SELECTION ---
    console.log("\n>>> PHASE 2: CANDIDATE SELECTION");
    const selectionStr = await askQuestion("Select Candidate Index (1-10) or 'q' to quit: ");

    if (selectionStr.toLowerCase() === 'q') {
        console.log("Exiting.");
        process.exit(0);
    }

    const index = parseInt(selectionStr) - 1;
    if (isNaN(index) || index < 0 || index >= topCandidates.length) {
        console.log("Invalid selection. Exiting.");
        process.exit(1);
    }

    const selected = topCandidates[index];
    console.log(`\nSELECTED: ${selected.symbols} (${selected.tokenA} / ${selected.tokenB})`);

    // --- PHASE 3: SECURITY ---
    console.log("\n>>> PHASE 3: SECURITY & VIABILITY CHECK");

    console.log(`Checking Token A: ${selected.tokenA}...`);
    const secureA = await checkTokenSecurity(selected.tokenA);
    if (!secureA) {
        console.log("!!! SECURITY FAILURE: Token A failed vetting. Aborting pipeline.");
        process.exit(1);
    }

    console.log(`Checking Token B: ${selected.tokenB}...`);
    const secureB = await checkTokenSecurity(selected.tokenB);
    if (!secureB) {
        console.log("!!! SECURITY FAILURE: Token B failed vetting. Aborting pipeline.");
        process.exit(1);
    }

    console.log(`Checking Pools Health...`);
    const poolHealthU = await checkPoolHealth(selected.uAddress, "Uniswap");
    const poolHealthC = await checkPoolHealth(selected.cAddress, "Camelot");

    if (!poolHealthU || !poolHealthC) {
        console.log("!!! SECURITY FAILURE: One or more pools are locked or have zero liquidity.");
        process.exit(1);
    }

    console.log(">>> PHASE 3 PASSED: PAIR IS SECURE.");

    // --- PHASE 4: CONFIGURATION ---
    console.log("\n>>> PHASE 4: TECHNICAL INTEGRATION (Config Gen)");

    const configObj = await generateConfig(selected.tokenA, selected.tokenB);

    console.log("\nProposed Config Entry:");
    console.log(JSON.stringify(configObj, null, 4));

    const confirm = await askQuestion("\nAppend this to config.json? (y/n): ");

    if (confirm.toLowerCase() === 'y') {
        const configPath = path.join(__dirname, '../config.json');
        const currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        // Prevent duplicates
        const exists = currentConfig.PAIRS.some(p => p.name === configObj.name);
        if (exists) {
            console.log("Pair already exists in config.json. Skipping append.");
        } else {
            currentConfig.PAIRS.push(configObj);
            fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 4));
            console.log("Successfully updated config.json!");
        }
    } else {
        console.log("Skipped config update.");
    }

    // --- PHASE 5: VALIDATION ---
    console.log("\n>>> PHASE 5: VALIDATION (Instructions)");
    console.log("The pipeline is complete. To validate this pair:");
    console.log("1. Run the bot in Monitor Mode:");
    console.log("   node bot.js");
    console.log("2. After 6-12 hours, run analysis:");
    console.log("   node analyze_logs.js");
    console.log("3. Look for 'Net Profit > 0' events.");

    process.exit(0);
}

main().catch(console.error);
