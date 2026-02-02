const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'trade_logs.csv');

const analyze = () => {
    if (!fs.existsSync(LOG_FILE)) {
        console.log("No log file found. Run the bot first to generate data.");
        return;
    }

    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() !== '');

    if (lines.length <= 1) {
        console.log("Log file is empty (only headers found).");
        return;
    }

    const headers = lines[0].split(',');
    // Timestamp,Pair,Direction,UniswapPrice,CamelotPrice,PriceDiffPct,TradeAmountBase,GrossProfitBase,GasCostBase,NetProfitBase,Profitable

    const stats = {};

    // Helper to unquote CSV values
    const clean = (val) => val ? val.replace(/"/g, '') : '';

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(clean);
        if (cols.length < headers.length) continue;

        const pair = cols[1];
        const netProfit = parseFloat(cols[9]);
        const priceDiff = Math.abs(parseFloat(cols[5]));
        const grossProfit = parseFloat(cols[7]);

        if (!stats[pair]) {
            stats[pair] = {
                'Count': 0,
                'Gross > 0 (Near Miss)': 0,
                'Profitable (>0)': 0,
                'Target (>0.02)': 0,
                'Avg Net': 0,
                'Max Spread %': 0
            };
        }

        const s = stats[pair];
        s['Count']++;

        if (grossProfit > 0) s['Gross > 0 (Near Miss)']++;
        if (netProfit > 0) s['Profitable (>0)']++;
        if (netProfit >= 0.02) s['Target (>0.02)']++;

        // Running totals
        s['Avg Net'] += netProfit;
        if (priceDiff > s['Max Spread %']) s['Max Spread %'] = priceDiff;
    }

    // Finalize averages
    const tableData = {};
    for (const pair in stats) {
        const s = stats[pair];
        tableData[pair] = {
            'Events': s['Count'],
            'Gross > 0': s['Gross > 0 (Near Miss)'],
            'Net > 0': s['Profitable (>0)'],
            'Gasbound': s['Gross > 0 (Near Miss)'] - s['Profitable (>0)'],
            'Target (>0.02)': s['Target (>0.02)'],
            'Avg Net Profit': (s['Avg Net'] / s['Count']).toFixed(6),
            'Max Spread %': s['Max Spread %'].toFixed(4) + '%'
        };
    }

    console.log(`\nAnalysis of ${lines.length - 1} events:\n`);
    console.table(tableData);
};

analyze();
