require("dotenv").config();

const express = require("express");

const {
  Server
} = require("@modelcontextprotocol/sdk/server/index.js");

const {
  SSEServerTransport
} = require("@modelcontextprotocol/sdk/server/sse.js");

const {
  CallToolRequestSchema,
  ListToolsRequestSchema
} = require("@modelcontextprotocol/sdk/types.js");

const app = express();

const PORT = Number(process.env.PORT) || 3000;

const OPENWEATHER_API_KEY =
  process.env.OPENWEATHER_API_KEY;

/*
|--------------------------------------------------------------------------
| MCP SERVER
|--------------------------------------------------------------------------
*/

const server = new Server(
  {
    name: "openweather-mcp",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

/*
|--------------------------------------------------------------------------
| MCP SESSIONS
|--------------------------------------------------------------------------
|
| Each AEX connection gets its own SSE transport.
|
*/

const transports = new Map();

/*
|--------------------------------------------------------------------------
| LIST TOOLS
|--------------------------------------------------------------------------
*/

server.setRequestHandler(
  ListToolsRequestSchema,
  async () => {
    console.log("[MCP] tools/list");

    return {
      tools: [
        {
          name: "get_weather",

          description:
            "Get the current weather conditions for a city using OpenWeather.",

          inputSchema: {
            type: "object",

            properties: {
              city: {
                type: "string",
                description:
                  "City name, for example Delhi, London, Mumbai, or Tokyo."
              }
            },

            required: ["city"],

            additionalProperties: false
          }
        }
      ]
    };
  }
);

/*
|--------------------------------------------------------------------------
| CALL TOOL
|--------------------------------------------------------------------------
*/

server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {
    const {
      name,
      arguments: args = {}
    } = request.params;

    console.log(
      `[MCP] tools/call: ${name}`
    );

    if (name !== "get_weather") {
      return {
        isError: true,

        content: [
          {
            type: "text",
            text: `Unknown tool: ${name}`
          }
        ]
      };
    }

    /*
    |--------------------------------------------------------------------------
    | Validate city
    |--------------------------------------------------------------------------
    */

    const city =
      typeof args.city === "string"
        ? args.city.trim()
        : "";

    if (!city) {
      return {
        isError: true,

        content: [
          {
            type: "text",
            text:
              "The city parameter is required."
          }
        ]
      };
    }

    /*
    |--------------------------------------------------------------------------
    | Check API key
    |--------------------------------------------------------------------------
    */

    if (!OPENWEATHER_API_KEY) {
      console.error(
        "OPENWEATHER_API_KEY is missing."
      );

      return {
        isError: true,

        content: [
          {
            type: "text",
            text:
              "OPENWEATHER_API_KEY is not configured on the server."
          }
        ]
      };
    }

    /*
    |--------------------------------------------------------------------------
    | OpenWeather API
    |--------------------------------------------------------------------------
    */

    try {
      const url =
        "https://api.openweathermap.org/data/2.5/weather" +
        `?q=${encodeURIComponent(city)}` +
        `&appid=${encodeURIComponent(
          OPENWEATHER_API_KEY
        )}` +
        "&units=metric";

      console.log(
        `[Weather] Requesting weather for: ${city}`
      );

      const response = await fetch(url);

      let data;

      try {
        data = await response.json();
      } catch {
        return {
          isError: true,

          content: [
            {
              type: "text",
              text:
                "OpenWeather returned an invalid response."
            }
          ]
        };
      }

      /*
      |--------------------------------------------------------------------------
      | OpenWeather error
      |--------------------------------------------------------------------------
      */

      if (!response.ok) {
        console.error(
          "[OpenWeather Error]",
          data
        );

        return {
          isError: true,

          content: [
            {
              type: "text",
              text:
                `OpenWeather error: ${
                  data.message ||
                  response.statusText
                }`
            }
          ]
        };
      }

      /*
      |--------------------------------------------------------------------------
      | Format result
      |--------------------------------------------------------------------------
      */

      const weather =
        data.weather?.[0];

      const result = [
        `Weather in ${data.name}, ${
          data.sys?.country || ""
        }`,

        `Condition: ${
          weather?.description || "Unknown"
        }`,

        `Temperature: ${
          data.main?.temp ?? "N/A"
        }°C`,

        `Feels like: ${
          data.main?.feels_like ?? "N/A"
        }°C`,

        `Humidity: ${
          data.main?.humidity ?? "N/A"
        }%`,

        `Wind speed: ${
          data.wind?.speed ?? "N/A"
        } m/s`
      ].join("\n");

      console.log(
        `[Weather] Successfully retrieved weather for ${city}`
      );

      return {
        content: [
          {
            type: "text",
            text: result
          }
        ]
      };

    } catch (error) {
      console.error(
        "[Weather Error]",
        error
      );

      return {
        isError: true,

        content: [
          {
            type: "text",
            text:
              `Failed to retrieve weather: ${error.message}`
          }
        ]
      };
    }
  }
);

/*
|--------------------------------------------------------------------------
| ROOT / HEALTH
|--------------------------------------------------------------------------
*/

app.get("/", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "openweather-mcp",
    version: "1.0.0",
    mcpEndpoint: "/sse"
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "healthy"
  });
});

/*
|--------------------------------------------------------------------------
| SSE CONNECTION
|--------------------------------------------------------------------------
*/

app.get("/sse", async (req, res) => {
  console.log(
    "[SSE] New AEX connection"
  );

  try {
    const transport =
      new SSEServerTransport(
        "/messages",
        res
      );

    /*
    |--------------------------------------------------------------------------
    | Save session
    |--------------------------------------------------------------------------
    */

    transports.set(
      transport.sessionId,
      transport
    );

    console.log(
      `[SSE] Session created: ${transport.sessionId}`
    );

    /*
    |--------------------------------------------------------------------------
    | Cleanup when connection closes
    |--------------------------------------------------------------------------
    */

    res.on("close", async () => {
      console.log(
        `[SSE] Session closed: ${transport.sessionId}`
      );

      transports.delete(
        transport.sessionId
      );

      try {
        await transport.close();
      } catch {
        // Already closed.
      }
    });

    /*
    |--------------------------------------------------------------------------
    | Connect MCP
    |--------------------------------------------------------------------------
    */

    await server.connect(
      transport
    );

    console.log(
      `[SSE] MCP connection established: ${transport.sessionId}`
    );

  } catch (error) {
    console.error(
      "[SSE Error]",
      error
    );

    if (!res.headersSent) {
      res.status(500).json({
        error:
          "Unable to establish MCP SSE connection."
      });
    }
  }
});

/*
|--------------------------------------------------------------------------
| MCP MESSAGE ENDPOINT
|--------------------------------------------------------------------------
*/

app.post(
  "/messages",
  async (req, res) => {

    const sessionId =
      req.query.sessionId;

    if (!sessionId) {
      return res.status(400).send(
        "Missing sessionId."
      );
    }

    const transport =
      transports.get(
        String(sessionId)
      );

    if (!transport) {
      return res.status(400).send(
        "MCP session not found."
      );
    }

    try {
      await transport.handlePostMessage(
        req,
        res
      );

    } catch (error) {
      console.error(
        "[MCP Message Error]",
        error
      );

      if (!res.headersSent) {
        res.status(500).send(
          "Failed to process MCP message."
        );
      }
    }
  }
);

/*
|--------------------------------------------------------------------------
| 404
|--------------------------------------------------------------------------
*/

app.use(
  (_req, res) => {
    res.status(404).json({
      error: "Not found"
    });
  }
);

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

const httpServer =
  app.listen(
    PORT,
    "0.0.0.0",
    () => {

      console.log("");
      console.log(
        "================================"
      );
      console.log(
        "OpenWeather MCP Server"
      );
      console.log(
        "================================"
      );

      console.log(
        `Port: ${PORT}`
      );

      console.log(
        `Health: http://localhost:${PORT}/health`
      );

      console.log(
        `SSE: http://localhost:${PORT}/sse`
      );

      console.log(
        "================================"
      );

      console.log("");
    }
  );

/*
|--------------------------------------------------------------------------
| SHUTDOWN
|--------------------------------------------------------------------------
*/

async function shutdown(signal) {

  console.log(
    `${signal} received. Shutting down...`
  );

  for (
    const [
      sessionId,
      transport
    ]
    of transports
  ) {

    console.log(
      `Closing session: ${sessionId}`
    );

    try {
      await transport.close();
    } catch {
      // Ignore.
    }
  }

  transports.clear();

  httpServer.close(() => {
    console.log(
      "Server closed."
    );

    process.exit(0);
  });
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);