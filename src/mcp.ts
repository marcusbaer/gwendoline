import path from "node:path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

// https://modelcontextprotocol.io/docs/develop/build-client#typescript

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
  private connectedClients: Map<string, Client> = new Map();
  private toolRegistry: Map<string, string> = new Map(); // toolName -> serverId
  private serverInstructions: Map<string, string> = new Map(); // serverId -> instructions
  private tools: Tool[] = [];
  private ollama: any;
  private model: string;

  constructor(ollama: any, model: string) {
    this.ollama = ollama;
    this.model = model;
  }

  async readMcpJson() {
    const filePath = path.join(__dirname, "../build/mcp.json");
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const mcpJson = JSON.parse(fileContent);

    if (mcpJson) {
      const { servers } = mcpJson;

      for (const serverId in servers) {
        const def = servers[serverId];
        const { type } = def;

        try {
          // Create a new Client for each server
          const client = new Client({
            name: `mcp-client-${serverId}`,
            version: "1.0.0",
          });

          // Connect to the server
          if (type === "stdio") {
            await this.connectToStdioServer(
              client,
              serverId,
              def.command,
              def.args || [],
            );
          } else if (type === "http" || type === "sse") {
            await this.connectToHttpServer(client, serverId, def.url);
          }

          // List and collect tools from this server
          await this.listTools(client, serverId);

          // List and collect resources/instructions from this server
          await this.listResources(client, serverId);

          // Store the client
          this.connectedClients.set(serverId, client);
          console.error(`✓ Connected to MCP server: ${serverId}`);
        } catch (e) {
          console.error(`✗ Error connecting to server ${serverId}:`, e);
          // Continue with next server (graceful failure)
        }
      }

      if (this.connectedClients.size === 0) {
        throw new Error("No MCP servers could be connected");
      }
    }
  }

  private async connectToStdioServer(
    client: Client,
    serverId: string,
    command: string,
    args: string[],
  ) {
    try {
      const transport = new StdioClientTransport({
        command,
        args,
      });
      await client.connect(transport);
    } catch (e) {
      console.error(`Failed to connect to stdio MCP server ${serverId}:`, e);
      throw e;
    }
  }

  private async connectToHttpServer(
    client: Client,
    serverId: string,
    url: string,
  ) {
    try {
      // Try StreamableHTTPClientTransport first (modern and recommended)
      const transport = new StreamableHTTPClientTransport(new URL(url));
      await client.connect(transport);
      console.error(
        `Successfully connected to HTTP server ${serverId} via StreamableHTTPClientTransport`,
      );
    } catch (e) {
      console.error(
        `Failed to connect via StreamableHTTPClientTransport for ${serverId}, falling back to SSEClientTransport`,
      );
      try {
        // Fallback to SSEClientTransport for servers that still use SSE
        const transport = new SSEClientTransport(new URL(url));
        await client.connect(transport);
        console.error(
          `Successfully connected to HTTP server ${serverId} via SSEClientTransport`,
        );
      } catch (fallbackError) {
        console.error(
          `Failed to connect to HTTP MCP server ${serverId} with both transports:`,
          fallbackError,
        );
        throw fallbackError;
      }
    }
  }

  private async listTools(client: Client, serverId: string) {
    try {
      const toolsResult = await client.listTools();
      const serverTools = toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));

      // Register tools with their server
      for (const tool of serverTools) {
        this.toolRegistry.set(tool.name, serverId);
        this.tools.push(tool);
      }

      console.error(
        `  Tools from ${serverId}: ${serverTools.map((t) => t.name).join(", ")}`,
      );
    } catch (e) {
      console.warn(`Could not list tools from server ${serverId}:`, e);
    }
  }

  private async listResources(client: Client, serverId: string) {
    try {
      const resourcesResult = await client.listResources();
      const resources = resourcesResult.resources || [];

      // Look for instructions resource
      for (const resource of resources) {
        if (
          resource.name.includes("instruction") ||
          resource.mimeType?.includes("text")
        ) {
          try {
            const readResult = await client.readResource({
              uri: resource.uri,
            });
            const contents = readResult.contents || [];
            const instructionText = contents
              .map((c: any) => c.text || "")
              .join("\n");

            if (instructionText.trim()) {
              this.serverInstructions.set(serverId, instructionText);
              console.error(`  Instructions loaded from ${serverId}`);
            }
          } catch (e) {
            console.warn(
              `Could not read resource ${resource.uri} from server ${serverId}:`,
              e,
            );
          }
        }
      }
    } catch (e) {
      console.warn(`Could not list resources from server ${serverId}:`, e);
      // This is optional, so don't throw
    }
  }

  getTools() {
    return this.tools;
  }

  getServerInstructions(): string {
    let instructions = "";

    for (const [serverId, instructionText] of this.serverInstructions) {
      instructions += `\n=== MCP Server: ${serverId} ===\n${instructionText}\n`;
    }

    return instructions;
  }

  async callTool(toolName: string, toolArguments: any): Promise<any> {
    // Find which server has this tool
    const serverId = this.toolRegistry.get(toolName);

    if (!serverId) {
      throw new Error(`Tool ${toolName} not found in any MCP server`);
    }

    const client = this.connectedClients.get(serverId);
    if (!client) {
      throw new Error(
        `Server ${serverId} (providing tool ${toolName}) is not connected`,
      );
    }

    try {
      const result = await client.callTool({
        name: toolName,
        arguments: toolArguments,
      });
      return result;
    } catch (e) {
      throw new Error(
        `Error calling tool ${toolName} on server ${serverId}: ${e}`,
      );
    }
  }

  async cleanup() {
    for (const [serverId, client] of this.connectedClients) {
      try {
        await client.close();
        console.error(`Closed connection to ${serverId}`);
      } catch (e) {
        console.warn(`Error closing connection to ${serverId}:`, e);
      }
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
