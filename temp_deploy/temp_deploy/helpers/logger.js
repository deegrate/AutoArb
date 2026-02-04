const fs = require('fs');
const path = require('path');

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
        'GasCostBase', // Using Base token for uniformity if possible, usually Gas is ETH. Let's log in ETH/Native to be clear.
        'NetProfitBase',
        'TaxPct',
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
        gasCostEth, // Keeping track of gas in ETH is usually better, but for net profit calculation we converted to Base.
        // Let's rely on what the bot calculates.
        netProfitBase,
        taxPct,
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
    ].map(val => `"${val}"`).join(','); // Quote values to handle potential commas

    fs.appendFileSync(LOG_FILE, row + '\n');
}

module.exports = {
    writeTradeLog
};
