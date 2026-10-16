"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  SendHorizontal,
  ShieldCheck,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Step = { tool: string; args: unknown; result: any; error?: boolean };
type Message = { role: "user" | "agent"; text: string; steps?: Step[]; error?: boolean };
type Status = { hasApiKey: boolean; model: string; tools: { name: string; description: string }[] };
type WalletInfo = { address: string | null; balance?: string };

/** A small contract with deliberate issues, so the checker example has something to find. */
const SAMPLE_CONTRACT = `pragma solidity ^0.8.20;

contract Vault {
    mapping(address => uint256) public balances;
    address public owner = msg.sender;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        balances[msg.sender] = 0;
    }

    function sweep(address payable to) external {
        require(tx.origin == owner, "not owner");
        to.send(address(this).balance);
    }
}`;

/** `prefill` examples go into the input box (so the user can paste their own code) instead of sending right away. */
const EXAMPLES: { label: string; prompt: string; prefill?: boolean }[] = [
  { label: "Check the current Ethereum gas price.", prompt: "Check the current Ethereum gas price." },
  {
    label: "Review this Solidity contract for common security issues: [paste code]",
    prompt: `Review this Solidity contract for common security issues:\n\n${SAMPLE_CONTRACT}`,
    prefill: true,
  },
  { label: "Explain the difference between high and low gas prices.", prompt: "Explain the difference between high and low gas prices." },
  { label: "What's the weather in Mumbai?", prompt: "What's the weather in Mumbai?" },
  { label: "Roll a 20 sided dice", prompt: "Roll a 20 sided dice" },
];

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadWallet = () => fetch("/api/wallet").then((r) => r.json()).then(setWallet);

  useEffect(() => {
    fetch("/api/agent").then((r) => r.json()).then(setStatus);
    loadWallet();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  async function createWallet() {
    setCreating(true);
    await fetch("/api/wallet", { method: "POST" });
    await loadWallet();
    setCreating(false);
  }

  async function send(text: string) {
    if (!text.trim() || thinking) return;
    const history: Message[] = [...messages, { role: "user", text }];
    setMessages(history);
    setInput("");
    setThinking(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.filter((m) => !m.error).map(({ role, text }) => ({ role, text })) }),
      });
      const data = await res.json();
      setMessages((m) => [...m, data.error ? { role: "agent", text: data.error, error: true } : { role: "agent", text: data.answer, steps: data.steps }]);
      if (data.steps?.some((s: Step) => s.result?.payment)) loadWallet();
    } catch {
      setMessages((m) => [...m, { role: "agent", text: "Could not reach the server. Is `npm run dev` still running?", error: true }]);
    }
    setThinking(false);
  }

  const ready = Boolean(status?.hasApiKey);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1520px] flex-col gap-10 px-4 py-8 md:px-12 md:py-12">
      {/* Header */}
      <header className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label>
            <img src="/risein-logo.svg" alt="Rise In" className="mr-3 h-5 w-auto" />
            <span className="text-foreground">/ DevPulse</span>&nbsp;Web3 developer assistant
          </Label>
          {status && <Label>Model: {status.model}</Label>}
        </div>
        <h1 className="text-5xl leading-[0.9] font-bold tracking-[-0.045em] uppercase md:text-7xl">
          Dev<span className="text-primary">Pulse.</span>
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          An AI assistant for Web3 developers that checks live gas, reviews Solidity, and pays for APIs with its own wallet.
        </p>
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          <Feature icon={<Zap className="size-4" />} title="Live gas tracker" price="Free">
            Current Ethereum base fee, priority fees and transfer cost, read live from public RPC nodes.
          </Feature>
          <Feature icon={<ShieldCheck className="size-4" />} title="Contract checker" price="0.05 USDC">
            Flags risky Solidity patterns like reentrancy and tx.origin auth. Paid per request with a signed demo payment.
          </Feature>
        </div>
      </header>

      <div className="grid flex-1 gap-6 lg:grid-cols-[380px_1fr]">
        {/* Left: setup + tools */}
        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <SectionTitle num="01" title="Setup" />
            </CardHeader>
            <CardContent className="flex flex-col">
              <SetupStep number={1} title="Add your Gemini API key" done={ready}>
                {status && !ready && (
                  <p className="text-muted-foreground">
                    Paste it into <Code>.env</Code> as <Code>GEMINI_API_KEY</Code>, then restart <Code>npm run dev</Code>.{" "}
                    <a className="text-primary underline underline-offset-4" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                      Get a free key
                    </a>
                  </p>
                )}
                {ready && <p className="text-muted-foreground">Connected.</p>}
              </SetupStep>

              <SetupStep number={2} title="Create the agent wallet" done={Boolean(wallet?.address)}>
                {wallet && !wallet.address && (
                  <div className="flex flex-col gap-3">
                    <p className="text-muted-foreground">The agent signs payments with this wallet to use paid APIs.</p>
                    <Button onClick={createWallet} disabled={creating} className="w-fit font-mono tracking-wider uppercase">
                      <Wallet /> {creating ? "Creating..." : "Create wallet"}
                    </Button>
                  </div>
                )}
                {wallet?.address && <WalletDetails wallet={wallet} onRefresh={loadWallet} />}
              </SetupStep>

              <SetupStep number={3} title="Chat with your agent" done={messages.some((m) => m.role === "agent" && !m.error)} last>
                <p className="text-muted-foreground">Pick an example prompt, or ask anything.</p>
              </SetupStep>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionTitle num="02" title="Tools" />
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {status?.tools.map((t) => (
                <div key={t.name}>
                  <p className="font-mono text-sm">
                    <span className="text-primary">&gt;</span> {t.name}
                  </p>
                  <p className="mt-1 text-muted-foreground">{t.description}</p>
                </div>
              ))}
              <p className="border-t pt-4 text-muted-foreground">
                Add your own in <Code>agent/tools.ts</Code>. Save, and it shows up here.
              </p>
            </CardContent>
          </Card>
        </aside>

        {/* Right: chat */}
        <Card className="flex h-[calc(100vh-4rem)] min-h-[560px] flex-col lg:sticky lg:top-8">
          <CardHeader className="border-b">
            <SectionTitle num="03" title="Chat" />
            <CardAction>
              <Button variant="ghost" size="sm" className="font-mono uppercase" onClick={() => setMessages([])} disabled={messages.length === 0 || thinking}>
                <RotateCcw /> Clear
              </Button>
            </CardAction>
          </CardHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-5 px-4 py-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center gap-5 py-16 text-center">
                  <div className="flex size-12 items-center justify-center bg-primary text-primary-foreground">
                    <Bot className="size-6" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold tracking-tight uppercase">Ask your agent something</p>
                    <p className="mt-1 text-muted-foreground">
                      {!ready
                        ? "Add your Gemini API key to start."
                        : wallet && !wallet.address
                          ? "Tip: create a wallet first so the agent can pay for the contract checker and weather API."
                          : "Pick an example to start."}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {EXAMPLES.map((e) => (
                      <Button
                        key={e.label}
                        variant="outline"
                        onClick={() => (e.prefill ? setInput(e.prompt) : send(e.prompt))}
                        disabled={!ready}
                        className="h-auto max-w-full font-mono whitespace-normal"
                      >
                        <span className="text-primary">&gt;</span> {e.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="max-w-[85%] self-end bg-primary px-4 py-2.5 font-medium break-words whitespace-pre-wrap text-primary-foreground">
                    {m.text}
                  </div>
                ) : (
                  <div key={i} className="flex max-w-[85%] gap-3 self-start">
                    <div className="flex size-8 shrink-0 items-center justify-center border">
                      <Bot className="size-4 text-primary" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-2">
                      {m.steps?.map((s, j) => <ToolCall key={j} step={s} />)}
                      <div className={cn("px-4 py-2.5 whitespace-pre-wrap", m.error ? "flex gap-2 bg-destructive/10 text-destructive" : "bg-muted")}>
                        {m.error && <CircleAlert className="mt-0.5 size-4 shrink-0" />}
                        {m.text}
                      </div>
                    </div>
                  </div>
                )
              )}

              {thinking && (
                <p className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
                  agent is thinking <span className="inline-block h-4 w-2 animate-pulse bg-primary" />
                </p>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <CardFooter className="border-t pt-4">
            <form
              className="flex w-full gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <div className={cn("flex min-w-0 flex-1 items-start border border-input bg-background focus-within:border-primary", !ready && "opacity-50")}>
                <span className="hidden pt-3 pl-3 font-mono text-base whitespace-nowrap text-muted-foreground sm:inline md:text-sm">~/devpulse $</span>
                {/* A textarea (not an input) so pasted Solidity keeps its line breaks. Enter sends, Shift+Enter adds a line. */}
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  rows={Math.min(8, Math.max(1, input.split("\n").length))}
                  placeholder={ready ? "ask DevPulse something, or paste Solidity code..." : "add your Gemini API key to start"}
                  disabled={!ready}
                  aria-label="Message"
                  className="min-h-11 w-full min-w-0 resize-none bg-transparent px-3 py-2.5 font-mono text-base outline-none placeholder:text-muted-foreground md:text-sm"
                />
              </div>
              <Button type="submit" className="h-auto px-5" disabled={!ready || thinking || !input.trim()} aria-label="Send">
                <SendHorizontal />
              </Button>
            </form>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="flex items-center font-mono text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase">{children}</p>;
}

function SectionTitle({ num, title }: { num: string; title: string }) {
  return (
    <p className="font-mono text-xs font-medium tracking-[0.06em] uppercase">
      <span className="text-primary">{num}</span>
      <span className="ml-3 text-muted-foreground">{title}</span>
    </p>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>;
}

function SetupStep(props: { number: number; title: string; done: boolean; last?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center border-2 font-mono text-xs font-bold",
            props.done ? "border-primary bg-primary text-primary-foreground" : "border-primary text-primary"
          )}
        >
          {props.done ? <Check className="size-3.5" strokeWidth={3} /> : props.number}
        </span>
        {!props.last && <span className={cn("w-0.5 flex-1", props.done ? "bg-primary" : "bg-border")} />}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-2", !props.last && "pb-6")}>
        <p className="font-bold tracking-tight uppercase">{props.title}</p>
        {props.children}
      </div>
    </div>
  );
}

function WalletDetails({ wallet, onRefresh }: { wallet: WalletInfo; onRefresh: () => void }) {
  const [copied, setCopied] = useState(false);
  const address = wallet.address!;

  function copy() {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-3 border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <code className="truncate font-mono text-xs text-primary">{address}</code>
        <Button variant="ghost" size="icon-xs" onClick={copy} aria-label="Copy address">
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <div className="flex items-center justify-between font-mono text-xs text-muted-foreground uppercase">
        <span>
          Balance <span className="text-foreground">{wallet.balance}</span>
        </span>
        <Button variant="ghost" size="icon-xs" onClick={onRefresh} aria-label="Refresh balance">
          <RefreshCw />
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 font-mono text-xs uppercase">
        <a className="inline-flex items-center gap-1 hover:text-primary" href={`https://sepolia.basescan.org/address/${address}`} target="_blank" rel="noreferrer">
          Explorer <ExternalLink className="size-3" />
        </a>
        <a className="inline-flex items-center gap-1 hover:text-primary" href="https://docs.base.org/base-chain/tools/network-faucets" target="_blank" rel="noreferrer">
          Get test ETH <ExternalLink className="size-3" />
        </a>
      </div>
      <p className="text-xs text-muted-foreground">Base Sepolia testnet. Saved in .agent-wallet.json.</p>
    </div>
  );
}

type PaymentInfo = { status: number; amount: string; to: string; signature: string };

function ToolCall({ step }: { step: Step }) {
  const payment: PaymentInfo | undefined = step.result?.payment;
  // A payment only counts as successful if the API verified it and answered 200.
  const verified = payment?.status === 200;
  return (
    <Collapsible className="border font-mono text-xs">
      <CollapsibleTrigger className="group flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-muted">
        <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
        <span className="text-muted-foreground uppercase">Tool</span>
        <span className="break-all text-primary">{step.tool}</span>
        <span className="ml-auto flex gap-2">
          {payment &&
            (verified ? (
              <Badge className="bg-blue font-mono text-foreground uppercase">Paid {payment.amount}</Badge>
            ) : (
              <Badge variant="destructive" className="font-mono uppercase">Payment rejected</Badge>
            ))}
          {step.error && <Badge variant="destructive" className="font-mono uppercase">Failed</Badge>}
        </span>
      </CollapsibleTrigger>
      {payment && <PaymentFlow payment={payment} verified={verified} reason={step.result?.data?.reason} />}
      <CollapsibleContent className="flex flex-col gap-2 border-t px-3 py-2">
        <Json label="Input" value={step.args} />
        <Json label="Output" value={step.result} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The x402 steps for one paid call: payment required → signature → verified / failed. */
function PaymentFlow({ payment, verified, reason }: { payment: PaymentInfo; verified: boolean; reason?: string }) {
  const steps = [
    { ok: true, label: "Payment required", detail: `402 · ${payment.amount}` },
    { ok: true, label: "Signature generated", detail: payment.signature },
    verified
      ? { ok: true, label: "Verification successful", detail: "200 OK" }
      : { ok: false, label: "Verification failed", detail: `HTTP ${payment.status}${reason ? ` · ${reason}` : ""}` },
  ];
  return (
    <div className="flex flex-col gap-1 border-t px-3 py-2" aria-label="Payment flow">
      {steps.map((s) => (
        <p key={s.label} className={cn("flex flex-wrap items-center gap-x-2", !s.ok && "text-destructive")}>
          {s.ok ? <Check className="size-3.5 text-primary" /> : <X className="size-3.5" />}
          <span className="uppercase">{s.label}</span>
          <span className="break-all text-muted-foreground">{s.detail}</span>
        </p>
      ))}
      <p className="text-muted-foreground">Signed mock payment. No funds moved on-chain.</p>
    </div>
  );
}

function Feature(props: { icon: React.ReactNode; title: string; price: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border bg-card p-3">
      <div className="flex size-8 shrink-0 items-center justify-center bg-primary text-primary-foreground">{props.icon}</div>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-bold tracking-tight uppercase">
          {props.title} <span className="font-mono text-xs font-medium text-primary">{props.price}</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{props.children}</p>
      </div>
    </div>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-muted-foreground uppercase">{label}</p>
      <pre className="overflow-x-auto bg-background p-2">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
