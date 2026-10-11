/**
 * THE AGENT'S WALLET
 *
 * The agent owns a wallet (a private key). It uses it to sign payments,
 * so it can pay for APIs on its own. This is the "x402" idea:
 *
 *   1. Agent calls an API         ->  API answers "402 Payment Required" + a price
 *   2. Agent signs a payment      ->  with its wallet
 *   3. Agent retries with payment ->  API checks the signature and answers 200 OK
 *
 * You create the wallet with the "Create wallet" button on the page.
 * It is saved in `.agent-wallet.json` so it survives restarts.
 *
 * Payments here are signed but NOT sent on-chain (it's a demo, no real money).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createPublicClient, formatEther, http, verifyMessage, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const WALLET_FILE = path.join(process.cwd(), ".agent-wallet.json");
// Hosted/serverless platforms (Vercel, Netlify...) have a read-only project folder.
// There we fall back to the temp folder. It does NOT survive redeploys or cold starts,
// so on a host you should set WALLET_PRIVATE_KEY as an environment variable instead.
const TMP_WALLET_FILE = path.join(os.tmpdir(), ".agent-wallet.json");

function readKeyFile(file: string): unknown {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).privateKey : null;
  } catch {
    return null;
  }
}
const chain = createPublicClient({ chain: baseSepolia, transport: http() });

export type Payment = { from: Address; to: Address; amount: string; asset: string; resource: string; nonce: string };

/** The wallet from .env or .agent-wallet.json, or null if none was created yet. */
function loadAccount() {
  // A private key is 0x + 64 hex chars. A 0x + 40 hex value is a wallet ADDRESS, not a key.
  const isKey = (k: unknown): k is Hex => typeof k === "string" && /^0x[0-9a-fA-F]{64}$/.test(k);

  const envKey = process.env.WALLET_PRIVATE_KEY?.trim();
  if (envKey && !isKey(envKey)) {
    console.warn(
      "[wallet] WALLET_PRIVATE_KEY in .env is not a private key (0x + 64 hex). " +
        "Did you paste the wallet ADDRESS? Ignoring it and using .agent-wallet.json."
    );
  }
  const key = [envKey, readKeyFile(WALLET_FILE), readKeyFile(TMP_WALLET_FILE)].find(isKey);
  return key ? privateKeyToAccount(key) : null;
}

function requireAccount() {
  const account = loadAccount();
  if (!account) throw new Error("The agent has no wallet yet. Ask the user to click 'Create wallet' first.");
  return account;
}

/** Make a brand new wallet and save it. */
export function createWallet() {
  if (loadAccount()) return getWalletAddress();
  const privateKey = generatePrivateKey();
  const data = JSON.stringify({ privateKey }, null, 2);
  try {
    fs.writeFileSync(WALLET_FILE, data);
  } catch {
    // Read-only filesystem (hosted). Use the temp folder instead.
    fs.writeFileSync(TMP_WALLET_FILE, data);
    console.warn("[wallet] Project folder is read-only, saved wallet to temp. Set WALLET_PRIVATE_KEY on your host to keep it.");
  }
  return privateKeyToAccount(privateKey).address;
}

export function getWalletAddress() {
  return loadAccount()?.address ?? null;
}

export async function getWalletBalance() {
  const wei = await chain.getBalance({ address: requireAccount().address });
  return `${formatEther(wei)} ETH`;
}

/** Parse JSON, or explain clearly why the response wasn't JSON (e.g. a host login page). */
async function readJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const hint =
      res.status === 401 || res.status === 403
        ? " The host is blocking the request. On Vercel, turn off Deployment Protection (Settings > Deployment Protection) or use the production URL."
        : "";
    throw new Error(`${res.url} returned ${res.status} with a non-JSON response.${hint}`);
  }
}

/** Fetch a URL. If it asks for payment (402), sign one with the wallet and try again. */
export async function payAndFetch(url: string) {
  const first = await fetch(url);
  if (first.status !== 402) return { data: await readJson(first) };

  const account = requireAccount();
  const { price, asset, payTo } = await readJson(first);
  const payment: Payment = {
    from: account.address,
    to: payTo,
    amount: price,
    asset,
    resource: new URL(url).pathname,
    nonce: crypto.randomUUID(),
  };
  const signature = await account.signMessage({ message: JSON.stringify(payment) });
  const header = Buffer.from(JSON.stringify({ payment, signature })).toString("base64");

  const paid = await fetch(url, { headers: { "X-PAYMENT": header } });
  return {
    data: await readJson(paid),
    payment: { status: paid.status, amount: `${price} ${asset}`, to: payTo, signature: `${signature.slice(0, 18)}...` },
  };
}

/** Used by the API: is this X-PAYMENT header a real, signed payment? */
export async function verifyPayment(header: string | null) {
  if (!header) return null;
  try {
    const { payment, signature } = JSON.parse(Buffer.from(header, "base64").toString()) as {
      payment: Payment;
      signature: Hex;
    };
    const valid = await verifyMessage({ address: payment.from, message: JSON.stringify(payment), signature });
    return valid ? payment : null;
  } catch {
    return null;
  }
}
