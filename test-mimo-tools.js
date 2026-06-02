import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || "https://token-plan-sgp.xiaomimimo.com/v1",
  apiKey: process.env.LLM_API_KEY || "",
  timeout: 60000,
});

const model = process.env.LLM_MODEL || "mimo-v2.5";

const tools = [
  {
    type: "function",
    function: {
      name: "get_balance",
      description: "Get wallet SOL balance",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

async function test() {
  console.log(`Testing model: ${model}`);
  console.log(`Base URL: ${client.baseURL}`);

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "What is my SOL balance?" }],
      tools,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 1024,
    });

    console.log("\n=== Response ===");
    console.log(JSON.stringify(response.choices?.[0]?.message, null, 2));

    const msg = response.choices?.[0]?.message;
    if (msg?.tool_calls?.length) {
      console.log("\n✓ Tool calling WORKS");
    } else {
      console.log("\n✗ No tool_calls returned — tool calling may NOT be supported");
      console.log("  Content:", msg?.content?.slice(0, 200));
    }
  } catch (error) {
    console.error("\n✗ Error:", error.message);
    if (error.status) console.error("  Status:", error.status);
    if (error.error) console.error("  Body:", JSON.stringify(error.error).slice(0, 500));
  }
}

test();
