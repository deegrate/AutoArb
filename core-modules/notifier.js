const axios = require('axios');

/**
 * Sends a Telegram alert.
 * @param {string} message - The message to send.
 * @param {string} [productName] - Optional product name to prefix (e.g., "ARB-GUARD").
 */
const sendAlert = async (message, productName) => {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    let finalMessage = message;
    if (productName) {
        finalMessage = `[${productName}] ${message}`;
    }

    try {
        await axios.post(url, {
            chat_id: chatId,
            text: finalMessage,
            parse_mode: 'Markdown'
        });
    } catch (err) {
        console.error("Telegram Alert Failed:", err.message);
    }
};

module.exports = { sendAlert };
