import { createWallet, getWalletAddress, getWalletBalance } from "@/agent/wallet";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// GET /api/wallet -> the agent's wallet address and balance (or null if none yet)
export async function GET() {
  try {
    const address = getWalletAddress();
    if (!address) return Response.json({ address: null });

    const balance = await getWalletBalance().catch(() => "unavailable");
    return Response.json({ address, balance });
  } catch (err) {
    // Always answer with JSON so the page can show the problem instead of crashing.
    return Response.json({ address: null, error: errorMessage(err) }, { status: 500 });
  }
}

// POST /api/wallet -> create the agent's wallet
export async function POST() {
  try {
    return Response.json({ address: createWallet() });
  } catch (err) {
    return Response.json({ address: null, error: errorMessage(err) }, { status: 500 });
  }
}
