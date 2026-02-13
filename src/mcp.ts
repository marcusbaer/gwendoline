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

interface Tool {
  name: string;
  description?: string;
  input_schema?: any;
}

interface MessageParam {
  role: string;
  content: string;
}

class MCPClient {
  public mcp: Client;
  private ollama: any;
  private model: string;
  private transport:
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | SSEClientTransport
    | null = null;
  private tools: Tool[] = [];

  constructor(ollama: any, model: string) {
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
      let isFirstServer = true;

      for (const id in servers) {
        const def = servers[id];
        const { type } = def;

        try {
          // Use this.mcp for the first server
          if (isFirstServer) {
            if (type === "stdio") {
              await this.connectToStdioServer(
                this.mcp,
                def.command,
                def.args || [],
              );
            } else if (type === "http" || type === "sse") {
              await this.connectToHttpServer(this.mcp, def.url);
            }
            await this.listTools(this.mcp);
            isFirstServer = false;
          } else {
            // Skip other servers (MCP Client can only connect to one server)
            console.log(
              `Skipping server ${id}: MCP Client can only connect to one server at a time. Using first server only.`,
            );
          }
        } catch (e) {
          console.error(`Error connecting to server ${id}:`, e);
          if (isFirstServer) {
            throw e; // Re-throw if first server fails
          }
        }
      }
    }
  }

  async connectToStdioServer(client: Client, command: string, args: []) {
    try {
      const transport = new StdioClientTransport({
        command,
        args,
      });
      this.transport = transport;
      await client.connect(transport);
    } catch (e) {
      console.log("Failed to connect to stdio MCP server: ", e);
      throw e;
    }
  }

  async connectToHttpServer(client: Client, url: string) {
    try {
      // Try StreamableHTTPClientTransport first (modern and recommended)
      const transport = new StreamableHTTPClientTransport(new URL(url));
      this.transport = transport;
      await client.connect(transport);
      console.log(
        `Successfully connected to HTTP server via StreamableHTTPClientTransport: ${url}`,
      );
    } catch (e) {
      console.log(
        `Failed to connect via StreamableHTTPClientTransport, falling back to SSEClientTransport: ${e}`,
      );
      try {
        // Fallback to SSEClientTransport for servers that still use SSE
        const transport = new SSEClientTransport(new URL(url));
        this.transport = transport;
        await client.connect(transport);
        console.log(
          `Successfully connected to HTTP server via SSEClientTransport: ${url}`,
        );
      } catch (fallbackError) {
        console.log(
          "Failed to connect to HTTP MCP server with both transports: ",
          fallbackError,
        );
        throw fallbackError;
      }
    }
  }

  async listTools(client?: Client) {
    const toolsResult = await (client || this.mcp).listTools();
    this.tools = toolsResult.tools.map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      };
    });
    console.log(
      "Connected to server with tools:",
      this.tools.map(({ name }) => name),
    );
  }

  getTools() {
    return this.tools;
  }

  async cleanup() {
    if (this.transport) {
      await this.mcp.close();
    }
  }

  // async processQuery(query: string) {
  //   const messages: MessageParam[] = [
  //     {
  //       role: "user",
  //       content: query,
  //     },
  //   ];

  //   const response = await this.ollama.chat({
  //     model: this.model,
  //     messages,
  //     stream: false,
  //     think: false,
  //     tools: this.tools,
  //   });

  //   // const response = await this.anthropic.messages.create({
  //   //   model: "claude-sonnet-4-20250514",
  //   //   max_tokens: 1000,
  //   //   messages,
  //   //   tools: this.tools,
  //   // });

  //   const finalText = [];

  //   for (const content of response.content) {
  //     if (content.type === "text") {
  //       finalText.push(content.text);
  //     } else if (content.type === "tool_use") {
  //       const toolName = content.name;
  //       const toolArgs = content.input as { [x: string]: unknown } | undefined;

  //       const result = await this.mcp.callTool({
  //         name: toolName,
  //         arguments: toolArgs,
  //       });
  //       finalText.push(
  //         `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`,
  //       );

  //       messages.push({
  //         role: "user",
  //         content: result.content as string,
  //       });

  //       // const response = await this.anthropic.messages.create({
  //       //   model: "claude-sonnet-4-20250514",
  //       //   max_tokens: 1000,
  //       //   messages,
  //       // });

  //       finalText.push(
  //         response.content[0].type === "text" ? response.content[0].text : "",
  //       );
  //     }
  //   }

  //   return finalText.join("\n");
  // }
}

export default MCPClient;
