
const supabase = require('../helpers/supabaseClient');

const testData = {
    agent: 'guard',
    chain: 'arbitrum',
    pair: 'TEST/ETH',
    type: 'arbitrage', // Testing if 'arbitrage' is accepted, schema says TEXT
    amount_in: 1.5,
    amount_out: 1.55,
    pnl_percent: 3.33,
    l1_gas_fee: 0,
    l2_gas_fee: 0.002,
    status: 'test_insert'
};

console.log("Attempting to write test log to Supabase (User Schema)...");

supabase
    .from('trades')
    .insert(testData)
    .then(({ data, error }) => {
        if (error) {
            console.error("Insert Failed:", error);
            process.exit(1);
        } else {
            console.log("Insert Success! Data:", data);
            process.exit(0);
        }
    })
    .catch(err => {
        console.error("Test Script Error:", err);
        process.exit(1);
    });
