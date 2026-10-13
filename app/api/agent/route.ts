import { MODEL, runAgent } from "@/agent/agent";
import { tools } from "@/agent/tools";

// The agent can make several Gemini + tool calls per message. Give hosted
// (serverless) functions enough time instead of the short default.
export const maxDuration = 60;

// GET /api/agent -> setup status + the list of tools (shown on the page)
export async function GET() {
  return Response.json({
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    model: MODEL,
    tools: tools.map((t) => ({ name: t.name, description: t.description })),
  });
}

// POST /api/agent { messages } -> the agent's answer + the tools it used
export async function POST(req: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: "Add GEMINI_API_KEY to your .env file, then restart `npm run dev`." }, { status: 500 });
  }

  const { messages } = await req.json();
  try {
    const result = await runAgent(messages, { baseUrl: new URL(req.url).origin });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Gemini free-tier quota hit: show a short, readable message instead of the raw JSON.
    // Only reached if EVERY fallback model failed (usually all free quotas used up).
    if (message.includes("RESOURCE_EXHAUSTED") || message.includes('"code":429')) {
      const retry = message.match(/"retryDelay":"(\d+)s"/)?.[1];
      const wait = retry ? ` Try again in about ${Math.ceil(Number(retry) / 60)} min.` : " Try again later.";
      return Response.json(
        { error: `All Gemini models are out of free quota right now.${wait} Turning on billing in Google AI Studio removes this limit.` },
        { status: 429 }
      );
    }
    if (message.includes("API_KEY_INVALID") || message.includes("API key not valid")) {
      return Response.json({ error: "Your GEMINI_API_KEY is not valid. Check it in .env (or your host's environment variables)." }, { status: 401 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
