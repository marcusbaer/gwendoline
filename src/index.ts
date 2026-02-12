#!/usr/bin/env node

import { argv } from "node:process";
import readline from "node:readline";

import { Ollama } from "ollama";

const LLM_MODEL_LOCAL = "qwen3:4b";
const LLM_MODEL_CLOUD = "gpt-oss:120b-cloud";

const isCloudLLM = argv.includes("--cloud");
const hasLLMSpecified = argv.includes("--model");
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
    const content = await runLLMRequest(input.trim());
    process.stdout.write(content);
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

      const content = await runLLMRequest(prompt);
      process.stdout.write(content);
      process.exit(1);
    });
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

async function runLLMRequest(prompt = "") {
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
    const response = await ollama.chat({
      model: customModelName || LLM_MODEL,
      messages: [{ role: "user", content: prompt }],
    });

    return response.message.content;
  } catch (e) {
    return `Error: ${e}`;
  }
}
