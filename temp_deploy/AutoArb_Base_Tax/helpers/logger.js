const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../trade_logs.csv');

// Initialize header if file doesn't exist (or overwrite if we want to enforce new schema?)
// Let's just create it if missing, but we manually updated the file in previous steps so it exists.
// The user might want to clear it or we just append. 
// Ideally we'd migrate, but for now let's just use the current logic.
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
        'TaxPct', // New Column
        'Profitable',
        'Liquidity'
    ].join(',');
    fs.writeFileSync(LOG_FILE, headers + '\n');
}

/**
 * Appends a trade log entry to the CSV file.
 * @param {Object} data - The data object to log
 */
const writeTradeLog = (data) => {
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
        taxPct, // New Field
        profitable,
        liquidity
    } = data;

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

    fs.appendFileSync(LOG_FILE, row + '\n');
}

module.exports = {
    writeTradeLog
};
