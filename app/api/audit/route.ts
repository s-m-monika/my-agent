/**
 * A MOCK PAID SMART-CONTRACT CHECKER API
 *
 * Same x402-style flow as /api/weather, using the same helpers:
 * no valid payment → 402 Payment Required. Valid signed payment → the report.
 *
 * GET /api/audit?code=<solidity source>
 *
 * Payments are signed messages only. No funds move on any blockchain.
 * The submitted code is analysed as text and is never compiled or executed.
 */
import { auditSolidity, validateCode } from "@/agent/audit";
import { verifyPayment, type Payment } from "@/agent/wallet";

const PRICE = "0.05";
const ASSET = "USDC";
const PAY_TO = "0x000000000000000000000000000000000000dEaD"; // the API owner's wallet (demo)
const RESOURCE = "/api/audit";

/**
 * Nonces we've already accepted, so a captured X-PAYMENT header can't be
 * replayed for free. In-memory only: it resets on restart and isn't shared
 * between serverless instances (fine for a demo, not for production).
 */
const usedNonces = new Map<string, number>();
const NONCE_TTL_MS = 60 * 60 * 1000;

function nonceAlreadyUsed(nonce: string) {
  const now = Date.now();
  for (const [n, t] of usedNonces) if (now - t > NONCE_TTL_MS) usedNonces.delete(n);
  return usedNonces.has(nonce);
}

/** Why a verified signature still isn't acceptable for this endpoint (or null if it is). */
function rejectReason(payment: Payment) {
  if (payment.to?.toLowerCase() !== PAY_TO.toLowerCase()) return "payment is addressed to the wrong recipient";
  if (payment.asset !== ASSET) return `payment must be in ${ASSET}`;
  if (!(Number(payment.amount) >= Number(PRICE))) return `payment amount is below ${PRICE} ${ASSET}`;
  if (payment.resource !== RESOURCE) return `payment was signed for ${payment.resource}, not ${RESOURCE}`;
  if (typeof payment.nonce !== "string" || !payment.nonce) return "payment has no nonce";
  if (nonceAlreadyUsed(payment.nonce)) return "payment nonce was already used (replayed payment)";
  return null;
}

function paymentRequired(reason?: string) {
  return Response.json(
    { error: "Payment Required", ...(reason && { reason }), price: PRICE, asset: ASSET, payTo: PAY_TO },
    { status: 402 }
  );
}

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");

  // Reject bad input before asking for payment, so the agent never pays for nothing.
  const invalid = validateCode(code);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

  const header = req.headers.get("X-PAYMENT");
  if (!header) return paymentRequired();

  const payment = await verifyPayment(header);
  if (!payment) return paymentRequired("signature verification failed");

  const reason = rejectReason(payment);
  if (reason) return paymentRequired(reason);

  usedNonces.set(payment.nonce, Date.now());

  return Response.json({
    ...auditSolidity(code!),
    paidBy: payment.from,
    paymentNote: `Signed mock payment of ${PRICE} ${ASSET} verified. No funds were transferred on any blockchain.`,
  });
}
