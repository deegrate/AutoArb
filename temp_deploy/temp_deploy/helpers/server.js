const express = require('express')
const path = require('path')
const http = require('http')
const cors = require('cors')
const fs = require('fs')

// SERVER CONFIG
const PORT = process.env.PORT || 6065
const app = express();
const server = http.createServer(app).listen(PORT, () => console.log(`Listening on ${PORT}\n`))
app.use(express.static(path.join(__dirname, '../public')))

// API Routes
app.get('/api/logs', (req, res) => {
    const logPath = path.join(__dirname, '../trade_logs.csv');
    if (fs.existsSync(logPath)) {
        res.sendFile(logPath);
    } else {
        res.status(404).json({ error: "No logs found yet" });
    }
});

// Explicit Root Route for Debugging
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, '../public/index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send(`Dashboard (index.html) not found. Looked locally at: ${indexPath}`);
    }
});
app.use(cors({ credentials: true, origin: '*' }))