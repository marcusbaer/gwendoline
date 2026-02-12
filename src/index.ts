#!/usr/bin/env node

import { argv } from "node:process";
import readline from "node:readline";

import { Ollama } from "ollama";

import MCPClient from "./mcp.js";

const LLM_MODEL_LOCAL = "qwen3:4b";
const LLM_MODEL_CLOUD = "gpt-oss:120b-cloud";

const isCloudLLM = argv.includes("--cloud");
const hasLLMSpecified = argv.includes("--model");
const useMcp = argv.includes("--mcp");
const isChatMode = argv.includes("--chat");
const isStreamMode: boolean = argv.includes("--stream");
const isThinkingMode: boolean = argv.includes("--thinking");

interface ChatMessage {
  role: string;
  content: string;
}

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
  let mcpClient = null;

  if (useMcp) {
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
      await mcpClient.readMcpJson();
      // await mcpClient.processQuery("Why is the sky blue?");
      // await mcpClient.chatLoop();
    } catch (e) {
      console.error("Error:", e);
      await mcpClient.cleanup();
      process.exit(1);
      // } finally {
      //   await mcpClient.cleanup();
      //   process.exit(0);
    }
  }

  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (chunk) => {
    input += chunk;
  });

  process.stdin.on("end", async () => {
    if (isChatMode) {
      try {
        const inputMessages = JSON.parse(input.trim() || "[]");
        const content = await runLLMRequest(
          inputMessages,
          isChatMode,
          mcpClient,
        );
        process.stdout.write(content);
      } catch (error) {
        throw Error("Could not parse input of chat messages", error || "");
      }
    } else {
      const content = await runLLMRequest(
        [{ role: "user", content: input.trim() }],
        isChatMode,
        mcpClient,
      );
      process.stdout.write(content);
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
        process.exit(1);
      }

      const content = await runLLMRequest(
        [{ role: "user", content: prompt }],
        false, // chat mode not supported with user input interface
        mcpClient,
      );
      process.stdout.write(content);
      process.exit(1);
    });
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

async function runLLMRequest(
  messages: ChatMessage[],
  returnChat = false,
  mcpClient = null,
) {
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
    const response = await ollama.chat({
      model: customModelName || LLM_MODEL,
      messages,
      // @ts-ignore
      stream: isAllowedToStream,
      think: isAllowedToStream && isThinkingMode,
      // @ts-ignore
      tools: mcpClient ? mcpClient.tools || [] : [],
    });

    if (isAllowedToStream) {
      for await (const chunk of response) {
        if (isThinkingMode && chunk?.message?.thinking) {
          process.stdout.write(chunk.message.thinking);
        }
        if (chunk?.message?.content) {
          process.stdout.write(chunk.message.content);
        }
      }

      return "";
    } else {
      if (returnChat) {
        messages.push({
          role: "assistant",
          // @ts-ignore
          content: response.message.content,
        });

        const messagesStr = JSON.stringify(messages);
        return messagesStr.trim();
      }

      // @ts-ignore
      return response.message.content;
    }
  } catch (e) {
    return `Error: ${e}`;
  }
}
