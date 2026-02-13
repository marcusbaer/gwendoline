#!/usr/bin/env node
import { argv } from "node:process";
import readline from "node:readline";
import { Ollama } from "ollama";
import availableTools from "./tools.js";
import MCPClient from "./mcp.js";
const LLM_MODEL_LOCAL = "qwen3:4b";
const LLM_MODEL_CLOUD = "gpt-oss:120b-cloud";
const isCloudLLM = argv.includes("--cloud");
const hasLLMSpecified = argv.includes("--model");
const useMcp = argv.includes("--mcp");
const isChatMode = argv.includes("--chat");
const isStreamMode = argv.includes("--stream");
const isThinkingMode = argv.includes("--thinking");
const isDebugMode = argv.includes("--debug");
let customModelName = "";
if (hasLLMSpecified) {
    argv.forEach((val, index) => {
        if (val === "--model") {
            customModelName = argv[index + 1];
            console.log(`Using model ${customModelName}`);
        }
    });
}
async function main() {
    let input = "";
    const mcpClient = useMcp ? await initializeMcpClient() : null;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
        input += chunk;
    });
    process.stdin.on("end", async () => {
        if (isChatMode) {
            try {
                const inputMessages = JSON.parse(input.trim() || "[]");
                const content = await runLLMRequest(inputMessages, isChatMode, mcpClient, false);
                process.stdout.write(content);
            }
            catch (error) {
                throw Error("Could not parse input of chat messages", error || "");
            }
        }
        else {
            const content = await runLLMRequest([{ role: "user", content: input.trim() }], isChatMode, mcpClient, false);
            process.stdout.write(content);
            process.exit(0);
        }
    });
    if (process.stdin.isTTY) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        rl.question(`Type your prompt!\n\n`, async (prompt) => {
            rl.close();
            if (prompt == "/bye") {
                process.stdout.write("Bye!");
                process.exit(0);
            }
            const content = await runLLMRequest([{ role: "user", content: prompt }], false, // chat mode not supported with user input interface
            mcpClient, false);
            process.stdout.write(content);
            process.exit(0);
        });
    }
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
async function runLLMRequest(messages, returnChat = false, mcpClient, ignoreTools = false) {
    const LLM_MODEL = isCloudLLM ? LLM_MODEL_CLOUD : LLM_MODEL_LOCAL;
    try {
        const ollama = new Ollama({
            // host: "http://127.0.0.1:11434",
            headers: {
                //   Authorization: "Bearer <api key>",
                //   "X-Custom-Header": "custom-value",
                "User-Agent": "Gwendoline/0.0",
            },
        });
        const isAllowedToStream = !isChatMode && isStreamMode;
        const mcpTools = mcpClient ? mcpClient.getTools() || [] : [];
        // Integrate server instructions into the prompt if this is the first message
        if (mcpClient && messages.length === 1) {
            const serverInstructions = mcpClient.getServerInstructions();
            if (serverInstructions) {
                messages[0].content = `[MCP Server Instructions]\n${serverInstructions}\n\n[User Request]\n${messages[0].content}`;
            }
        }
        // Convert MCP tools to Ollama format
        const formattedMcpTools = mcpTools.map((tool) => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description || "",
                parameters: tool.input_schema || {
                    type: "object",
                    properties: {},
                },
            },
        }));
        const internalTools = [
            {
                type: "function",
                function: {
                    name: "getConditions",
                    description: "Get the weather conditions for a city",
                    parameters: {
                        type: "object",
                        required: ["city"],
                        properties: {
                            city: {
                                type: "string",
                                description: "The name of the city",
                            },
                        },
                    },
                },
            },
            {
                type: "function",
                function: {
                    name: "getTemperature",
                    description: "Get the temperature for a city in Celsius",
                    parameters: {
                        type: "object",
                        required: ["city"],
                        properties: {
                            city: {
                                type: "string",
                                description: "The name of the city",
                            },
                        },
                    },
                },
            },
        ];
        const allTools = [...internalTools, ...formattedMcpTools];
        const response = await ollama.chat({
            model: customModelName || LLM_MODEL,
            messages,
            // @ts-ignore
            stream: isAllowedToStream,
            think: isThinkingMode && isAllowedToStream,
            // logprobs: true,
            // @ts-ignore
            tools: allTools,
        });
        if (isAllowedToStream) {
            for await (const chunk of response) {
                if (isThinkingMode && chunk?.message?.thinking) {
                    process.stdout.write(chunk.message.thinking);
                }
                if (chunk?.message?.content) {
                    process.stdout.write(chunk.message.content);
                }
                if (chunk?.message?.tool_calls) {
                    if (isDebugMode)
                        console.error(`[DEBUG] Requesting TOOL_CALLS:`, JSON.stringify(chunk?.message?.tool_calls, null, 2));
                    const toolsCallAnswer = await executeToolsCalls(messages, chunk?.message?.tool_calls, mcpClient);
                    return toolsCallAnswer;
                }
            }
            return "";
        }
        else {
            const { tool_calls } = response.message;
            if (tool_calls) {
                const toolsCallAnswer = await executeToolsCalls(messages, tool_calls, mcpClient);
                return toolsCallAnswer;
            }
            if (returnChat) {
                messages.push({
                    role: "assistant",
                    content: response.message.content,
                });
                const messagesStr = JSON.stringify(messages);
                return messagesStr.trim();
            }
            // @ts-ignore
            return response.message.content;
        }
        async function executeToolsCalls(messages, tool_calls, mcpClient) {
            // console.log("EXECUTE TOOL_CALLS");
            // console.log(JSON.stringify(tool_calls, null, 2));
            for (const tool of tool_calls) {
                // console.log(
                //   "\nCalling function:",
                //   tool.function.name,
                //   "with arguments:",
                //   tool.function.arguments,
                // );
                const args = typeof tool.function.arguments === "string"
                    ? JSON.parse(tool.function.arguments)
                    : tool.function.arguments;
                let output;
                const toolName = tool.function.name;
                // Try internal tools first
                // @ts-ignore
                if (availableTools[toolName]) {
                    // @ts-ignore
                    output = availableTools[toolName](args);
                }
                // Then try MCP tools
                else if (mcpClient) {
                    try {
                        const result = await mcpClient.callTool(toolName, args);
                        if (isDebugMode)
                            console.error(`[DEBUG] Raw MCP result for ${toolName}:`, JSON.stringify(result, null, 2));
                        // Extract content from MCP result
                        if (result.content && Array.isArray(result.content)) {
                            output = result.content
                                .map((c) => c.text || JSON.stringify(c))
                                .join("\n");
                        }
                        else {
                            output = JSON.stringify(result);
                        }
                        if (isDebugMode)
                            console.error(`[DEBUG] Extracted output for ${toolName}:`, output);
                    }
                    catch (e) {
                        output = `Error calling MCP tool: ${e}`;
                        if (!isChatMode) {
                            console.warn("Error calling MCP tool", toolName, ":", e);
                        }
                    }
                }
                else if (!isChatMode) {
                    output = `Function ${toolName} not found`;
                    console.warn("Function", toolName, "not found");
                }
                messages.push({
                    role: "tool",
                    content: output.toString ? output.toString() : JSON.stringify(output),
                    tool_name: toolName,
                });
                // Debug: Log what we're pushing to messages
                if (isDebugMode)
                    console.error(`[DEBUG] Message content for ${toolName}:`, output.toString ? output.toString() : JSON.stringify(output));
            }
            // run LLM again for final answer, based on tools output
            if (!isChatMode && isAllowedToStream) {
                console.log("\n================\n");
            }
            return await runLLMRequest(messages, isChatMode, mcpClient, true);
        }
    }
    catch (e) {
        return `Error: ${e}`;
    }
}
async function initializeMcpClient() {
    return new Promise(async (resolve, reject) => {
        let mcpClient = null;
        const ollama = new Ollama({
            // host: "http://127.0.0.1:11434",
            headers: {
                //   Authorization: "Bearer <api key>",
                //   "X-Custom-Header": "custom-value",
                "User-Agent": "Gwendoline/0.0",
            },
        });
        const LLM_MODEL = isCloudLLM ? LLM_MODEL_CLOUD : LLM_MODEL_LOCAL;
        mcpClient = new MCPClient(ollama, customModelName || LLM_MODEL);
        try {
            const tools = await mcpClient.readMcpJson();
            resolve(mcpClient);
            // await mcpClient.processQuery("Why is the sky blue?");
            // await mcpClient.chatLoop();
        }
        catch (e) {
            console.error("Error:", e);
            await mcpClient.cleanup();
            resolve(mcpClient);
            // process.exit(1);
            // } finally {
            //   await mcpClient.cleanup();
            //   process.exit(0);
        }
    });
}
