#!/usr/bin/env node

import { argv } from "node:process";
import readline from "node:readline";

import { Ollama } from "ollama";
import availableTools from "./tools.js";

const LLM_MODEL_LOCAL = "qwen3:4b";
const LLM_MODEL_CLOUD = "gpt-oss:120b-cloud";

const isCloudLLM = argv.includes("--cloud");
const hasLLMSpecified = argv.includes("--model");
const isChatMode = argv.includes("--chat");
const isStreamMode: boolean = argv.includes("--stream");
const isThinkingMode: boolean = argv.includes("--thinking");

interface ChatMessage {
  role: string;
  content: string;
  tool_name?: string;
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

  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (chunk) => {
    input += chunk;
  });

  process.stdin.on("end", async () => {
    if (isChatMode) {
      try {
        const inputMessages = JSON.parse(input.trim() || "[]");
        const content = await runLLMRequest(inputMessages, isChatMode);
        process.stdout.write(content);
      } catch (error) {
        throw Error("Could not parse input of chat messages", error || "");
      }
    } else {
      const content = await runLLMRequest(
        [{ role: "user", content: input.trim() }],
        isChatMode,
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

async function runLLMRequest(messages: ChatMessage[], returnChat = false) {
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
      // logprobs: true,
      tools: [
        {
          type: "function",
          function: {
            name: "getConditions",
            description: "Get the weather conditions for a city",
            parameters: {
              type: "object",
              required: ["city"],
              properties: {
                city: { type: "string", description: "The name of the city" },
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
                city: { type: "string", description: "The name of the city" },
              },
            },
          },
        },
      ],
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
          executeToolsCalls(messages, chunk?.message?.tool_calls);
        }
      }

      return "";
    } else {
      const { tool_calls } = response.message;
      if (tool_calls) {
        executeToolsCalls(messages, tool_calls);
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

    async function executeToolsCalls(
      messages: ChatMessage[],
      tool_calls: any[],
    ) {
      // console.log(JSON.stringify(tool_calls, null, 2));
      for (const tool of tool_calls) {
        // console.log(
        //   "\nCalling function:",
        //   tool.function.name,
        //   "with arguments:",
        //   tool.function.arguments,
        // );
        const args =
          typeof tool.function.arguments === "string"
            ? JSON.parse(tool.function.arguments)
            : tool.function.arguments;
        if (availableTools[tool.function.name]) {
          const output = availableTools[tool.function.name](args);
          // console.log("> Function output:", output, "\n");

          messages.push({
            role: "tool",
            content: output.toString(),
            tool_name: tool.function.name,
          });
        } else if (!isChatMode) {
          console.warn("Function", tool.function.name, "not found");
        }
      }

      if (messages.some((msg) => msg.role === "tool")) {
        // run LLM again for final answer, based on tools output
        const response = await ollama.chat({
          model: customModelName || LLM_MODEL,
          messages,
          // @ts-ignore
          stream: isAllowedToStream,
          think: isAllowedToStream && isThinkingMode,
          // logprobs: true,

          // tools: [], // ignore tools here to reduce complexity
        });

        if (returnChat) {
          messages.push({
            role: "assistant",
            content: response.message.content,
          });

          const messagesStr = JSON.stringify(messages);
          return messagesStr.trim();
        }

        return response.message.content;
      }
    }
  } catch (e) {
    return `Error: ${e}`;
  }
}
