/* ══════════════════════════════════════════════════
   EstateChain — Shared Utilities
   All dashboards load this file for common functionality.
   ══════════════════════════════════════════════════ */

const EXPECTED_CHAIN_ID = 11155111;
const EXPECTED_CHAIN_HEX = "0x" + EXPECTED_CHAIN_ID.toString(16);
const SEPOLIA_CHAIN_NAME = "Sepolia Testnet";
const SEPOLIA_PUBLIC_RPC = "https://ethereum-sepolia.publicnode.com";
const SEPOLIA_EXPLORER_TX_BASE = "https://sepolia.etherscan.io/tx/";
const TOKEN_DECIMALS = 18;
const RENT_TOKEN_DECIMALS = 6;

function getRuntimeConfig() {
  return window.__ESTATECHAIN_CONFIG__ || {};
}

async function getRuntimeConfigAsync() {
  if (window.__ESTATECHAIN_CONFIG__) {
    return window.__ESTATECHAIN_CONFIG__;
  }
  try {
    const config = await apiRequest("/config");
    window.__ESTATECHAIN_CONFIG__ = config;
    return config;
  } catch (_e) {
    return getRuntimeConfig();
  }
}

window.getRuntimeConfigAsync = getRuntimeConfigAsync;

function getApiBaseUrl() {
  const runtimeBase = getRuntimeConfig().API_BASE_URL;
  const metaBase = document.querySelector('meta[name="api-base-url"]')?.content || "";
  if (typeof runtimeBase === "string" && runtimeBase.trim()) {
    return runtimeBase.trim().replace(/\/$/, "");
  }
  if (metaBase.trim()) {
    return metaBase.trim().replace(/\/$/, "");
  }

  const host = window.location?.hostname || "";
  const isStaticHost = /\.vercel\.app$/i.test(host) || /\.netlify\.app$/i.test(host);
  if (isStaticHost) {
    console.error(
      "[EstateChain] API_BASE_URL is missing. Set BACKEND_URL or API_BASE_URL in the frontend host and redeploy."
    );
    return "";
  }

  if (window.location.origin && window.location.origin !== "null") {
    return window.location.origin.replace(/\/$/, "");
  }
  return "";
}

window.getApiBaseUrl = getApiBaseUrl;

const API_BASE = getApiBaseUrl();

const wallet = {
  connected: false,
  address: null,
  balance: null,
  chainOk: true,
  accounts: [],
  _listeners: [],
  onChange(callback) {
    if (typeof callback === "function") {
      this._listeners.push(callback);
    }
  },
  _notify() {
    this._listeners.forEach((listener) => {
      try {
        listener(this);
      } catch (error) {
        console.error("wallet listener error:", error);
      }
    });
  }
};
window.wallet = wallet;

const SALE_CONTRACT_ABI = [
  "function propertyId() view returns (uint256)",
  "function salePricePerTokenWei() view returns (uint256)",
  "function invest(uint256 propertyId, uint256 tokenAmount) payable",
  "event InvestmentCompleted(address indexed investor, uint256 indexed propertyId, uint256 tokenAmount, uint256 ethSpent)"
];
const RENT_DISTRIBUTION_ABI = [
  "function payRent(uint256 propertyId) payable",
  "function claimRewards(uint256 propertyId)",
  "function claimableRewards(address investor) view returns (uint256)",
  "function propertyClaimableRewards(uint256 propertyId, address investor) view returns (uint256)",
  "function totalClaimedRewards(address investor) view returns (uint256)",
  "function getPropertyInfo(uint256 propertyId) view returns (address tokenContract, uint256 monthlyRentWei, bool active, uint256 investorCount)",
  "function calculateDistribution(uint256 propertyId, uint256 rentAmount) view returns (address[] investors, uint256[] payouts, uint256[] bps)",
  "function getInvestors(uint256 propertyId) view returns (address[])",
  "event RentPaid(uint256 indexed propertyId, address indexed tenant, uint256 amount)",
  "event InvestorPaid(uint256 indexed propertyId, address indexed investor, uint256 amount, uint256 ownershipBps)",
  "event RentDistributed(uint256 indexed propertyId, uint256 totalAmount, uint256 investorCount)",
  "event RewardsAccrued(uint256 indexed propertyId, address indexed investor, uint256 amount, uint256 ownershipBps)",
  "event RewardsClaimed(uint256 indexed propertyId, address indexed investor, uint256 amount)"
];

/* ── Helpers ── */
function hasMetaMask() { return typeof window.ethereum !== "undefined"; }
function getEthers() { if (!window.ethers) throw new Error("ethers.js not loaded"); return window.ethers; }
function getSaleContract(prop, sp) { if (!prop?.token_address) throw new Error("Token contract not deployed"); return new (getEthers()).Contract(prop.token_address, SALE_CONTRACT_ABI, sp); }
function formatWeiAsEth(w) { return getEthers().utils.formatEther(w); }
function formatAddress(a) { if (!a || a.length < 10) return a || "--"; return a.slice(0, 6) + "..." + a.slice(-4); }
function formatCurrency(n) { const v = Number(n || 0); return Number.isFinite(v) ? v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }) : "$0.00"; }
function formatTokenAmount(n, d = 4) { const v = Number(n || 0); return Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: d }) : "0"; }
function normalizeWallet(a) { return (a || "").trim().toLowerCase(); }
function safeNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* ── Decimal-safe helpers for blockchain values ── */
function _sanitizeDecimalForUnits(value, decimals) {
  // Produce a plain decimal string with at most `decimals` fractional digits.
  // Never round via Number() — that causes IEEE-754 precision loss on blockchain values.
  // Callers that pass more fractional digits than `decimals` are treated as a bug: we truncate.
  if (value === null || value === undefined) return "0";
  let s = String(value).trim();
  if (!s) return "0";

  // Reject scientific notation — require callers to pass plain decimal strings.
  if (/e/i.test(s)) {
    throw new Error(`Refusing to parse scientific-notation blockchain value: ${s}`);
  }

  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);

  const dotIndex = s.indexOf(".");
  if (dotIndex === -1) {
    return (negative ? "-" : "") + (s || "0");
  }
  const intPart = s.slice(0, dotIndex) || "0";
  let frac = s.slice(dotIndex + 1);
  if (frac.length > decimals) {
    // Truncate (floor toward zero) — deterministic, no floating-point involvement.
    frac = frac.slice(0, decimals);
  }
  const out = frac ? intPart + "." + frac : intPart;
  return (negative ? "-" : "") + out;
}

function safeParseEther(value) {
  const ethers = getEthers();
  const sanitized = _sanitizeDecimalForUnits(value, 18);
  return ethers.utils.parseUnits(String(sanitized), 18);
}

function safeParseUnits(value, decimals) {
  const ethers = getEthers();
  const dec = Number(decimals || TOKEN_DECIMALS) || TOKEN_DECIMALS;
  const sanitized = _sanitizeDecimalForUnits(value, dec);
  return ethers.utils.parseUnits(String(sanitized), dec);
}

function safeBigNumberFrom(value, decimals) {
  const ethers = getEthers();
  const s = String(value || "0");
  if (s.indexOf('.') !== -1) {
    // Decimal string — convert via parseUnits
    return safeParseUnits(s, decimals || TOKEN_DECIMALS);
  }
  // integer-like string — use BigNumber directly
  return ethers.BigNumber.from(s);
}

function decimalMultiplyToUnits(valueDecimal, multiplier, decimals) {
  // Multiply a decimal string `valueDecimal` by integer `multiplier` and return BigNumber in base units.
  // Example: valueDecimal="0.1", multiplier=3, decimals=18 => parseUnits("0.1",18).mul(3)
  const base = safeParseUnits(valueDecimal, decimals);
  return base.mul(ethers.BigNumber.from(String(multiplier)));
}
function toTokenUnits(b, dec = TOKEN_DECIMALS) { const v = Number(b || 0); if (!Number.isFinite(v)) return 0; const d = Math.pow(10, dec); return d ? v / d : v; }
function formatBaseTokenAmount(b, dec = TOKEN_DECIMALS, mf = 4) { return formatTokenAmount(toTokenUnits(b, dec), mf); }
function getMinimumSpend(p) { const t = Number(p.total_value || 0), s = Number(p.token_supply || 0); return s > 0 ? t / s : 0; }
function isUserRejectedTransactionError(e) { return /user denied|user rejected|rejected the request|transaction signature/i.test(String(e?.message || e || "")); }
function formatInvestmentError(e) {
  if (isUserRejectedTransactionError(e)) return "Transaction canceled in MetaMask.";
  const m = String(e?.reason || e?.data?.message || e?.message || e || "");
  if (/insufficient funds/i.test(m)) return "Insufficient ETH balance.";
  if (/cannot estimate gas|UNPREDICTABLE_GAS_LIMIT/i.test(m)) return "Gas estimation failed.";
  if (/execution reverted|revert/i.test(m)) return m.replace(/^.*revert(?:ed)?:\s*/i, "") || "Transaction reverted.";
  return m || "Transaction failed.";
}

/* ── API ── */
function _attachAuthHeader(headers) {
  try {
    const auth = window.EstateChainAuth;
    if (!auth) return headers;
    const token = auth.getToken && auth.getToken();
    if (token && !headers.Authorization) {
      return { ...headers, Authorization: `Bearer ${token}` };
    }
  } catch (_) { /* ignore */ }
  return headers;
}

function _handleAuthFailureInUtils(status, path) {
  if (status !== 401) return;
  try {
    const auth = window.EstateChainAuth;
    if (auth && typeof auth.clearSession === "function") auth.clearSession();
    const onLanding = (window.location.pathname || "/") === "/";
    const isAuthPath = (path || "").startsWith("/auth/");
    if (!onLanding && !isAuthPath) window.location.href = "/";
  } catch (_) { /* ignore */ }
}

async function apiRequest(path, options = {}) {
  if (!API_BASE) {
    throw new Error(
      "Backend URL not configured. Set BACKEND_URL=https://estatechain-backend.onrender.com in Vercel, redeploy, and ensure Render CORS allows this Vercel origin."
    );
  }
  const headers = _attachAuthHeader({ "Content-Type": "application/json", ...(options.headers || {}) });
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const contentType = (res.headers.get("content-type") || "").toLowerCase();

  // Handle non-OK responses with best-effort parsing
  if (!res.ok) {
    let errText = res.statusText || `HTTP ${res.status}`;
    try {
      if (contentType.includes("application/json")) {
        const payload = await res.json();
        errText = payload.detail || JSON.stringify(payload);
      } else {
        // Try to capture textual/HTML error body for debugging
        const txt = await res.text();
        errText = txt ? txt.slice(0, 200) : errText;
      }
    } catch (_e) {
      // ignore parsing errors
    }
    _handleAuthFailureInUtils(res.status, path);
    const err = new Error(errText);
    err.status = res.status;
    err.path = path;
    throw err;
  }

  // If the response is JSON, parse and return it
  if (contentType.includes("application/json")) {
    return res.json();
  }

  // If we receive HTML or plain text where JSON is expected, throw a helpful error
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    const preview = (text || "").slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`Expected JSON but received non-JSON response. Response preview: ${preview}`);
  }
}

/* ── Theme ── */
function ensureThemeToggleMarkup(toggle) {
  if (!toggle) return null;
  const isSlider = toggle.classList.contains("theme-toggle") && !!toggle.querySelector(".theme-toggle-track");
  if (isSlider) return toggle;

  toggle.classList.add("theme-toggle");
  toggle.classList.remove("ghost");
  toggle.setAttribute("type", "button");
  toggle.innerHTML = `
    <span class="theme-toggle-track" aria-hidden="true">
      <span class="theme-toggle-icon theme-toggle-icon--sun">☀</span>
      <span class="theme-toggle-thumb"></span>
      <span class="theme-toggle-icon theme-toggle-icon--moon">☾</span>
    </span>`;
  return toggle;
}

function applyTheme(theme) {
  const light = theme === "light";
  document.body.classList.toggle("light-theme", light);
  const toggle = ensureThemeToggleMarkup(document.getElementById("theme-toggle"));
  if (!toggle) return;
  toggle.classList.toggle("is-light", light);
  const nextLabel = light ? "Switch to dark mode" : "Switch to light mode";
  toggle.setAttribute("aria-label", nextLabel);
  toggle.setAttribute("title", nextLabel);
}
function initTheme() {
  applyTheme(localStorage.getItem("estatechain-theme") || "dark");
  const toggle = ensureThemeToggleMarkup(document.getElementById("theme-toggle"));
  if (!toggle) return;
  const onToggle = () => {
    const next = document.body.classList.contains("light-theme") ? "dark" : "light";
    localStorage.setItem("estatechain-theme", next);
    applyTheme(next);
  };
  toggle.addEventListener("click", onToggle);
}

/* ── Health ── */
function initHealthCheck() {
  const dot = document.getElementById("status-dot");
  async function check() {
    try { await apiRequest("/health"); dot && dot.classList.add("active"); }
    catch { dot && dot.classList.remove("active"); }
  }
  check(); setInterval(check, 10000);
}

/* ── Wallet Validation ── */
async function validateWalletState() {
  const issues = [];

  // Check MetaMask installation
  if (!hasMetaMask()) {
    issues.push({
      type: 'metamask_missing',
      message: 'MetaMask is not installed. Please install it from metamask.io',
      action: 'install',
      url: 'https://metamask.io/download/'
    });
    return { valid: false, issues, canConnect: false };
  }

  // Check if wallet is connected
  if (!wallet.connected || !wallet.address) {
    issues.push({
      type: 'not_connected',
      message: 'Please connect your MetaMask wallet',
      action: 'connect'
    });
    return { valid: false, issues, canConnect: true };
  }

  // Check chain
  if (!wallet.chainOk) {
    const currentChainId = await window.ethereum.request({ method: "eth_chainId" }).catch(() => null);
    const currentChainName = getChainName(currentChainId);
    issues.push({
      type: 'wrong_chain',
      message: `Please switch to ${SEPOLIA_CHAIN_NAME}. Currently on ${currentChainName || 'unknown network'}`,
      action: 'switch_chain',
      currentChain: currentChainId,
      expectedChain: EXPECTED_CHAIN_HEX
    });
    return { valid: false, issues, canConnect: true };
  }

  // Check contract availability
  try {
    const config = await getRuntimeConfigAsync();
    const contracts = config.contracts || config.CONTRACT_ADDRESSES || {};
    const escrowAddress = contracts.Escrow;
    const propertyNFTAddress = contracts.PropertyNFT;
    const rentDistributionAddress = contracts.RentDistribution;
    if (!escrowAddress || !propertyNFTAddress || !rentDistributionAddress) {
      issues.push({
        type: 'contracts_unavailable',
        message: 'Smart contracts are not available. Please try again later.',
        action: 'retry'
      });
      return { valid: false, issues, canConnect: true };
    }
  } catch (e) {
    issues.push({
      type: 'config_error',
      message: 'Unable to load contract configuration. Please check your connection.',
      action: 'retry'
    });
    return { valid: false, issues, canConnect: true };
  }

  return { valid: true, issues: [] };
}

function getChainName(chainIdHex) {
  const chainId = parseInt(chainIdHex, 16);
  const chainNames = {
    1: 'Ethereum Mainnet',
    11155111: 'Sepolia Testnet',
    137: 'Polygon',
    80001: 'Mumbai Testnet',
    42161: 'Arbitrum One',
    10: 'Optimism'
  };
  return chainNames[chainId] || `Chain ${chainId}`;
}

async function handleWalletValidationIssue(issue) {
  switch (issue.action) {
    case 'install':
      if (confirm(`${issue.message}\n\nOpen MetaMask download page?`)) {
        window.open(issue.url, '_blank');
      }
      break;
    case 'connect':
      await walletConnect();
      break;
    case 'switch_chain':
      await walletSwitchChain();
      break;
    case 'retry':
      // Will be retried on next validation check
      break;
  }
}

async function ensureWalletReady() {
  const validation = await validateWalletState();
  if (!validation.valid) {
    const primaryIssue = validation.issues[0];
    await handleWalletValidationIssue(primaryIssue);
    // Re-validate after handling
    const recheck = await validateWalletState();
    if (!recheck.valid) {
      throw new Error(recheck.issues.map(i => i.message).join('\n'));
    }
  }
  return true;
}

// Expose functions globally for HTML access
window.validateWalletState = validateWalletState;
window.ensureWalletReady = ensureWalletReady;
window.walletConnect = walletConnect;
window.walletSwitchChain = walletSwitchChain;

async function walletConnect() {
  if (!hasMetaMask()) { alert("MetaMask is not installed. Please install it from metamask.io"); return; }
  try {
    const a = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!a.length) return;
    wallet.connected = true; wallet.address = a[0];
    await walletCheckChain(); await walletRefreshBalance(); await walletLoadAccounts();
    wallet._notify();
  } catch (e) { if (e.code !== 4001) console.error("Connect failed:", e); }
}
function walletDisconnect() { wallet.connected = false; wallet.address = null; wallet.balance = null; wallet.chainOk = true; wallet._notify(); }
async function walletCheckChain() { try { const c = await window.ethereum.request({ method: "eth_chainId" }); wallet.chainOk = parseInt(c, 16) === EXPECTED_CHAIN_ID; } catch { wallet.chainOk = false; } }
async function walletSwitchChain() {
  if (!hasMetaMask()) return;
  try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: EXPECTED_CHAIN_HEX }] }); }
  catch (e) { if (e.code === 4902) { await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: EXPECTED_CHAIN_HEX, chainName: SEPOLIA_CHAIN_NAME, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: [SEPOLIA_PUBLIC_RPC], blockExplorerUrls: ["https://sepolia.etherscan.io"] }] }); } }
  await walletCheckChain(); wallet._notify();
}
async function walletRefreshBalance() {
  if (!wallet.connected || !wallet.address) return;
  try {
    const h = await window.ethereum.request({ method: "eth_getBalance", params: [wallet.address, "latest"] });
    // Use ethers.formatEther to preserve precision for large balances.
    wallet.balance = Number(getEthers().utils.formatEther(h));
    wallet.balanceWei = String(BigInt(h));
  } catch {
    wallet.balance = null;
    wallet.balanceWei = null;
  }
  if (wallet.accounts.length) {
    wallet.accounts = wallet.accounts.map((account) => ({ ...account, balance_eth: wallet.balance ?? account.balance_eth ?? 0 }));
  }
}
function getAccountsForRole(role) {
  return wallet.accounts;
}

function getRoleLabel(index, role) {
  if (role) return "MetaMask Wallet";
  return `Wallet ${index}`;
}

function getAccountRole(index) {
  return index === 0 ? "wallet" : "other";
}

async function walletLoadAccounts() {
  wallet.accounts = wallet.connected && wallet.address
    ? [{ address: wallet.address, label: "MetaMask Wallet", role: "wallet", balance_eth: wallet.balance ?? 0, index: 0 }]
    : [];
}
function walletInit() {
  if (!hasMetaMask()) return;

  // Handle account changes (including disconnection)
  window.ethereum.on("accountsChanged", async (accounts) => {
    if (!accounts || accounts.length === 0) {
      walletDisconnect();
      return;
    }

    const newAddress = accounts[0];
    if (wallet.address !== newAddress) {
      wallet.address = newAddress;
      wallet.connected = true;
      await Promise.all([
        walletCheckChain(),
        walletRefreshBalance(),
        walletLoadAccounts()
      ]);
      wallet._notify();
    }
  });

  // Handle chain changes
  window.ethereum.on("chainChanged", async () => {
    await walletCheckChain();
    if (wallet.connected) {
      await walletRefreshBalance();
    }
    wallet._notify();
  });

  // Handle disconnection
  window.ethereum.on("disconnect", () => {
    walletDisconnect();
  });

  // Initial connection check
  window.ethereum.request({ method: "eth_accounts" }).then(async (accounts) => {
    if (accounts && accounts.length > 0) {
      wallet.connected = true;
      wallet.address = accounts[0];
      await Promise.all([
        walletCheckChain(),
        walletRefreshBalance(),
        walletLoadAccounts()
      ]);
      wallet._notify();
    }
  }).catch(() => {
    // Silently fail initial check - user will connect manually
  });

  // Periodic balance updates for connected wallet
  setInterval(() => {
    if (wallet.connected) {
      walletRefreshBalance().then(() => wallet._notify()).catch(() => {});
    }
  }, 10000);

  // Periodic account refresh (less frequent)
  setInterval(() => {
    if (wallet.connected) {
      walletLoadAccounts().then(() => wallet._notify()).catch(() => {});
    }
  }, 30000);
}

/* ── Wallet UI ── */
let walletValidationState = { valid: true, issues: [], lastChecked: 0 };

async function updateWalletValidationUI() {
  const validationEl = document.getElementById("wallet-validation");
  const issuesEl = document.getElementById("wallet-issues");

  if (!validationEl || !issuesEl) return;

  // Throttle validation checks
  const now = Date.now();
  if (now - walletValidationState.lastChecked < 2000) return;
  walletValidationState.lastChecked = now;

  try {
    const validation = await validateWalletState();
    walletValidationState = { ...validation, lastChecked: now };

    validationEl.classList.toggle("valid", validation.valid);
    validationEl.classList.toggle("invalid", !validation.valid);

    if (validation.valid) {
      issuesEl.innerHTML = "";
      issuesEl.style.display = "none";
    } else {
      const issuesHTML = validation.issues.map(issue => `
        <div class="wallet-issue" data-type="${issue.type}">
          <span class="wallet-issue-message">${issue.message}</span>
          ${issue.action === 'switch_chain' ? `<button class="wallet-issue-action" onclick="walletSwitchChain()">Switch to Sepolia</button>` : ''}
          ${issue.action === 'connect' ? `<button class="wallet-issue-action" onclick="walletConnect()">Connect Wallet</button>` : ''}
          ${issue.action === 'install' ? `<button class="wallet-issue-action" onclick="window.open('${issue.url}', '_blank')">Install MetaMask</button>` : ''}
        </div>
      `).join("");
      issuesEl.innerHTML = issuesHTML;
      issuesEl.style.display = "block";
    }
  } catch (e) {
    console.error("Wallet validation error:", e);
    validationEl.classList.add("invalid");
    issuesEl.innerHTML = `<div class="wallet-issue"><span class="wallet-issue-message">Unable to validate wallet state</span></div>`;
    issuesEl.style.display = "block";
  }
}

function renderWalletUI() {
  const btn = document.getElementById("mm-connect"), txt = document.getElementById("mm-btn-text"),
    pill = document.getElementById("wallet-pill"), addr = document.getElementById("mm-address"),
    cw = document.getElementById("chain-warning");

  if (wallet.connected && wallet.address) {
    btn && btn.classList.add("connected");
    txt && (txt.textContent = formatAddress(wallet.address));
    pill && (pill.style.display = "flex");
    addr && (addr.textContent = formatAddress(wallet.address));
  } else {
    btn && btn.classList.remove("connected");
    txt && (txt.textContent = "Connect Wallet");
    pill && (pill.style.display = "none");
  }

  cw && cw.classList.toggle("visible", !wallet.chainOk && wallet.connected);

  // Update validation UI
  updateWalletValidationUI();
}
function initWalletUI() {
  const c = document.getElementById("mm-connect"), d = document.getElementById("mm-disconnect"), s = document.getElementById("chain-switch-btn");
  if (c) c.addEventListener("click", walletConnect);
  if (d) d.addEventListener("click", walletDisconnect);
  if (s) s.addEventListener("click", walletSwitchChain);
  wallet.onChange(renderWalletUI);
  walletInit();
  renderWalletUI();

  // Periodic validation updates
  setInterval(() => {
    if (hasMetaMask()) {
      updateWalletValidationUI();
    }
  }, 5000);
}

/* ── Shared Templates ── */
function propertyCardHTML(property, opts = {}) {
  const minSpend = getMinimumSpend(property);
  const totalSupply = Number(property.token_supply || 0);
  const available = Number(property.tokens_available ?? property.token_supply ?? 0);
  const sold = Number(property.tokens_sold ?? 0);
  const soldPct = Math.min(100, Math.max(0, Number(property.sold_percentage ?? 0)));
  return `<article class="property-card"><div class="property-body">
    <div class="property-top"><span class="pill">Property #${property.id}</span><span class="badge-hot">${Number(property.total_value || 0) > 1000000 ? "Hot" : "Live"}</span></div>
    <h3>${property.name}</h3><p class="muted">${property.location}</p>
    <div class="metrics">
      <div class="metric"><span>Total Value</span><strong>${formatCurrency(property.total_value)}</strong></div>
      <div class="metric"><span>Total Supply</span><strong>${totalSupply.toLocaleString()}</strong></div>
      <div class="metric"><span>Available Tokens</span><strong>${available.toLocaleString()}</strong></div>
      <div class="metric"><span>Tokens Sold</span><strong>${sold.toLocaleString()}</strong></div>
      <div class="metric"><span>Token Symbol</span><strong>${property.token_symbol}</strong></div>
      <div class="metric"><span>Min Spend / Token</span><strong>${formatCurrency(minSpend)}</strong></div>
    </div>
    <div class="supply-progress"><div class="supply-progress-meta"><span>Sold ${soldPct.toFixed(2)}%</span><span>${available.toLocaleString()} left</span></div>
      <div class="supply-progress-track"><div class="supply-progress-fill" style="width:${soldPct.toFixed(2)}%"></div></div></div>
    <p class="muted">Token: ${property.token_address ? formatAddress(property.token_address) : 'Not deployed'}</p>
    ${opts.investBtn ? `<button type="button" class="invest-btn" data-property-id="${property.id}">Invest Now</button>` : ""}
    ${opts.rentBtn ? `<button type="button" class="rent-btn" data-property-id="${property.id}">View Details</button>` : ""}
    ${opts.editBtn ? `<button type="button" class="edit-property-btn" data-property-id="${property.id}">Edit</button>` : ""}
  </div></article>`;
}

function txCardHTML(tx) {
  const typeBadgeColor = {
    'INVESTMENT_COMPLETED': '#10b981',
    'INVESTMENT_FUNDED': '#3b82f6',
    'RENT_PAID': '#f59e0b',
    'RENT_DISTRIBUTED': '#8b5cf6',
    'MINT_NFT': '#ec4899',
    'TRANSFER': '#06b6d4',
    'ISSUE_TOKENS': '#14b8a6'
  }[tx.type] || '#6b7280';

  const gasFee = tx.gas_fee ? `<div class="tx-detail"><span>Gas Fee:</span><span>${Number(getEthers().utils.formatEther(String(tx.gas_fee))).toFixed(6)} ETH</span></div>` : '';
  const blockNum = tx.block_number ? `<div class="tx-detail"><span>Block:</span><span>#${tx.block_number}</span></div>` : '';
  const walletInfo = tx.wallet_address ? `<div class="tx-detail"><span>Wallet:</span><span class="mono">${tx.wallet_address}</span></div>` : '';

  return `<article class="tx-card">
    <div class="tx-top">
      <div class="tx-type-badge" style="--badge-color:${typeBadgeColor}">
        <span class="tx-type-dot" style="background:${typeBadgeColor}"></span>
        <strong>${tx.action_label}</strong>
      </div>
      <span class="tx-status tx-status--${tx.status?.toLowerCase() || 'completed'}">${tx.status}</span>
    </div>
    <div class="tx-amount">${formatTokenAmount(tx.display_amount)} ${tx.amount_unit}</div>
    <div class="muted">${tx.description}</div>
    <div class="tx-details-grid">
      <div class="tx-detail"><span>Property:</span><span>${tx.property_name || ('#' + (tx.property_id ?? '--'))}</span></div>
      <div class="tx-detail"><span>Time:</span><span>${new Date(tx.timestamp).toLocaleString()}</span></div>
      <div class="tx-detail"><span>Tx Hash:</span><span class="mono">${tx.tx_hash || '--'}</span></div>
      ${blockNum}
      ${walletInfo}
      ${gasFee}
    </div>
  </article>`;
}

/* ── Navigation ── */
function initNavigation(defaultPage) {
  const links = document.querySelectorAll(".nav-links a[data-page]");
  const sections = document.querySelectorAll(".page-section");
  let currentPage = defaultPage;
  function showPage(key) {
    currentPage = key;
    sections.forEach(s => s.classList.remove("is-active"));
    const t = document.getElementById("page-" + key);
    if (t) t.classList.add("is-active");
    links.forEach(l => l.classList.toggle("active", l.dataset.page === key));
    window.dispatchEvent(new CustomEvent("pagechange", { detail: { page: key } }));
  }
  links.forEach(l => l.addEventListener("click", (e) => { e.preventDefault(); showPage(l.dataset.page); }));
  showPage(defaultPage);
  return { showPage, get currentPage() { return currentPage; } };
}

/* ── Role Management (legacy compatibility shims) ──
   The pre-auth platform stored role in localStorage. Wallet-auth now owns
   identity, so these helpers proxy into EstateChainAuth. They are kept for
   any old HTML markup that still calls them inline (e.g. role-switch buttons).
*/
function getStoredRole() {
  try { return (window.EstateChainAuth && window.EstateChainAuth.getRole()) || null; }
  catch { return null; }
}
function setStoredRole(_role) {
  // No-op under wallet auth. Role is decided by /auth/register and persisted
  // in the database, then carried by the signed JWT.
}
function clearStoredRole() {
  // Treat this as a full sign-out: revoke session server-side and clear local state.
  try {
    localStorage.removeItem("estatechain-role"); // remove ancient key if present
    if (window.EstateChainAuth && typeof window.EstateChainAuth.logout === "function") {
      window.EstateChainAuth.logout({ silent: true });
    }
  } catch (_) { /* ignore */ }
}
