"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Building2, ShieldCheck, Coins, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MetaMaskIcon } from "@/components/icons/metamask";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { signIn, registerWallet } from "@/lib/auth";
import { getSession } from "@/lib/api";
import { toast } from "sonner";
import { cn, shortAddress } from "@/lib/utils";

type Role = "investor" | "property_owner" | "tenant";

const ROLE_OPTIONS: { id: Role; title: string; description: string }[] = [
  { id: "investor", title: "Investor", description: "Buy fractional property tokens and earn rental yield." },
  { id: "tenant", title: "Tenant", description: "Rent a property and pay monthly rent on-chain." },
  { id: "property_owner", title: "Property Owner", description: "List and manage real estate properties." },
];

export default function LandingPage() {
  const router = useRouter();
  const [view, setView] = useState<"connect" | "register" | "redirect">("connect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingWallet, setPendingWallet] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [email, setEmail] = useState("");

  useEffect(() => {
    const session = getSession();
    if (session?.user?.role) {
      router.replace(`/${session.user.role}`);
    }
  }, [router]);

  async function handleConnect() {
    setError(null);
    setBusy(true);
    try {
      const result = await signIn();
      if (result.status === "authenticated") {
        toast.success("Signed in.");
        setView("redirect");
        router.push(`/${result.session.user.role}`);
      } else {
        setPendingWallet(result.walletAddress);
        setRole(null);
        setView("register");
      }
    } catch (e: any) {
      const msg = e?.message || "Sign-in failed.";
      const isReject = /denied|rejected/i.test(msg);
      setError(isReject ? "Signature canceled in MetaMask." : msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister() {
    if (!pendingWallet || !role) return;
    setError(null);
    setBusy(true);
    try {
      const session = await registerWallet({
        walletAddress: pendingWallet,
        role,
        email: email.trim() || null,
      });
      toast.success("Account created.");
      setView("redirect");
      router.push(`/${session.user.role}`);
    } catch (e: any) {
      setError(e?.message || "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-30 [mask-image:radial-gradient(ellipse_at_center,white,transparent_70%)]" />
      <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />

      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary to-chart-2 font-bold text-primary-foreground">
            E
          </div>
          <span className="text-base font-semibold">EstateChain</span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://sepolia.etherscan.io"
            target="_blank"
            rel="noreferrer"
            className="hidden text-xs text-muted-foreground hover:text-foreground sm:inline"
          >
            Sepolia explorer
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-12 px-6 pb-24 pt-12 md:grid-cols-[1.2fr_1fr] md:gap-16 md:pt-20 md:pb-32">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col"
        >
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Live on Ethereum Sepolia
          </span>
          <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            Tokenized real estate, <span className="text-primary">on-chain rent.</span>
          </h1>
          <p className="mt-5 max-w-xl text-balance text-base text-muted-foreground md:text-lg">
            EstateChain turns properties into fractional ERC-20 tokens, and pays rent directly to investors
            through a single rent contract. No intermediaries, no spreadsheets — just on-chain ownership.
          </p>
          <ul className="mt-8 grid max-w-xl gap-3 text-sm md:grid-cols-2">
            {[
              { icon: Building2, label: "Property tokenization" },
              { icon: Coins, label: "Automatic rent distribution" },
              { icon: ShieldCheck, label: "Wallet-based authentication" },
              { icon: BarChart2, label: "Live portfolio analytics" },
            ].map((f) => (
              <li
                key={f.label}
                className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2"
              >
                <f.icon className="h-4 w-4 text-primary" />
                <span className="text-foreground/90">{f.label}</span>
              </li>
            ))}
          </ul>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="rounded-2xl border border-border bg-card/80 p-6 shadow-2xl shadow-black/5 backdrop-blur md:p-7"
        >
          {view === "connect" && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Sign in with your wallet</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  We use a MetaMask signature as your identity. No passwords, no gas.
                </p>
              </div>
              <Button onClick={handleConnect} disabled={busy} size="lg" className="gap-2">
                <MetaMaskIcon size={18} />
                {busy ? "Awaiting signature…" : "Connect with MetaMask"}
              </Button>
              {error && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}
              <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                <li>• You'll sign a one-time message. Nothing is broadcast on-chain.</li>
                <li>• Your wallet is your identity. Roles are bound at sign-up.</li>
                <li>• Network: Sepolia (chainId 11155111).</li>
              </ul>
            </div>
          )}

          {view === "register" && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Welcome to EstateChain</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick how you'll use the platform. This choice is bound to your wallet.
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
                {shortAddress(pendingWallet, 8, 6)}
              </div>
              <div className="flex flex-col gap-2">
                {ROLE_OPTIONS.map((opt) => {
                  const active = role === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setRole(opt.id)}
                      className={cn(
                        "flex flex-col gap-1 rounded-lg border px-3 py-3 text-left transition-colors",
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:bg-muted",
                      )}
                    >
                      <span className="text-sm font-medium">{opt.title}</span>
                      <span className="text-xs text-muted-foreground">{opt.description}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email (optional)</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Button onClick={handleRegister} disabled={busy || !role} size="lg">
                  {busy ? "Signing…" : "Create Account"}
                  {!busy && <ArrowRight className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPendingWallet(null);
                    setRole(null);
                    setError(null);
                    setView("connect");
                  }}
                >
                  Use a different wallet
                </Button>
              </div>
              {error && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}

          {view === "redirect" && (
            <div className="flex flex-col items-start gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Signed in</h2>
              <p className="text-sm text-muted-foreground">Redirecting to your dashboard…</p>
            </div>
          )}
        </motion.section>
      </main>

      <footer className="border-t border-border/60 px-6 py-5 text-xs text-muted-foreground md:px-10">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 md:flex-row md:items-center">
          <span>© {new Date().getFullYear()} EstateChain — Tokenized real estate on Sepolia.</span>
          <span className="font-mono">chainId 0xaa36a7</span>
        </div>
      </footer>
    </div>
  );
}
