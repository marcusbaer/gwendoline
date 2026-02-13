import path from "node:path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
// https://modelcontextprotocol.io/docs/develop/build-client#typescript
const mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory
class MCPClient {
    mcp;
    ollama;
    model;
    transports = [];
    tools = [];
    connectedClients = [];
    constructor(ollama, model) {
        this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
        this.ollama = ollama;
        this.model = model;
    }
    async readMcpJson() {
        const filePath = path.join(__dirname, "../build/mcp.json");
        const fileContent = fs.readFileSync(filePath, "utf-8");
        const mcpJson = JSON.parse(fileContent);
        if (mcpJson) {
            const { servers } = mcpJson;
            for (const id in servers) {
                const def = servers[id];
                const { type } = def;
                const client = new Client({
                    name: `mcp-client-${id}`,
                    version: "1.0.0",
                });
                try {
                    if (type === "stdio") {
                        await this.connectToStdioServer(client, def.command, def.args || []);
                    }
                    else if (type === "http" || type === "sse") {
                        await this.connectToHttpServer(client, def.url);
                    }
                    // Sammle Tools von diesem Server
                    await this.listTools(client);
                    // Speichere den Client für später (optional für tool calls)
                    this.connectedClients.push(client);
                }
                catch (e) {
                    console.error(`Error connecting to server ${id}:`, e);
                    // Fahre mit dem nächsten Server fort
                }
            }
        }
    }
    async connectToStdioServer(client, command, args) {
        try {
            const transport = new StdioClientTransport({
                command,
                args,
            });
            this.transports.push(transport);
            await client.connect(transport);
        }
        catch (e) {
            console.log("Failed to connect to stdio MCP server: ", e);
            throw e;
        }
    }
    async connectToHttpServer(client, url) {
        try {
            // Try StreamableHTTPClientTransport first (modern and recommended)
            const transport = new StreamableHTTPClientTransport(new URL(url));
            this.transports.push(transport);
            await client.connect(transport);
            console.log(`Successfully connected to HTTP server via StreamableHTTPClientTransport: ${url}`);
        }
        catch (e) {
            console.log(`Failed to connect via StreamableHTTPClientTransport, falling back to SSEClientTransport: ${e}`);
            try {
                // Fallback to SSEClientTransport for servers that still use SSE
                const transport = new SSEClientTransport(new URL(url));
                this.transports.push(transport);
                await client.connect(transport);
                console.log(`Successfully connected to HTTP server via SSEClientTransport: ${url}`);
            }
            catch (fallbackError) {
                console.log("Failed to connect to HTTP MCP server with both transports: ", fallbackError);
                throw fallbackError;
            }
        }
    }
    async listTools(client) {
        const toolsResult = await (client || this.mcp).listTools();
        const newTools = toolsResult.tools.map((tool) => {
            return {
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema,
            };
        });
        this.tools.push(...newTools);
        console.log("Connected to server with tools:", newTools.map(({ name }) => name));
    }
    getTools() {
        return this.tools;
    }
    async callTool(name, toolArguments) {
        // Try each connected client until one succeeds
        for (const client of this.connectedClients) {
            try {
                const result = await client.callTool({
                    name,
                    arguments: toolArguments,
                });
                return result;
            }
            catch (e) {
                // Tool not found in this client, try next
                continue;
            }
        }
        // If no client succeeded, throw error
        throw new Error(`Tool ${name} not found in any connected MCP server`);
    }
    async cleanup() {
        for (const client of this.connectedClients) {
            await client.close();
        }
    }
}
export default MCPClient;
