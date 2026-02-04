const ethers = require("ethers")

/**
 * SIMULATE SWAP
 * Uses eth_call to simulate the transaction and get the actual return value (Tax Aware).
 */
async function simulateSwap(exchange, tokenIn, tokenOut, amountIn, recipient, fee = 3000) {
    const router = exchange.router
    // Use the provider attached to the router contract
    const provider = router.runner
    let method, params

    try {
        if (exchange.name === "Aerodrome V2") {
            // V2 Style: swapExactTokensForTokens
            method = 'swapExactTokensForTokens'
            // params: amountIn, amountOutMin, path, to, deadline
            const path = [tokenIn.address, tokenOut.address]
            const amountOutMin = 0 // Simulation, we just want to know the result
            const deadline = Math.floor(Date.now() / 1000) + 60

            params = [amountIn, amountOutMin, path, recipient, deadline]

        } else if (exchange.name === "Uniswap V3") {
            // V3 Style: exactInputSingle
            method = 'exactInputSingle'
            // params: ExactInputSingleParams struct
            // (tokenIn, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96)

            // Note: Uniswap Router V3 `exactInputSingle` takes a Tuple (Object)
            // But we need to use the ABI definition format. 
            // Initialization.js uses ISwapRouter.abi via require.

            // The simulation needs the specific fee tier. 
            // We should pass fee or get it from config for this pair.
            // For now, let's assume 3000 (0.3%) as per config default.
            // Better: update function signature to accept fee.

            params = [{
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                fee: fee,
                recipient: recipient,
                deadline: Math.floor(Date.now() / 1000) + 60,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            }]
        }

        // Encode
        const txData = await router.interface.encodeFunctionData(method, params)

        // Call
        const result = await provider.call({
            to: router.target,
            data: txData,
            from: recipient // Impersonate our bot (recipient is arb contract)
        })

        // Decode
        const decoded = router.interface.decodeFunctionResult(method, result)

        // V2 returns amounts[] (last item is out)
        if (exchange.name === "Aerodrome V2") {
            const amounts = decoded[0]
            return amounts[amounts.length - 1]
        }

        // V3 returns amountOut (uint256)
        if (exchange.name === "Uniswap V3") {
            return decoded[0]
        }

    } catch (e) {
        // console.error(`Simulation Failed [${exchange.name}]:`, e.message.slice(0, 50))
        return null // Failed simulation (revert)
    }
}

module.exports = {
    simulateSwap
}
