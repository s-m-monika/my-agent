/**
 * LIVE ETHEREUM GAS (free, no API key)
 *
 * Reads gas data straight from Ethereum mainnet through free public JSON-RPC
 * endpoints, using `viem` (already a project dependency):
 *   - eth_gasPrice              -> legacy gas price
 *   - eth_getBlockByNumber      -> latest block number, timestamp, base fee
 *   - eth_feeHistory            -> next block's base fee + priority-fee percentiles
 *
 * Calls run one after another (some free endpoints reject bursts), and if an
 * endpoint fails, the next one is tried. Nothing is ever cached or invented:
 * if every endpoint fails, this throws and the agent reports it.
 *
 * This file has no relative imports so it can be tested on its own.
 */
import { createPublicClient, formatEther, formatGwei, http } from "viem";
import { mainnet } from "viem/chains";

export const DEFAULT_RPC_ENDPOINTS = ["https://eth.drpc.org", "https://1rpc.io/eth", "https://ethereum-rpc.publicnode.com"];

/** Data older than this is flagged as possibly stale (Ethereum makes a block every ~12s). */
const STALE_AFTER_SECONDS = 120;
const SIMPLE_TRANSFER_GAS = BigInt(21000);

/** Round a gwei string for readability, keeping small values visible. */
function gwei(value: bigint) {
  const n = Number(formatGwei(value));
  return Number(n < 1 ? n.toPrecision(3) : n.toFixed(3));
}

/** Average a list of bigints (feeHistory gives one value per block). */
function average(values: bigint[]) {
  return values.length ? values.reduce((a, b) => a + b, BigInt(0)) / BigInt(values.length) : BigInt(0);
}

function describeError(err: unknown) {
  const e = err as { status?: number; shortMessage?: string; message?: string };
  if (e?.status === 429) return "rate limited (HTTP 429)";
  return e?.shortMessage || e?.message || String(err);
}

async function readGas(endpoint: string) {
  const client = createPublicClient({ chain: mainnet, transport: http(endpoint, { timeout: 8000, retryCount: 0 }) });

  const gasPrice = await client.getGasPrice();
  const block = await client.getBlock({ blockTag: "latest" });
  const history = await client.getFeeHistory({ blockCount: 10, rewardPercentiles: [10, 50, 90], blockTag: "latest" });

  // Validate the response shape instead of trusting it.
  if (typeof gasPrice !== "bigint" || gasPrice <= BigInt(0)) throw new Error("invalid eth_gasPrice response");
  if (block.baseFeePerGas == null || !block.number || !block.timestamp) throw new Error("invalid block response");
  const nextBaseFee = history.baseFeePerGas?.at(-1);
  if (nextBaseFee == null || !history.reward?.length) throw new Error("invalid eth_feeHistory response");

  const tip = (i: number) => average(history.reward!.map((r) => r[i] ?? BigInt(0)));
  const tiers = { low: tip(0), standard: tip(1), fast: tip(2) };
  const tier = (t: bigint) => ({
    priorityFeeGwei: gwei(t),
    estimatedTotalGwei: gwei(nextBaseFee + t),
    simpleTransferCostEth: Number(formatEther((nextBaseFee + t) * SIMPLE_TRANSFER_GAS)),
  });

  const ageSeconds = Math.max(0, Math.round(Date.now() / 1000 - Number(block.timestamp)));

  return {
    network: "Ethereum mainnet",
    unit: "gwei",
    gasPriceGwei: gwei(gasPrice),
    currentBaseFeeGwei: gwei(block.baseFeePerGas),
    nextBlockBaseFeeGwei: gwei(nextBaseFee),
    priorityFeeTiers: {
      // Percentiles of tips paid over the last 10 blocks.
      low: tier(tiers.low),
      standard: tier(tiers.standard),
      fast: tier(tiers.fast),
    },
    simpleTransferGas: Number(SIMPLE_TRANSFER_GAS),
    block: {
      number: Number(block.number),
      timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
      ageSeconds,
    },
    stale: ageSeconds > STALE_AFTER_SECONDS,
    source: { method: "JSON-RPC (eth_gasPrice, eth_getBlockByNumber, eth_feeHistory)", endpoint },
    retrievedAt: new Date().toISOString(),
    note:
      "Gas estimates change every block (~12s). A low gas price does not make a transaction cheap if it uses a lot of gas, " +
      "and it says nothing about whether the transaction or contract is safe.",
  };
}

/** Live gas info from the first endpoint that answers correctly. Throws if none do. */
export async function getEthereumGas(endpoints: string[] = DEFAULT_RPC_ENDPOINTS) {
  const failures: string[] = [];
  for (const endpoint of endpoints) {
    try {
      const data = await readGas(endpoint);
      if (failures.length) return { ...data, skippedEndpoints: failures };
      return data;
    } catch (err) {
      failures.push(`${endpoint}: ${describeError(err)}`);
    }
  }
  throw new Error(`Live Ethereum gas data could not be retrieved right now. Tried: ${failures.join("; ")}`);
}
