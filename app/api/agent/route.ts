import { MODEL, runAgent } from "@/agent/agent";
import { tools } from "@/agent/tools";

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
    if (message.includes("RESOURCE_EXHAUSTED") || message.includes('"code":429')) {
      const retry = message.match(/"retryDelay":"(\d+)s"/)?.[1];
      const wait = retry ? ` Try again in about ${Math.ceil(Number(retry) / 60)} min,` : " Wait for the quota to reset,";
      return Response.json(
        { error: `Gemini quota used up for model "${MODEL}".${wait} or set a different GEMINI_MODEL in .env and restart.` },
        { status: 429 }
      );
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
