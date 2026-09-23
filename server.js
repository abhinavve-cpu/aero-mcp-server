/**
 * MCP (Model Context Protocol) Server for Aero Agent System
 * Supported Transports:
 *  1. Streamable HTTP / JSON-RPC 2.0 (POST /mcp/messages)
 *  2. Server-Sent Events / SSE (GET /mcp/sse)
 *  3. REST Tool Fallbacks (POST /mcp/calendar, POST /mcp/expense-ledger)
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

// =================================================================
// 1. STREAMABLE HTTP / JSON-RPC 2.0 TRANSPORT (POST /mcp/messages)
// =================================================================
app.post('/mcp/messages', (req, res) => {
    // Enable HTTP Streaming headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');

    const { jsonrpc, id, method, params } = req.body;

    // Handle MCP Handshake
    if (method === 'initialize') {
        const response = {
            jsonrpc: "2.0",
            id: id || 1,
            result: {
                protocolVersion: "2026-01-15",
                capabilities: { tools: {} },
                serverInfo: { name: "Aero_Render_MCP_Server", version: "1.0.0" }
            }
        };
        return res.send(JSON.stringify(response));
    }

    // Handle Tool Listing Requests
    if (method === 'tools/list') {
        const response = {
            jsonrpc: "2.0",
            id: id || 1,
            result: {
                tools: [
                    {
                        name: "check_calendar_availability",
                        description: "Check if an employee is clear to travel on a given date",
                        inputSchema: {
                            type: "object",
                            properties: {
                                employee_id: { type: "string" },
                                travel_date: { type: "string" }
                            },
                            required: ["employee_id", "travel_date"]
                        }
                    },
                    {
                        name: "query_expense_records",
                        description: "Fetch daily expense caps and current spending from corporate ledger",
                        inputSchema: {
                            type: "object",
                            properties: {
                                employee_id: { type: "string" }
                            },
                            required: ["employee_id"]
                        }
                    }
                ]
            }
        };
        return res.send(JSON.stringify(response));
    }

    // Handle Tool Calls (tools/call)
    if (method === 'tools/call') {
        const toolName = params?.name;
        const args = params?.arguments || {};

        if (toolName === 'check_calendar_availability') {
            const empId = args.employee_id || "EMP1001";
            const travelDate = args.travel_date || "2026-10-15";
            const matched = calendarDatabase.find(
                item => item.employee_id === empId && item.date === travelDate
            ) || { employee_id: empId, date: travelDate, status: "AVAILABLE", conflicts: [] };

            const response = {
                jsonrpc: "2.0",
                id: id || 1,
                result: {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                employee_id: empId,
                                date_queried: travelDate,
                                is_clear_for_travel: matched.status === "AVAILABLE",
                                conflicting_events: matched.conflicts
                            })
                        }
                    ]
                }
            };
            return res.send(JSON.stringify(response));
        }

        if (toolName === 'query_expense_records') {
            const empId = args.employee_id || "EMP1001";
            const record = expenseLedgerDatabase[empId] || expenseLedgerDatabase["EMP1001"];

            const response = {
                jsonrpc: "2.0",
                id: id || 1,
                result: {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(record)
                        }
                    ]
                }
            };
            return res.send(JSON.stringify(response));
        }
    }

    // Default Unknown Method Error
    return res.status(400).json({
        jsonrpc: "2.0",
        id: id || null,
        error: { code: -32601, message: "Method not found" }
    });
});

// ==========================================
// 2. MCP SSE TRANSPORT (GET /mcp/sse)
// ==========================================
app.get('/mcp/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Broadcast endpoint binding event
    res.write(`event: endpoint\ndata: /mcp/messages\n\n`);

    res.write(`data: ${JSON.stringify({
        jsonrpc: "2.0",
        method: "mcp/initialize",
        params: { protocolVersion: "2026-01-15", serverName: "Aero_Render_MCP_Server" }
    })}\n\n`);

    req.on('close', () => {
        console.log('AEX Studio disconnected from MCP SSE stream.');
    });
});

// ==========================================
// 3. LEGACY REST FALLBACKS (POST Endpoints)
// ==========================================
app.post('/mcp/calendar', (req, res) => {
    const { employee_id = "EMP1001", travel_date = "2026-10-15" } = req.body;
    const matched = calendarDatabase.find(
        item => item.employee_id === employee_id && item.date === travel_date
    ) || { employee_id, date: travel_date, status: "AVAILABLE", conflicts: [] };

    res.json({
        status: "SUCCESS",
        context: {
            employee_id,
            date_queried: travel_date,
            is_clear_for_travel: matched.status === "AVAILABLE",
            conflicting_events: matched.conflicts
        }
    });
});

app.post('/mcp/expense-ledger', (req, res) => {
    const { employee_id = "EMP1001" } = req.body;
    const record = expenseLedgerDatabase[employee_id] || expenseLedgerDatabase["EMP1001"];

    res.json({
        status: "SUCCESS",
        ledger_record: record
    });
});

// Health check root
app.get('/', (req, res) => {
    res.json({
        service: "aero-mcp-server",
        status: "ok",
        transports: ["streamable-http", "sse", "rest"],
        endpoints: ["/mcp/messages", "/mcp/sse", "/mcp/calendar", "/mcp/expense-ledger"]
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(` Aero Streamable MCP Server running on port ${PORT}`);
    console.log(` Streamable Endpoint: POST http://localhost:${PORT}/mcp/messages`);
    console.log(` SSE Stream: GET http://localhost:${PORT}/mcp/sse`);
    console.log(`==================================================\n`);
});