import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function testFetch() {
  const client = new Client({
    name: "test-client",
    version: "1.0.0",
  });

  try {
    const transport = new StreamableHTTPClientTransport(
      new URL("https://remote.mcpservers.org/fetch/mcp"),
    );
    await client.connect(transport);
    console.log("✓ Connected");

    // List tools
    const tools = await client.listTools();
    console.log(
      "Available tools:",
      tools.tools.map((t) => t.name),
    );

    // Call fetch tool
    console.log("\nCalling fetch tool for https://example.com...");
    const result = await client.callTool({
      name: "fetch",
      arguments: {
        url: "https://example.com",
      },
    });

    console.log("\nResult:");
    console.log(JSON.stringify(result, null, 2));

    await client.close();
  } catch (e) {
    console.error("Error:", e);
  }
}

testFetch();

// node test_fetch.js 2>&1
