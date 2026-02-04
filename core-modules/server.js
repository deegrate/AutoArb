const express = require('express')
const path = require('path')
const http = require('http')
const cors = require('cors')
const fs = require('fs')

// SERVER CONFIG
const PORT = process.env.PORT || 6065
const app = express();
const server = http.createServer(app);

server.listen(PORT, () => {
    console.log(`Listening on ${PORT}\n`);
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} in use, dashboard server skipped (already running in another instance).`);
    } else {
        console.error("Server Error:", e);
    }
});
app.use(express.static(path.join(__dirname, '../public')))

const supabase = require('./supabaseClient');
require('dotenv').config();

// API Routes
app.get('/api/logs', async (req, res) => {
    try {
        const clientId = req.query.clientId || process.env.CLIENT_ID || 'admin';
        const { data, error } = await supabase
            .from('trades')
            .select('*')
            .eq('client_id', clientId)
            .eq('agent', 'guard') // Arbitrum Guard
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error("Supabase Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// New Endpoint: Base Predator Logs
app.get('/api/logs/base', async (req, res) => {
    try {
        const clientId = req.query.clientId || process.env.CLIENT_ID || 'admin';
        const { data, error } = await supabase
            .from('trades')
            .select('*')
            .eq('client_id', clientId)
            .eq('agent', 'predator') // Base Predator
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error("Supabase Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ADMIN API Routes
// Phase 1: Global Performance Header
app.get('/api/admin/stats', async (req, res) => {
    try {
        // Fetch all trades to calculate aggregate stats
        // Note: For production with 1000+ bots, this should be a Supabase RPC call.
        // For MVP, handling 1000s of rows in Node is acceptable.
        const { data, error } = await supabase
            .from('trades')
            .select('amount_in, pnl_percent, net_profit, l1_gas_fee, l2_gas_fee, status');

        if (error) throw error;

        let totalAUM = 0;
        let totalYield = 0;
        let tradeCount = 0;
        let totalNetProfit = 0;
        let totalL1Gas = 0;

        data.forEach(t => {
            // AUM: Sum of amount_in
            if (t.amount_in) totalAUM += parseFloat(t.amount_in);

            // Yield: Avg pnl_percent
            if (t.pnl_percent !== null) {
                totalYield += parseFloat(t.pnl_percent);
                tradeCount++;
            }

            // Gas Efficiency: sum(net_profit) / sum(l1_gas_fee)
            // Only count if status is success to avoid skewing with failed gas burnt but no profit? 
            // User formula implies general efficiency. We'll sum all.
            if (t.net_profit) totalNetProfit += parseFloat(t.net_profit);
            if (t.l1_gas_fee) totalL1Gas += parseFloat(t.l1_gas_fee);
        });

        const avgYield = tradeCount > 0 ? (totalYield / tradeCount).toFixed(4) : "0.00";
        const gasEfficiency = totalL1Gas > 0 ? (totalNetProfit / totalL1Gas).toFixed(2) : "0.00";

        res.json({
            total_fleet_aum: totalAUM.toFixed(4),
            system_wide_yield: avgYield,
            gas_efficiency_index: gasEfficiency,
            total_trades: data.length
        });

    } catch (err) {
        console.error("Admin Stats Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Phase 3: Global KillSwitch
app.use(express.json()); // Ensure JSON body parsing
app.post('/api/admin/toggle', async (req, res) => {
    try {
        const { clientId, isActive } = req.body;

        // Upsert config (if not exists, create)
        const { data, error } = await supabase
            .from('bot_configs')
            .upsert({ client_id: clientId, is_active: isActive, updated_at: new Date() })
            .select();

        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        console.error("Link Toggle Error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/logs', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('trades')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100); // Global Tape Limit

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error("Supabase Error:", err);
        res.status(500).json({ error: err.message });
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