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
                const content = await runLLMRequest(inputMessages, isChatMode, mcpClient);
                process.stdout.write(content);
                process.exit(0);
            }
            catch (error) {
                console.error("Could not parse input of chat messages:", error);
                process.exit(1);
            }
        }
        else {
            const content = await runLLMRequest([{ role: "user", content: input.trim() }], isChatMode, mcpClient);
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
            mcpClient);
            process.stdout.write(content);
            process.exit(0);
        });
    }
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
async function runLLMRequest(messages, returnChat = false, mcpClient) {
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
                    name: "internalUtcTime",
                    description: "Get current UTC time. Returns a JSON object with 'time' and 'timestamp'.",
                    parameters: {
                        type: "object",
                        properties: {},
                        required: [],
                    },
                },
            },
        ];
        const allTools = mcpTools
            ? [...internalTools, ...formattedMcpTools]
            : internalTools;
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
            if (isDebugMode) {
                console.error("[DEBUG] EXECUTE TOOL_CALLS:");
                console.error(JSON.stringify(tool_calls, null, 2));
            }
            // Helper function to create structured error messages for the LLM
            function createToolErrorMessage(toolName, args, error) {
                // Extract meaningful error information
                let errorMessage = "Unknown error";
                let errorDetails = "";
                if (error?.message) {
                    errorMessage = error.message;
                }
                else if (typeof error === "string") {
                    errorMessage = error;
                }
                // Try to extract validation errors (e.g., missing required parameters)
                if (errorMessage.includes("Invalid arguments")) {
                    const match = errorMessage.match(/\[([^\]]+)\]/);
                    if (match) {
                        try {
                            const validationErrors = JSON.parse(match[0]);
                            if (Array.isArray(validationErrors)) {
                                errorDetails = validationErrors
                                    .map((e) => `- Parameter '${e.path?.join(".")}': ${e.message} (expected: ${e.expected})`)
                                    .join("\n");
                            }
                        }
                        catch (e) {
                            // Could not parse validation errors
                        }
                    }
                }
                return `Tool '${toolName}' failed with error: ${errorMessage}${errorDetails ? "\n\nParameter issues:\n" + errorDetails : ""}\n\nProvided arguments: ${JSON.stringify(args, null, 2)}\n\nPlease check the tool parameters and try again with corrected values.`;
            }
            for (const tool of tool_calls) {
                if (isDebugMode) {
                    console.error(`\n[DEBUG] Calling function: ${tool.function.name}`, "with arguments:", tool.function.arguments);
                }
                const args = typeof tool.function.arguments === "string"
                    ? JSON.parse(tool.function.arguments)
                    : tool.function.arguments;
                let output;
                const toolName = tool.function.name;
                // Try internal tools first
                // @ts-ignore
                if (availableTools[toolName]) {
                    try {
                        // @ts-ignore
                        const result = availableTools[toolName](args);
                        // Extract content from internal tool result (same format as MCP)
                        if (result.content && Array.isArray(result.content)) {
                            output = result.content
                                .map((c) => c.text || JSON.stringify(c))
                                .join("\n");
                        }
                        else {
                            output = JSON.stringify(result);
                        }
                    }
                    catch (e) {
                        output = createToolErrorMessage(toolName, args, e);
                        if (!isChatMode) {
                            console.warn(`Error calling internal tool ${toolName} with args:`, JSON.stringify(args, null, 2), "\nError:", e);
                        }
                    }
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
                        output = createToolErrorMessage(toolName, args, e);
                        if (!isChatMode) {
                            console.warn(`Error calling MCP tool ${toolName} with args:`, JSON.stringify(args, null, 2), "\nError:", e);
                        }
                    }
                }
                else {
                    output = `Tool '${toolName}' not found. Available tools: ${Object.keys(availableTools).join(", ")}${mcpClient ? " and MCP tools" : ""}`;
                    if (!isChatMode) {
                        console.warn("Function", toolName, "not found");
                    }
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
            return await runLLMRequest(messages, isChatMode, mcpClient);
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
        }
        catch (e) {
            console.error("Error initializing MCP client:", e);
            try {
                await mcpClient.cleanup();
            }
            catch (cleanupError) {
                console.error("Error during MCP cleanup:", cleanupError);
            }
            // Don't reject - continue without MCP and let the application run
            resolve(null);
        }
    });
}
