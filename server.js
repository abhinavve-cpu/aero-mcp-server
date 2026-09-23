/**
 * Local MCP (Model Context Protocol) Server for Aero Agent System
 * Transports: SSE (Server-Sent Events) & Standard HTTP POST
 * Exposes: Calendar Context & SQLite Expense Ledger Context
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Mock SQLite / Context Databases
const calendarDatabase = [
    { employee_id: "EMP1001", date: "2026-10-15", status: "AVAILABLE", conflicts: [] },
    { employee_id: "EMP1001", date: "2026-10-20", status: "BUSY", conflicts: [{ title: "Strategy Sync", time: "10:00 - 12:00 IST" }] }
];

const expenseLedgerDatabase = {
    "EMP1001": {
        active_trip_id: "TRIP-2026-DEL",
        base_currency: "INR",
        daily_meals_spent: 2400.00,
        daily_meals_cap: 5000.00,
        daily_lodging_spent: 8500.00,
        daily_lodging_cap: 12000.00
    }
};

// ==========================================
// 1. MCP SSE ENDPOINT (For AEX Gateway)
// ==========================================
app.get('/mcp/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial MCP handshake event
    res.write(`data: ${JSON.stringify({
        jsonrpc: "2.0",
        method: "mcp/initialize",
        params: { protocolVersion: "2026-01-15", serverName: "Aero_Local_MCP_Server" }
    })}\n\n`);

    req.on('close', () => {
        console.log('AEX Studio disconnected from MCP SSE stream.');
    });
});

// ==========================================
// 2. MCP TOOL HANDLERS (POST Endpoints)
// ==========================================

// Tool 1: Check Calendar Availability
app.post('/mcp/calendar', (req, res) => {
    const { employee_id = "EMP1001", travel_date = "2026-10-15" } = req.body;

    const matched = calendarDatabase.find(
        item => item.employee_id === employee_id && item.date === travel_date
    ) || { employee_id, date: travel_date, status: "AVAILABLE", conflicts: [] };

    res.json({
        status: "SUCCESS",
        mcp_protocol: "2026-01-15",
        context: {
            employee_id,
            date_queried: travel_date,
            is_clear_for_travel: matched.status === "AVAILABLE",
            conflicting_events: matched.conflicts
        }
    });
});

// Tool 2: Query Expense Ledger
app.post('/mcp/expense-ledger', (req, res) => {
    const { employee_id = "EMP1001" } = req.body;
    const record = expenseLedgerDatabase[employee_id] || expenseLedgerDatabase["EMP1001"];

    res.json({
        status: "SUCCESS",
        mcp_protocol: "2026-01-15",
        source: "LOCAL_SQLITE_MCP",
        ledger_record: record
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(` Aero Local MCP Server running on http://localhost:${PORT}`);
    console.log(` MCP SSE Stream: http://localhost:${PORT}/mcp/sse`);
    console.log(`==================================================\n`);
});