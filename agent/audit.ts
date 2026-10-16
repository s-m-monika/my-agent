/**
 * HEURISTIC SOLIDITY CHECKER
 *
 * Looks for a few well-known risky patterns in Solidity source code using
 * plain text analysis. The code is NEVER compiled or executed.
 *
 * Every result is a *suspicious pattern* that needs a human to review it,
 * not a confirmed vulnerability. This is not a security audit.
 *
 * This file has no imports so it can be tested on its own.
 */

export const MAX_CODE_LENGTH = 4000;

export type Severity = "high" | "medium" | "low" | "info";

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  lines: number[];
  snippet: string;
  status: "suspicious pattern - needs manual review";
  explanation: string;
  remediation: string;
};

export const CHECKS = [
  { id: "tx-origin-auth", name: "tx.origin used for authorization", description: "Flags tx.origin, especially inside require/if checks." },
  { id: "unchecked-low-level-call", name: "Low-level call return values", description: "Flags .call/.send/.delegatecall/.staticcall and whether their success value is checked." },
  { id: "reentrancy", name: "External call before state update", description: "Flags functions that write contract state after making an external call." },
  { id: "delegatecall", name: "delegatecall usage", description: "Flags every delegatecall, which runs other code with this contract's storage." },
] as const;

export const DISCLAIMER =
  "DevPulse runs a small set of pattern-based checks. It is a prototype, not a complete security audit. " +
  "Findings are suspicious patterns that may be false positives, and code with no findings can still be vulnerable. " +
  "Get a professional audit and use tools like Slither or Foundry tests before deploying contracts that hold value.";

/** Validate the input. Returns an error message, or null if the code is OK to check. */
export function validateCode(code: unknown): string | null {
  if (typeof code !== "string" || !code.trim()) return "Provide Solidity source code as a non-empty string.";
  if (code.length > MAX_CODE_LENGTH) return `Code is too long (${code.length} characters). The limit is ${MAX_CODE_LENGTH}; send one contract or function at a time.`;
  if (!/\b(pragma\s+solidity|contract|library|interface|function)\b/.test(code)) return "This does not look like Solidity code (no pragma, contract or function found).";
  return null;
}

/**
 * Blank out comments and string contents (keeping newlines and length), so
 * patterns inside comments or strings don't create false positives and
 * character positions still map to the original lines.
 */
function stripCommentsAndStrings(src: string) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") (out += " "), i++;
    } else if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) (out += src[i] === "\n" ? "\n" : " "), i++;
      if (i < src.length) (out += "  "), (i += 2);
    } else if (c === '"' || c === "'") {
      out += c;
      i++;
      while (i < src.length && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\") (out += " "), i++;
        if (i < src.length) (out += " "), i++;
      }
      if (i < src.length) (out += src[i]), i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

type FunctionBlock = { name: string; header: string; bodyStart: number; bodyEnd: number };

/** Find function/modifier/constructor bodies using brace matching. */
function findFunctions(code: string): FunctionBlock[] {
  const blocks: FunctionBlock[] = [];
  const re = /\b(function|modifier|constructor|fallback|receive)\b\s*(\w*)/g;
  for (let m: RegExpExecArray | null; (m = re.exec(code)); ) {
    let i = m.index + m[0].length;
    while (i < code.length && code[i] !== "{" && code[i] !== ";") i++;
    if (code[i] !== "{") continue; // declaration only (interface/abstract)
    let depth = 0;
    let j = i;
    for (; j < code.length; j++) {
      if (code[j] === "{") depth++;
      else if (code[j] === "}" && --depth === 0) break;
    }
    blocks.push({ name: m[2] || m[1], header: code.slice(m.index, i), bodyStart: i, bodyEnd: j });
    re.lastIndex = j;
  }
  return blocks;
}

const KEYWORDS = new Set(["return", "emit", "require", "assert", "revert", "if", "else", "for", "while", "do", "delete", "new", "msg", "tx", "block", "this", "super"]);
const TYPE = String.raw`(?:u?int\d*|bool|address(?:\s+payable)?|bytes\d*|string|[A-Z]\w*(?:\.\w+)?)(?:\[[^\]]*\])*`;

/** Names of local variables and parameters in a function (storage pointers excluded: they alias state). */
function localNames(header: string, body: string) {
  const names = new Set<string>();
  const params = header.match(/\(([^)]*)\)/)?.[1] ?? "";
  for (const p of params.split(",")) {
    const parts = p.trim().split(/\s+/);
    if (parts.length >= 2 && !/^storage$/.test(parts.at(-2)!)) names.add(parts.at(-1)!);
  }
  const decl = new RegExp(String.raw`\b${TYPE}\s+(memory\s+|calldata\s+|storage\s+)?([A-Za-z_]\w*)\s*(?=[=;,)])`, "g");
  for (let m: RegExpExecArray | null; (m = decl.exec(body)); ) {
    if (m[1]?.trim() !== "storage") names.add(m[2]);
  }
  return names;
}

export function auditSolidity(source: string) {
  const code = stripCommentsAndStrings(source);
  const originalLines = source.split("\n");
  const lineOf = (index: number) => code.slice(0, index).split("\n").length;
  const snippetOf = (line: number) => (originalLines[line - 1] ?? "").trim().slice(0, 160);
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, "status" | "snippet">) =>
    findings.push({ ...f, snippet: snippetOf(f.lines[0]), status: "suspicious pattern - needs manual review" });

  const functions = findFunctions(code);
  const functionAt = (index: number) => functions.find((f) => index > f.bodyStart && index < f.bodyEnd);

  // ── 1. tx.origin ───────────────────────────────────────────────
  const seenOriginLines = new Set<number>();
  for (const m of code.matchAll(/\btx\.origin\b/g)) {
    const line = lineOf(m.index!);
    if (seenOriginLines.has(line)) continue;
    seenOriginLines.add(line);
    const text = code.split("\n")[line - 1];
    const isCheck = /\b(require|assert|if)\s*\(/.test(text) && /[!=]=/.test(text);
    const isEoaCheck = /tx\.origin\s*[!=]=\s*msg\.sender|msg\.sender\s*[!=]=\s*tx\.origin/.test(text);
    if (isCheck && !isEoaCheck) {
      add({
        id: "tx-origin-auth",
        severity: "high",
        title: "tx.origin used for authorization",
        lines: [line],
        explanation:
          "tx.origin is the wallet that started the whole transaction, not the direct caller. If the owner is tricked into calling a malicious contract, " +
          "that contract can call yours and still pass this check, because tx.origin is still the owner (a phishing-style attack).",
        remediation: "Use msg.sender for access control, ideally through a reviewed pattern such as OpenZeppelin Ownable or AccessControl.",
      });
    } else {
      add({
        id: "tx-origin-auth",
        severity: "low",
        title: isEoaCheck ? "tx.origin == msg.sender check" : "tx.origin usage",
        lines: [line],
        explanation: isEoaCheck
          ? "This blocks calls from other contracts. It is not a direct vulnerability, but it can break smart-contract wallets and account abstraction."
          : "tx.origin appears here. It is rarely the right value to rely on; confirm it is not used for permissions.",
        remediation: "Prefer msg.sender. Only rely on tx.origin if you understand and accept its limitations.",
      });
    }
  }

  // ── 2. Low-level calls & return values ─────────────────────────
  for (const m of code.matchAll(/\.(call|send|delegatecall|staticcall)\s*(\{[^}]*\})?\s*\(/g)) {
    const idx = m.index!;
    const kind = m[1];
    const line = lineOf(idx);
    const stmtStart = Math.max(code.lastIndexOf(";", idx), code.lastIndexOf("{", idx), code.lastIndexOf("}", idx)) + 1;
    const prefix = code.slice(stmtStart, idx);
    const stmtEnd = code.indexOf(";", idx);
    const fn = functionAt(idx);
    const rest = code.slice(stmtEnd === -1 ? idx : stmtEnd, fn ? fn.bodyEnd : code.length);

    let checked = /\b(require|assert|if)\s*\(/.test(prefix) || /\breturn\b/.test(prefix);
    if (!checked && /(?<![=!<>])=(?!=)/.test(prefix)) {
      // Captured into a variable: is that variable used afterwards?
      const name = prefix.match(/\(\s*bool\s+(\w+)/)?.[1] ?? prefix.match(/\bbool\s+(\w+)\s*=/)?.[1] ?? prefix.match(/^\s*(\w+)\s*=/)?.[1];
      checked = Boolean(name && new RegExp(String.raw`\b${name}\b`).test(rest));
    }

    if (!checked) {
      add({
        id: "unchecked-low-level-call",
        severity: "medium",
        title: `Unchecked return value of .${kind}()`,
        lines: [line],
        explanation:
          `.${kind}() does not revert when it fails; it just returns false. If the result is ignored, the contract carries on as if ` +
          "the call (for example, sending ETH) succeeded, which can leave balances and records wrong.",
        remediation: `Capture the result and check it, e.g. (bool ok, ) = target.${kind === "send" ? "call{value: amount}" : kind}(...); require(ok, "call failed");`,
      });
    } else {
      add({
        id: "unchecked-low-level-call",
        severity: "info",
        title: `Low-level .${kind}() (return value appears to be checked)`,
        lines: [line],
        explanation:
          "Low-level calls skip Solidity's safety checks: they don't verify the target has code and they forward gas that the callee can use " +
          "to call back into your contract. The success value looks handled, but the call deserves a careful look.",
        remediation: "Confirm the failure path is correct, the target is trusted or validated, and state is updated before the call.",
      });
    }
  }

  // ── 3. Reentrancy: state written after an external call ────────
  for (const fn of functions) {
    const body = code.slice(fn.bodyStart, fn.bodyEnd);
    const call = /\.(call|delegatecall)\s*(\{[^}]*\})?\s*\(|\.(send|transfer)\s*\(/.exec(body);
    if (!call) continue;
    const afterCallStart = body.indexOf(";", call.index);
    if (afterCallStart === -1) continue;
    const after = body.slice(afterCallStart);
    const locals = localNames(fn.header, body);

    let writeIndex = -1;
    const assign = /(?:^|[;{}\s(])(?:delete\s+)?([A-Za-z_]\w*)((?:\[[^\]]*\]|\.\w+)*)\s*(\+\+|--|[+\-*/%|&^]?=(?![=>]))/g;
    for (let m: RegExpExecArray | null; (m = assign.exec(after)); ) {
      const root = m[1];
      if (KEYWORDS.has(root) || locals.has(root) || /^(u?int\d*|bool|address|bytes\d*|string)$/.test(root)) continue;
      // Skip local declarations like `uint x = ...` (the type precedes the name).
      const before = after.slice(0, m.index + 1).trimEnd();
      if (new RegExp(String.raw`\b${TYPE}\s*$`).test(before) && !before.endsWith(";")) continue;
      writeIndex = afterCallStart + m.index + 1;
      break;
    }
    // `delete x[...]` also writes state.
    for (const m of after.matchAll(/\bdelete\s+([A-Za-z_]\w*)/g)) {
      if (locals.has(m[1])) continue;
      const idx = afterCallStart + m.index!;
      if (writeIndex === -1 || idx < writeIndex) writeIndex = idx;
      break;
    }
    if (writeIndex === -1) continue;

    const callLine = lineOf(fn.bodyStart + call.index);
    const writeLine = lineOf(fn.bodyStart + writeIndex);
    const guarded = /\bnonReentrant\b/.test(fn.header);
    const weakCall = Boolean(call[3]); // .send / .transfer forward only 2300 gas
    add({
      id: "reentrancy",
      severity: guarded ? "low" : weakCall ? "medium" : "high",
      title: `Potential reentrancy in ${fn.name}(): state updated after external call`,
      lines: [callLine, writeLine],
      explanation:
        `In ${fn.name}(), an external call happens on line ${callLine} and contract state is changed afterwards on line ${writeLine}. ` +
        "While the external call runs, the receiver can call back into this function before the state update, for example withdrawing the same balance twice." +
        (guarded ? " A nonReentrant modifier is present, which likely mitigates this; confirm it covers every related function." : "") +
        (weakCall ? " .send/.transfer forward only 2300 gas, which limits but does not fully guarantee protection." : ""),
      remediation:
        "Follow checks-effects-interactions: update balances and other state before the external call. " +
        "Add a reentrancy guard such as OpenZeppelin ReentrancyGuard (nonReentrant) to functions that move funds.",
    });
  }

  // ── 4. delegatecall ────────────────────────────────────────────
  for (const m of code.matchAll(/\.delegatecall\s*\(/g)) {
    add({
      id: "delegatecall",
      severity: "high",
      title: "delegatecall needs review",
      lines: [lineOf(m.index!)],
      explanation:
        "delegatecall runs another contract's code as if it were this contract, with full access to this contract's storage and ETH. " +
        "If the target address or calldata can be influenced by users, an attacker can take ownership or drain funds. Storage layouts must also match exactly.",
      remediation:
        "Only delegatecall to fixed, trusted, audited addresses. Never let users choose the target. Prefer well-reviewed proxy patterns (e.g. OpenZeppelin UUPS/Transparent proxies).",
    });
  }

  const order: Severity[] = ["high", "medium", "low", "info"];
  findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.lines[0] - b.lines[0]);
  const counts = Object.fromEntries(order.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  const flagged = counts.high + counts.medium + counts.low;

  const summary =
    findings.length === 0
      ? "No matches for the selected suspicious patterns. This does NOT mean the contract is secure; only a few patterns were checked."
      : `Found ${flagged} suspicious pattern(s) (${counts.high} high, ${counts.medium} medium, ${counts.low} low)` +
        (counts.info ? ` and ${counts.info} informational note(s)` : "") +
        ". These are heuristic matches that need manual review, not confirmed vulnerabilities.";

  return {
    checker: "DevPulse heuristic Solidity checker",
    summary,
    severityCounts: counts,
    findings,
    checksPerformed: CHECKS,
    stats: { lines: originalLines.length, functionsScanned: functions.length },
    codeExecuted: false,
    disclaimer: DISCLAIMER,
  };
}
