try {
    const abi = require('./helpers/abi')
    console.log("Keys:", Object.keys(abi))
    console.log("Aerodrome:", abi.IAerodromeV2Pool ? "Found" : "Missing")
} catch (e) {
    console.error("Require failed:", e)
}
