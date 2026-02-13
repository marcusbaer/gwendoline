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
  private transports: Array<
    StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport
  > = [];
  private tools: Tool[] = [];
  private connectedClients: Client[] = [];

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
      for (const id in servers) {
        const def = servers[id];
        const { type } = def;
        const client = new Client({
          name: `mcp-client-${id}`,
          version: "1.0.0",
        });

        try {
          if (type === "stdio") {
            await this.connectToStdioServer(
              client,
              def.command,
              def.args || [],
            );
          } else if (type === "http" || type === "sse") {
            await this.connectToHttpServer(client, def.url);
          }

          // Sammle Tools von diesem Server
          await this.listTools(client);

          // Speichere den Client für später (optional für tool calls)
          this.connectedClients.push(client);
        } catch (e) {
          console.error(`Error connecting to server ${id}:`, e);
          // Fahre mit dem nächsten Server fort
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
      this.transports.push(transport);
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
      this.transports.push(transport);
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
        this.transports.push(transport);
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
    const newTools = toolsResult.tools.map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      };
    });
    this.tools.push(...newTools);
    console.log(
      "Connected to server with tools:",
      newTools.map(({ name }) => name),
    );
  }

  getTools() {
    return this.tools;
  }

  async callTool(name: string, toolArguments: any) {
    // Try each connected client until one succeeds
    for (const client of this.connectedClients) {
      try {
        const result = await client.callTool({
          name,
          arguments: toolArguments,
        });
        return result;
      } catch (e) {
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
