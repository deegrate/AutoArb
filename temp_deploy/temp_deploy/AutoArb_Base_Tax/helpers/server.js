const express = require('express')
const path = require('path')
const http = require('http')
const cors = require('cors')

// SERVER CONFIG
const fs = require('fs');

// SERVER CONFIG
const PORT = process.env.PORT || 6064
const app = express();
const server = http.createServer(app).listen(PORT, () => console.log(`Listening on ${PORT}\n`))

// Serve static files from ../public (since we are in helpers/)
app.use(express.static(path.join(__dirname, '../public')))
app.use(cors({ credentials: true, origin: '*' }))

// API Routes
app.get('/api/logs', (req, res) => {
    const logPath = path.join(__dirname, '../trade_logs.csv');
    if (fs.existsSync(logPath)) {
        res.sendFile(logPath);
    } else {
        res.status(404).json({ error: "No logs found yet" });
    }
});

app.get('/api/status', (req, res) => {
    res.json({ block: global.latestBlock || 0, timestamp: Date.now() });
});