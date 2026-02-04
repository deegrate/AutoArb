const https = require('https');

// Configuration
const BATCH_SIZE = 30; // Pairs per request if supported, or just iterating tokens
const MIN_LIQUIDITY = 50000; // $50k
const MIN_VOLUME = 100000; // $100k
const MIN_AGE_HOURS = 24;

// Trusted Base Assets (Arbitrum)
const TARGET_TOKENS = [
    "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC
    "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // USDC.e
    "0x912CE59144191C1204E64559FE8253a0e49E6548", // ARB
    "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f"  // WBTC
];

// Targeted DEXs
const TARGET_DEXS = ['uniswap', 'camelot'];

async function fetchDexScreenerPairs(tokenAddress) {
    return new Promise((resolve, reject) => {
        const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;

        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.pairs) resolve(json.pairs);
                    else resolve([]);
                } catch (e) {
                    console.error("Error parsing JSON", e);
                    resolve([]);
                }
            });
        }).on('error', (e) => {
            console.error(`Request error: ${e.message}`);
            resolve([]);
        });
    });
}

const main = async () => {
    console.log("--- STARTING ANALYTICAL SCREENER (TRACK B) ---");
    console.log(`Criteria: Liq > $${MIN_LIQUIDITY}, Vol > $${MIN_VOLUME}, Age > ${MIN_AGE_HOURS}h`);

    let allPairs = [];
    const processedTokens = new Set();

    // 1. Fetch Pairs for all Trusted Tokens
    for (const token of TARGET_TOKENS) {
        if (processedTokens.has(token)) continue;
        processedTokens.add(token);

        console.log(`Fetching pairs for ${token}...`);
        const pairs = await fetchDexScreenerPairs(token);
        allPairs = allPairs.concat(pairs);

        // Respect API rate limits
        await new Promise(r => setTimeout(r, 1500));
    }

    console.log(`\nTotal Raw Pairs Found: ${allPairs.length}`);

    // 2. Filter & Organize
    const groupedPairs = {};

    for (const p of allPairs) {
        // Filter by Chain (Arbitrum)
        if (p.chainId !== 'arbitrum') continue;

        // Filter by DEX (Uniswap / Camelot)
        // DexScreener might label Camelot V3 as "camelot" or "camelot-v3"
        // Uniswap as "uniswap" (v3 usually implied or labeled)
        const dexId = p.dexId.toLowerCase();
        if (!dexId.includes('uniswap') && !dexId.includes('camelot')) continue;

        // Filter by Liquidity
        if (p.liquidity.usd < MIN_LIQUIDITY) continue;

        // Filter by Volume
        if (p.volume.h24 < MIN_VOLUME) continue;

        // Filter by Age
        if (p.pairCreatedAt) {
            const ageHours = (Date.now() - p.pairCreatedAt) / (1000 * 60 * 60);
            if (ageHours < MIN_AGE_HOURS) continue;
        }

        // Generate Pair Key (TokenA-TokenB sorted/consistent)
        // DexScreener provides baseToken and quoteToken
        const t0 = p.baseToken.address.toLowerCase();
        const t1 = p.quoteToken.address.toLowerCase();
        const key = t0 < t1 ? `${t0}-${t1}` : `${t1}-${t0}`;

        if (!groupedPairs[key]) {
            groupedPairs[key] = {
                tokens: {
                    [t0]: p.baseToken.symbol,
                    [t1]: p.quoteToken.symbol
                },
                uniswap: [],
                camelot: []
            };
        }

        if (dexId.includes('uniswap')) groupedPairs[key].uniswap.push(p);
        if (dexId.includes('camelot')) groupedPairs[key].camelot.push(p);
    }

    // 3. Identify Twin Pairs & Calculate Liquidity Ratio
    console.log("\n--- TWIN PAIR CANDIDATES ---");

    let candidates = [];

    for (const [key, group] of Object.entries(groupedPairs)) {
        if (group.uniswap.length > 0 && group.camelot.length > 0) {

            // Get best pool for each (highest liquidity)
            const uPool = group.uniswap.sort((a, b) => b.liquidity.usd - a.liquidity.usd)[0];
            const cPool = group.camelot.sort((a, b) => b.liquidity.usd - a.liquidity.usd)[0];

            const totalLiq = uPool.liquidity.usd + cPool.liquidity.usd;
            const uRatio = (uPool.liquidity.usd / totalLiq) * 100;
            const cRatio = (cPool.liquidity.usd / totalLiq) * 100;

            // Score: Fragmentation. 
            // 50/50 is low arbitrage potential (prices stay synced easily).
            // 90/10 is High potential (price lag).
            // We want uneven distribution BUT not 100/0 (which is filtered out by 'Twin' check).
            // Actually, SOP says "Fragmentation suggests high arbitrage potential". 
            // "If Uniswap holds 90% and Camelot 10%... high potential".

            const symbols = `${uPool.baseToken.symbol}/${uPool.quoteToken.symbol}`;

            candidates.push({
                symbols,
                key, // address key
                uAddress: uPool.pairAddress,
                cAddress: cPool.pairAddress,
                uLiq: uPool.liquidity.usd,
                cLiq: cPool.liquidity.usd,
                ratioStr: `Uni: ${uRatio.toFixed(1)}% / Cam: ${cRatio.toFixed(1)}%`,
                fragmentationScore: Math.abs(uRatio - cRatio) // Higher diff = more fragmented? 
                // Wait, 90-10 vs 50-50. 
                // 90-10 diff is 80. 
                // 50-50 diff is 0. 
                // So higher diff = more dominance by one side.
                // SOP: "If Uniswap holds 90%... this fragmentation suggests high arb potential".
                // So we want HIGH difference.
            });
        }
    }

    // Sort by Fragmentation Score (Descending) -> Most skewed pairs first
    candidates.sort((a, b) => b.fragmentationScore - a.fragmentationScore);

    // Output
    if (candidates.length === 0) {
        console.log("No candidates found matching all criteria.");
    } else {
        console.table(candidates.slice(0, 10).map(c => ({
            Pair: c.symbols,
            "Liquidity Ratio": c.ratioStr,
            "Uni Liq": `$${(c.uLiq / 1000).toFixed(1)}k`,
            "Cam Liq": `$${(c.cLiq / 1000).toFixed(1)}k`,
            "Uni Addr": c.uAddress,
            "Cam Addr": c.cAddress
        })));

        console.log("\n--- NEXT STEPS ---");
        console.log("1. Pick a candidate from above.");
        console.log("2. Run Security Check: node scripts/security.js <TOKEN_ADDRESS>");
        console.log("3. Generate Config:    node scripts/config_gen.js <TOKEN_A> <TOKEN_B>");
    }
}

main();
