const axios = require('axios');

const sendAlert = async (message) => {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    try {
        await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (err) {
        console.error("Telegram Alert Failed:", err.message);
    }
};

module.exports = { sendAlert };
