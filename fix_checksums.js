const ethers = require('ethers');

const addresses = [
    "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" // New cbBTC
];

// User provided:
// DEGEN: 0x4ed4E2b9aacA7d13F59673509212553364669d8d
// Error log says: 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed
// Wait, the error log says "Failed to setup pair DEGEN_WETH: bad address checksum ... value="0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed".
// That means I WROTE `0x4ed4E862...` in config?
// Let's check what I wrote in Step 264 (AutoArb_Base_Tax/config.json).
// I wrote: "baseToken": "0x4ed4E2b9aacA7d13F59673509212553364669d8d" for DEGEN.
// Wait, the error log `0x4ed4E862...` does NOT match `0x4ed4E2...`.
// Where did `0x4ed4E862...` come from?
// Ah, did I misread the error log or the config?

// Let's verify what I wrote to the file via read_file first.
// But the script is to FIX casing.

addresses.forEach(addr => {
    try {
        console.log(`${addr} -> ${ethers.getAddress(addr)}`);
    } catch (e) {
        try {
            console.log(`${addr} ->(RECOVERED) ${ethers.getAddress(addr.toLowerCase())}`);
        } catch (e2) {
            console.error(`${addr} -> INVALID: ${e2.message}`);
        }
    }
});
