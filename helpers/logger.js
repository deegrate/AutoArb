const fs = require('fs');
const path = require('path');
const supabase = require('./supabaseClient');

const LOG_FILE = path.join(__dirname, '../trade_logs.csv');

// Initialize header if file doesn't exist
if (!fs.existsSync(LOG_FILE)) {
    const headers = [
        'Timestamp',
        'Pair',
        'Direction',
        'UniswapPrice',
        'CamelotPrice',
        'PriceDiffPct',
        'TradeAmountBase',
        'GrossProfitBase',
        'GasCostBase',
        'NetProfitBase',
        'TaxPct',
        'Profitable',
        'Liquidity'
    ].join(',');
    fs.writeFileSync(LOG_FILE, headers + '\n');
}

/**
 * Appends a trade log entry to the CSV file AND Supabase.
 * @param {Object} data - The data object to log
 */
const writeTradeLog = async (data) => {
    const {
        timestamp,
        pair,
        direction,
        uniswapPrice,
        camelotPrice,
        priceDiffPct,
        tradeAmountBase,
        grossProfitBase,
        gasCostEth,
        netProfitBase,
        taxPct,
        profitable,
        liquidity
    } = data;

    // CSV Logging
    const row = [
        timestamp,
        pair,
        direction,
        uniswapPrice,
        camelotPrice,
        priceDiffPct,
        tradeAmountBase,
        grossProfitBase,
        gasCostEth,
        netProfitBase,
        taxPct !== undefined ? taxPct : '0',
        profitable,
        liquidity !== undefined ? liquidity : 'N/A'
    ].map(val => `"${val}"`).join(',');

    try {
        fs.appendFileSync(LOG_FILE, row + '\n');
    } catch (err) {
        console.error("Error writing to CSV:", err);
    }

    // Supabase Logging
    try {
        const amountIn = parseFloat(tradeAmountBase) || 0;
        const grossProfit = parseFloat(grossProfitBase) || 0;
        const amountOut = amountIn + grossProfit;

        const { error } = await supabase
            .from('trades')
            .insert({
                client_id: process.env.CLIENT_ID || 'admin',
                agent: 'guard',
                chain: 'arbitrum',
                pair: pair,
                type: 'arbitrage',
                amount_in: amountIn,
                amount_out: amountOut,
                pnl_percent: parseFloat(priceDiffPct) || 0,
                l1_gas_fee: 0,
                l2_gas_fee: parseFloat(gasCostEth) || 0,
                net_profit: parseFloat(netProfitBase) || 0,
                status: profitable ? 'success' : 'failed'
            });

        if (error) {
            console.error('Supabase Insert Error:', error);
        }
    } catch (dbErr) {
        console.error('Supabase DB Error:', dbErr);
    }
}

module.exports = {
    writeTradeLog
};
