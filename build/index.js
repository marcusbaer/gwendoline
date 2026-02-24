#!/usr/bin/env node
import { argv } from "node:process";
import readline from "node:readline";
import * as fs from "fs";
import path from "node:path";
import { Ollama } from "ollama";
import availableTools from "./tools.js";
import MCPClient from "./mcp.js";
import { agent_system_prompt, system_prompt } from "./prompts.js";
const LLM_MODEL_LOCAL = "qwen3:4b";
const LLM_MODEL_CLOUD = "gpt-oss:120b-cloud";
const isCloudLLM = argv.includes("--cloud");
const hasAgentSpecified = argv.includes("--agent");
const hasLLMSpecified = argv.includes("--model");
const useMcp = argv.includes("--mcp");
const isChatMode = argv.includes("--chat");
const isStreamMode = argv.includes("--stream");
const isThinkingMode = argv.includes("--thinking");
const isDebugMode = argv.includes("--debug");
let customAgentFile = "";
let customModelName = "";
if (hasAgentSpecified || hasLLMSpecified) {
    argv.forEach((val, index) => {
        if (val === "--agent") {
            customAgentFile = argv[index + 1];
        }
        if (val === "--model") {
            customModelName = argv[index + 1];
            console.error(`Using model ${customModelName}`);
        }
    });
}
function parseAgentYaml(fileContent) {
    // Extract YAML front matter between --- delimiters
    const yamlMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/m);
    if (!yamlMatch) {
        // No valid YAML front matter found
        return { metadata: {}, body: fileContent };
    }
    const yamlContent = yamlMatch[1];
    const body = yamlMatch[2] || "";
    const metadata = {};
    // Simple YAML parser: extract key: value pairs
    const lines = yamlContent.split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        // Match key: value patterns
        const match = trimmed.match(/^([a-zA-Z-_]+):\s*(.*)$/);
        if (match) {
            const [, key, value] = match;
            let parsedValue = value.trim();
            // Try to parse value
            // Handle quoted strings
            if ((parsedValue.startsWith("'") && parsedValue.endsWith("'")) ||
                (parsedValue.startsWith('"') && parsedValue.endsWith('"'))) {
                parsedValue = parsedValue.slice(1, -1);
            }
            // Handle arrays like ['item1', 'item2']
            else if (parsedValue.startsWith("[") && parsedValue.endsWith("]")) {
                try {
                    parsedValue = JSON.parse(parsedValue.replace(/'/g, '"'));
                }
                catch {
                    // Keep as string if parsing fails
                }
            }
            // Handle booleans
            else if (parsedValue === "true") {
                parsedValue = true;
            }
            else if (parsedValue === "false") {
                parsedValue = false;
            }
            // Handle numbers
            else if (/^\d+$/.test(parsedValue)) {
                parsedValue = parseInt(parsedValue, 10);
            }
            metadata[key] = parsedValue;
        }
    }
    return { metadata, body };
}
function loadAgent(agentFileName) {
    // Try to find AGENT.md in the current working directory, if nothing else specified
    const filePath = path.join(process.cwd(), agentFileName || "AGENT.md");
    if (fs.existsSync(filePath)) {
        try {
            const fileContent = fs.readFileSync(filePath, "utf-8");
            console.error(`✓ Using agent file ${agentFileName} from ${process.cwd()}`);
            if (!hasLLMSpecified) {
                customModelName = "qwen3:4b";
            }
            return parseAgentYaml(fileContent);
        }
        catch (error) {
            console.error(`✗ Error reading agent file:`, error);
            return { metadata: {}, body: "" };
        }
    }
    // Fall back to default
    return { metadata: {}, body: "" };
}
function loadSystemPrompt(asAgent = false) {
    // Try to find SYSTEM_PROMPT.md first in the current working directory
    const filePath = path.join(process.cwd(), "SYSTEM_PROMPT.md");
    if (fs.existsSync(filePath)) {
        try {
            const fileContent = fs.readFileSync(filePath, "utf-8");
            console.error(`✓ Using SYSTEM_PROMPT.md from ${process.cwd()}`);
            return fileContent;
        }
        catch (error) {
            console.error(`✗ Error reading SYSTEM_PROMPT.md:`, error);
            console.error(`Using default system prompt`);
            return system_prompt;
        }
    }
    if (asAgent) {
        return agent_system_prompt;
    }
    // Fall back to default system prompt
    return system_prompt;
}
async function main() {
    let input = "";
    // load agent first to optionally override custom model
    const agentConfig = loadAgent(customAgentFile);
    console.error(agentConfig.metadata);
    const mcpClient = useMcp ? await initializeMcpClient() : null;
    const systemPrompt = loadSystemPrompt(!!agentConfig.body);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
        input += chunk;
    });
    process.stdin.on("end", async () => {
        if (isChatMode) {
            try {
                const inputMessages = JSON.parse(input.trim() || "[]");
                const content = await runLLMRequest(inputMessages, isChatMode, mcpClient, systemPrompt, agentConfig.body);
                process.stdout.write(content);
                process.exit(0);
            }
            catch (error) {
                console.error("Could not parse input of chat messages:", error);
                process.exit(1);
            }
        }
        else {
            const content = await runLLMRequest([{ role: "user", content: input.trim() }], isChatMode, mcpClient, systemPrompt, agentConfig.body);
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
            mcpClient, systemPrompt, agentConfig.body);
            process.stdout.write(content);
            process.exit(0);
        });
    }
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
async function runLLMRequest(messages, returnChat = false, mcpClient, systemPrompt, agentPrompt) {
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
                    description: "Returns the actual current UTC time. Only use this if the user explicitly asks for the current real-world time/date or uses relative temporal expressions like 'now', 'today', or 'currently'. Never use for general knowledge. The assistant must never output meta commentary about tool usage or tool availability. Returns a JSON object with 'time' and 'timestamp'.",
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
        // Inject system prompt if not already present
        if (!messages.find((m) => m.role === "system")) {
            if (systemPrompt) {
                messages.unshift({
                    role: "system",
                    content: systemPrompt,
                });
            }
            if (agentPrompt) {
                messages.unshift({
                    role: "system",
                    content: agentPrompt || "",
                });
            }
        }
        const response = await ollama.chat({
            model: customModelName || LLM_MODEL,
            messages,
            // @ts-ignore
            stream: isAllowedToStream,
            think: isThinkingMode && isAllowedToStream,
            // logprobs: true,
            // @ts-ignore
            tools: allTools,
            tool_choice: "auto",
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
            let contentWithThinkTokensRemoved = response.message.content
                .replace(/<think>[\s\S]*?<\/think>/gi, "")
                .trim();
            contentWithThinkTokensRemoved = contentWithThinkTokensRemoved
                .replace(/[\s\S]*?<\/think>/gi, "")
                .trim();
            if (returnChat) {
                messages.push({
                    role: "assistant",
                    content: isThinkingMode
                        ? response.message.content
                        : contentWithThinkTokensRemoved,
                });
                const messagesStr = JSON.stringify(messages);
                return messagesStr.trim();
            }
            // @ts-ignore
            return isThinkingMode
                ? response.message.content
                : contentWithThinkTokensRemoved;
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
                console.error("\n================\n");
            }
            return await runLLMRequest(messages, isChatMode, mcpClient, systemPrompt, agentPrompt);
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
