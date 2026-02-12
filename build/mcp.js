import path from "node:path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// https://modelcontextprotocol.io/docs/develop/build-client#typescript
const mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory
class MCPClient {
    mcp;
    ollama;
    model;
    transport = null;
    tools = [];
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
                if (type === "stdio") {
                    await this.connectToServer(def.command, def.args || []);
                }
                // TODO: support of http/sse
            }
            // here needed to load tools
            this.listTools();
        }
    }
    async connectToServer(command, args) {
        try {
            const transport = new StdioClientTransport({
                command,
                args,
            });
            await this.mcp.connect(transport);
        }
        catch (e) {
            console.log("Failed to connect to MCP server: ", e);
            throw e;
        }
    }
    async listTools() {
        const toolsResult = await this.mcp.listTools();
        this.tools = toolsResult.tools.map((tool) => {
            return {
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema,
            };
        });
        console.log("Connected to server with tools:", this.tools.map(({ name }) => name));
    }
    getTools() {
        return this.tools;
    }
    async cleanup() {
        await this.mcp.close();
    }
    async processQuery(query) {
        const messages = [
            {
                role: "user",
                content: query,
            },
        ];
        const response = await this.ollama.chat({
            model: this.model,
            messages,
            stream: false,
            think: false,
            tools: this.tools,
        });
        // const response = await this.anthropic.messages.create({
        //   model: "claude-sonnet-4-20250514",
        //   max_tokens: 1000,
        //   messages,
        //   tools: this.tools,
        // });
        const finalText = [];
        for (const content of response.content) {
            if (content.type === "text") {
                finalText.push(content.text);
            }
            else if (content.type === "tool_use") {
                const toolName = content.name;
                const toolArgs = content.input;
                const result = await this.mcp.callTool({
                    name: toolName,
                    arguments: toolArgs,
                });
                finalText.push(`[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`);
                messages.push({
                    role: "user",
                    content: result.content,
                });
                // const response = await this.anthropic.messages.create({
                //   model: "claude-sonnet-4-20250514",
                //   max_tokens: 1000,
                //   messages,
                // });
                finalText.push(response.content[0].type === "text" ? response.content[0].text : "");
            }
        }
        return finalText.join("\n");
    }
}
export default MCPClient;
