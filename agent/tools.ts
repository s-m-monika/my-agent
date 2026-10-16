/**
 * YOUR AGENT'S TOOLS
 *
 * A tool is just a function the agent is allowed to call.
 * Gemini reads the `description` to decide WHEN to use it,
 * and `parameters` to know WHAT to pass in.
 *
 * Add your own tool: copy one of the objects below, change it,
 * and save. It shows up in the "Tools" list on the page.
 */
import { getWalletAddress, getWalletBalance, payAndFetch } from "./wallet";
import { getEthereumGas } from "./gas";
import { validateCode } from "./audit";

/** Most servers reject URLs much longer than this. */
const MAX_URL_LENGTH = 12000;

export type Tool = {
  name: string;
  description: string;
  /** JSON Schema describing the inputs. */
  parameters: object;
  /** The code that runs when the agent calls this tool. */
  run: (args: any, ctx: { baseUrl: string }) => Promise<unknown>;
};

export const tools: Tool[] = [
  // ─── DevPulse: free live Ethereum gas tracker ───
  {
    name: "get_gas_price",
    description:
      "Get live Ethereum mainnet gas data: gas price, base fee, low/standard/fast priority fees (gwei) and the cost of a simple ETH transfer. " +
      "Use whenever the user asks about current gas, fees or whether now is a good time to transact. Free.",
    parameters: { type: "object", properties: {} },
    run: async () => getEthereumGas(),
  },

  // ─── DevPulse: paid smart-contract checker (same x402 flow as get_weather) ───
  {
    name: "audit_smart_contract_snippet",
    description:
      "Check Solidity code for common risky patterns (tx.origin auth, unchecked low-level calls, reentrancy, delegatecall). " +
      "Use when the user shares Solidity code and asks for a review, audit or security check. Pass the FULL code exactly as given. " +
      "Costs 0.05 USDC, paid automatically from the agent's wallet. Results are heuristic, not a full audit.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "The complete Solidity source code to check, unchanged." },
      },
      required: ["code"],
    },
    run: async ({ code }, { baseUrl }) => {
      const invalid = validateCode(code);
      if (invalid) throw new Error(invalid);
      const url = `${baseUrl}/api/audit?code=${encodeURIComponent(code)}`;
      if (url.length > MAX_URL_LENGTH) throw new Error("This code is too large to send in one request. Check one contract or function at a time.");
      const result = await payAndFetch(url);
      // Only treat it as paid if the API accepted the signed payment.
      if (!result.payment) return result; // e.g. the API rejected the input before asking for payment
      return { ...result, paymentVerified: result.payment.status === 200 };
    },
  },

  // ─── 1. A paid API: the agent's wallet signs a payment to unlock it ───
  {
    name: "get_weather",
    description: "Get the current weather for a city. Costs 0.01 USDC, paid automatically from the agent's wallet.",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name, e.g. Mumbai" },
      },
      required: ["city"],
    },
    run: async ({ city }, { baseUrl }) => {
      return payAndFetch(`${baseUrl}/api/weather?city=${encodeURIComponent(city)}`);
    },
  },

  // ─── 2. Wallet tool: read the agent's own wallet ───
  {
    name: "get_my_wallet",
    description: "Get the agent's own wallet address and its ETH balance on Base Sepolia (testnet).",
    parameters: { type: "object", properties: {} },
    run: async () => ({
      address: getWalletAddress(),
      balance: await getWalletBalance(),
      network: "Base Sepolia (testnet)",
    }),
  },

  // ─── 3. A plain tool: no wallet, no API. Try changing this one first! ───
  {
    name: "roll_dice",
    description: "Roll a dice with the given number of sides.",
    parameters: {
      type: "object",
      properties: {
        sides: { type: "number", description: "How many sides the dice has. Default 6." },
      },
    },
    run: async ({ sides = 6 }) => ({ rolled: Math.floor(Math.random() * sides) + 1, sides }),
  },

{
  name: "get_joke",
  description: "Get a random joke. Use when the user wants a joke.",
  parameters: {
    type: "object",
    properties: {}
  },
  run: async () => {
    const res = await fetch("https://official-joke-api.appspot.com/random_joke");
    return res.json();
  },
},
{
  name: "get_country_info",
  description: "Get facts about a country, including its capital and population.",
  parameters: {
    type: "object",
    properties: {
      country: {
        type: "string",
        description: "Country name, e.g. India"
      },
    },
    required: ["country"],
  },
  // restcountries.com v3.1 was shut down (v5 needs an API key), so this uses
  // countriesnow.space, which is free and needs no key.
  run: async ({ country }) => {
    const post = async (path: string) => {
      const res = await fetch(`https://countriesnow.space/api/v0.1/countries/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.msg || `Could not find country "${country}"`);
      return json.data;
    };
    const [info, pop] = await Promise.all([post("capital"), post("population").catch(() => null)]);
    const latest = pop?.populationCounts?.at(-1);
    return {
      country: info.name,
      capital: info.capital,
      population: latest?.value ?? "unknown",
      populationYear: latest?.year,
    };
  }
}


];