/**
 * THE AGENT
 *
 * An agent is a loop:
 *   1. Send the chat + the list of tools to Gemini.
 *   2. If Gemini wants to call a tool -> run it, send back the result, repeat.
 *   3. If Gemini answers with text -> done.
 */
import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { tools } from "./tools";

export const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-flash-lite-latest";
const MAX_STEPS = 5;

/**
 * Backup models, tried in order if the main one fails. Each model has its own
 * free-tier quota, so when one runs out (429), is retired (404) or is
 * overloaded (503), the agent just moves on to the next one.
 */
const FALLBACK_MODELS = [
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
];
const MODELS = [...new Set([MODEL, ...FALLBACK_MODELS])];

/** The model that last worked, so we don't retry dead ones on every message. */
let workingModel = MODEL;

/** Errors where trying another model can help: not found, quota, overloaded, server error, bad model name. */
function shouldTryNextModel(err: unknown) {
  const status = (err as { status?: number })?.status;
  if (status && [400, 403, 404, 429, 500, 503].includes(status)) {
    // A 400 is only worth retrying if it's about the model, not our request.
    return status !== 400 || /model/i.test(String((err as Error).message));
  }
  return /NOT_FOUND|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|"code":(404|429|500|503)/.test(String((err as Error)?.message));
}

const SYSTEM_PROMPT =
  "You are a helpful agent with your own crypto wallet. Use your tools when they help. " +
  "If a tool costs money, just use it: your wallet pays automatically. Keep answers short and friendly.";

export type ChatMessage = { role: "user" | "agent"; text: string };
export type Step = { tool: string; args: unknown; result: unknown; error?: boolean };

export async function runAgent(history: ChatMessage[], ctx: { baseUrl: string }) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const contents: Content[] = history.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.text }],
  }));
  const steps: Step[] = [];

  const config = {
    systemInstruction: SYSTEM_PROMPT,
    tools: [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: t.parameters,
        })),
      },
    ],
  };

  /** Call Gemini, starting with the last model that worked and falling back through the list. */
  async function generate() {
    const order = [workingModel, ...MODELS.filter((m) => m !== workingModel)];
    let lastError: unknown;
    for (const model of order) {
      try {
        const response = await ai.models.generateContent({ model, contents, config });
        if (model !== workingModel) console.warn(`[agent] switched model: ${workingModel} -> ${model}`);
        workingModel = model;
        return response;
      } catch (err) {
        lastError = err;
        if (!shouldTryNextModel(err)) throw err;
        console.warn(`[agent] model ${model} failed (${(err as { status?: number }).status ?? "error"}), trying next`);
      }
    }
    throw lastError;
  }

  for (let i = 0; i < MAX_STEPS; i++) {
    const response = await generate();

    const calls = response.functionCalls ?? [];
    if (calls.length === 0) return { answer: response.text ?? "", steps };

    // Keep Gemini's turn in the history, then run every tool it asked for.
    contents.push(response.candidates![0].content!);
    const results: Part[] = [];

    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.name);
      let result: unknown;
      let error = false;
      try {
        if (!tool) throw new Error(`No tool named ${call.name}`);
        result = await tool.run(call.args ?? {}, ctx);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
        error = true;
      }
      steps.push({ tool: call.name!, args: call.args, result, error });
      results.push({ functionResponse: { id: call.id, name: call.name, response: { result } } });
    }

    contents.push({ role: "user", parts: results });
  }

  return { answer: "I hit my step limit. Try a simpler question.", steps };
}
