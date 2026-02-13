# Gwendoline

Gwendoline is a CLI based tool for interacting with language models directly from your terminal, allowing you to send prompts and receive responses via standard input and output.

It is using Ollama and some LLMs as default:

- `qwen3:4b` for local usage
- `gpt-oss:120b-cloud` for usage with a cloud model

## Dependencies

Gwendoline depends on [Ollama](https://ollama.com/) as a local runtime for language models. By default, it uses the `qwen3:4b` model for local processing via Ollama, and the `gpt-oss:120b-cloud` model for cloud-based requests. Both models are preconfigured and need to be installed with Ollama.

Anyway, an **alternative model** can be specified as CLI parameter to override the defaults.

## Installation

```sh
npm install -g gwendoline
```

## Usage

Use `gwendoline` or `gwen` on CLI to run.

Some examples of how to run it:

```sh
gwen

echo "Why is the sky blue?" | gwen

cat prompt.md | gwen
cat prompt.md | gwen --cloud
cat prompt.md | gwen --mcp
cat prompt.md | gwen --model gpt-oss:120b-cloud
cat prompt.md | gwen --model gpt-oss:120b-cloud > output.md
cat prompt.md | gwen --stream
cat prompt.md | gwen --thinking
cat prompt.md | gwen --stream --thinking
cat input.json | gwen --chat > output.json
gwen --debug
```

## Chat Mode Usage

Chat mode allows to run Gwendoline with a set of chat messages, including its roles etc.

This mode cannot be combined with streaming or thinking!

Create a file with input message first or pipe it. Then run with parameter `--chat`.

In chat mode, Gwendoline is expecting the input to be already a list of chat messages. This must already include at least the message, you want to ask now. The output will be a list of chat messages as well, including the response from LLM.

For example, create file `chat.json` with the content:

```json
[{ "role": "user", "content": "Why is the sky blue?" }]
```

Run command:

```sh
cat chat-input.json | gwendoline --chat --model gpt-oss:120b-cloud > chat-output.json
```
