/* ══════════════════════════════════════════════════
   EstateChain — Investor Dashboard
   All existing MetaMask / investment logic preserved.
   ══════════════════════════════════════════════════ */

const state = {
  properties: [],
  portfolio: null,
  platformSummary: null,
  investorSummary: null,
  activeWallet: null,
  walletBalances: null,
  investmentInFlight: false,
  claimInFlight: false,
  claimableSummary: null,
  claimHistory: [],
  userSelectedAccount: false,  // true when user manually picks from dropdown
  lastMetaMaskAddress: null    // track MetaMask address changes
};

const activeBalanceEl = document.getElementById("active-balance");
const activeAddressEl = document.getElementById("active-address");
const activeStatusEl = document.getElementById("active-status");
const portfolioOwner = document.getElementById("portfolio-owner");
const walletBalanceSummary = document.getElementById("wallet-balance-summary");
const walletTokenList = document.getElementById("wallet-token-list");
const walletBalanceEmpty = document.getElementById("wallet-balance-empty");
const investDialog = document.getElementById("invest-dialog");
const investForm = document.getElementById("invest-form");
const investPropertyName = document.getElementById("invest-property-name");
const investPropertyId = document.getElementById("invest-property-id");
const investMinText = document.getElementById("invest-min-text");
const investEthCost = document.getElementById("invest-eth-cost");
const investWalletDisplay = document.getElementById("invest-wallet-display");
const investProgress = document.getElementById("invest-progress");
const investError = document.getElementById("invest-error");
const investSubmitBtn = document.getElementById("invest-submit-btn");
const stepPrepare = document.getElementById("step-prepare");
const stepSend = document.getElementById("step-send");
const stepMine = document.getElementById("step-mine");
const stepConfirm = document.getElementById("step-confirm");
const claimDialog = document.getElementById("claim-dialog");
const claimForm = document.getElementById("claim-form");
const claimPropertyName = document.getElementById("claim-property-name");
const claimPropertyId = document.getElementById("claim-property-id");
const claimWalletDisplay = document.getElementById("claim-wallet-display");
const claimAmountDisplay = document.getElementById("claim-amount-display");
const claimProgress = document.getElementById("claim-progress");
const claimError = document.getElementById("claim-error");
const claimSuccess = document.getElementById("claim-success");
const claimSubmitBtn = document.getElementById("claim-submit-btn");
const claimStepPrepare = document.getElementById("claim-step-prepare");
const claimStepSend = document.getElementById("claim-step-send");
const claimStepMine = document.getElementById("claim-step-mine");
const claimStepConfirm = document.getElementById("claim-step-confirm");

function setResponse(p) { console.log("[API]", p); }


/* ── Auth guard: require an investor session ──
   Runs synchronously by blocking initialization behind requireRole. If the
   visitor is unauthenticated or signed in under a different role, requireRole
   redirects to "/" before any data is loaded.
*/
let nav;
(async function bootstrapAuth() {
  try {
    state.currentUser = await EstateChainAuth.requireRole("investor");
  } catch (e) {
    return; // redirected
  }

  initTheme();
  initWalletUI();
  initHealthCheck();
  nav = initNavigation("dashboard");
  window.__nav = nav;
  // Seed the active wallet with the authenticated wallet immediately so all
  // wallet-scoped API calls (portfolio, transactions, balances) work even
  // before MetaMask wallet.onChange fires.
  if (state.currentUser && state.currentUser.wallet_address) {
    state.activeWallet = state.currentUser.wallet_address;
    state.lastMetaMaskAddress = state.currentUser.wallet_address;
  }

  await refreshDashboardSummary().catch(() => {});
  await loadProperties().catch(() => {});
  if (state.activeWallet) {
    await refreshActiveInvestor().catch(() => {});
  }
})();

/* ── Wallet change handler ── */
wallet.onChange((w) => {
  if (w.connected && w.address) {
    state.lastMetaMaskAddress = w.address;
    state.userSelectedAccount = false;
    if (normalizeWallet(state.activeWallet) !== normalizeWallet(w.address)) {
      setActiveWallet(w.address, { skipRefresh: false });
    }
    if (activeStatusEl) { activeStatusEl.textContent = "● Connected"; activeStatusEl.style.color = "var(--success)"; }
  } else {
    state.lastMetaMaskAddress = null;
    state.userSelectedAccount = false;
    setActiveWallet(null);
    if (activeStatusEl) { activeStatusEl.textContent = "● Disconnected"; activeStatusEl.style.color = "var(--danger)"; }
  }
  if (investWalletDisplay) investWalletDisplay.textContent = w.connected ? "Wallet: " + formatAddress(w.address) : "Wallet: not connected";
  if (claimWalletDisplay) claimWalletDisplay.textContent = w.connected ? "Wallet: " + formatAddress(w.address) : "Wallet: not connected";
  updateWalletHubDisplay();
});

/* ── Page change handler ── */
window.addEventListener("pagechange", async (e) => {
  try {
    const p = e.detail.page;
    if (p === "dashboard") { await loadProperties(); await refreshDashboardSummary(); if (state.activeWallet) await refreshActiveInvestor(); }
    if (p === "marketplace") await loadProperties();
    if (p === "portfolio" && state.activeWallet) await refreshActiveInvestor();
    if (p === "rent-yield") await renderRentYieldPage();
    if (p === "transactions") await renderTransactionsPage();
  } catch (err) { console.error(err); }
});

/* ══════════════════════════════════════════
   ACCOUNT MANAGEMENT
   ══════════════════════════════════════════ */
function renderAccountDropdown() {
  return;
}

function updateWalletHubDisplay() {
  const acct = wallet.accounts.find(a => normalizeWallet(a.address) === normalizeWallet(state.activeWallet));
  if (activeBalanceEl) {
    activeBalanceEl.textContent = acct ? Number(acct.balance_eth).toFixed(4) + " ETH" : (wallet.balance != null ? wallet.balance.toFixed(4) + " ETH" : "0.0000 ETH");
    activeBalanceEl.classList.add("balance-flash"); setTimeout(() => activeBalanceEl.classList.remove("balance-flash"), 600);
  }
  if (activeAddressEl) activeAddressEl.textContent = state.activeWallet ? formatAddress(state.activeWallet) : "--";
}

function setActiveWallet(addr, { skipRefresh = false } = {}) {
  state.activeWallet = addr || null;
  state.walletBalances = null;
  renderWalletBalancesUI();
  renderActiveUserDetails();
  updateWalletHubDisplay();
  if (nav && nav.currentPage === "transactions") renderTransactionsPage().catch(e => setResponse({ error: e.message }));
  if (nav && nav.currentPage === "rent-yield") renderRentYieldPage().catch(e => setResponse({ error: e.message }));
  if (!skipRefresh) refreshActiveInvestor().catch(e => setResponse({ error: e.message }));
}

function renderActiveUserDetails() {
  const acct = wallet.accounts.find(a => normalizeWallet(a.address) === normalizeWallet(state.activeWallet));
  const label = acct ? acct.label : (state.activeWallet ? formatAddress(state.activeWallet) : "--");
  if (portfolioOwner) portfolioOwner.textContent = label;
  if (activeAddressEl) activeAddressEl.textContent = state.activeWallet ? formatAddress(state.activeWallet) : "--";
}

function getSelectedSigner() {
  const ethers = getEthers();
  if (!hasMetaMask()) throw new Error("MetaMask is not installed.");
  const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  return provider.getSigner();
}

const refreshAccountsBtn = document.getElementById("refresh-accounts");
if (refreshAccountsBtn) refreshAccountsBtn.addEventListener("click", () => walletLoadAccounts().then(() => { renderAccountDropdown(); setResponse({ wallet: wallet.address || null }); }).catch(e => setResponse({ error: e.message })));
document.getElementById("portfolio-load-active").addEventListener("click", () => {
  if (!state.activeWallet) { setResponse({ error: "Select an account first." }); return; }
  refreshActiveInvestor().then(() => setResponse(state.portfolio || {})).catch(e => setResponse({ error: e.message }));
});

/* ══════════════════════════════════════════
   STATS & SUMMARIES
   ══════════════════════════════════════════ */
function renderPlatformStats() {
  const s = state.platformSummary;
  const d = Math.pow(10, TOKEN_DECIMALS);
  if (!s) return;
  document.getElementById("stat-platform-properties").textContent = String(s.properties_loaded ?? 0);
  document.getElementById("stat-platform-total-tokens").textContent = formatTokenAmount(Number(s.total_token_holdings ?? 0) / d);
  document.getElementById("stat-platform-total-value").textContent = formatCurrency(Number(s.total_portfolio_value ?? 0) / d);
  document.getElementById("stat-platform-min-spend").textContent = formatCurrency(s.avg_min_spend_per_token ?? 0);
}

function renderInvestorStats() {
  const s = state.investorSummary;
  if (!s) { document.getElementById("stat-properties").textContent = "0"; document.getElementById("stat-total-tokens").textContent = "0"; document.getElementById("stat-total-value").textContent = "$0.00"; document.getElementById("stat-min-spend").textContent = "$0.00"; return; }
  document.getElementById("stat-properties").textContent = String(s.propertiesOwned ?? 0);
  document.getElementById("stat-total-tokens").textContent = formatTokenAmount(s.totalTokens ?? 0);
  document.getElementById("stat-total-value").textContent = formatCurrency(s.portfolioValue ?? 0);
  document.getElementById("stat-min-spend").textContent = formatCurrency(s.avgTokenValue ?? 0);
}

function buildInvestorSummary(holdings) {
  let totalTokens = 0, portfolioValue = 0, propertiesOwned = 0;
  (holdings || []).forEach(h => {
    const tokens = toTokenUnits(h.token_amount, TOKEN_DECIMALS);
    totalTokens += tokens; if (tokens > 0) propertiesOwned++;
    const prop = state.properties.find(p => Number(p.id) === Number(h.property_id));
    const tv = Number(prop?.total_value || 0), ts = Number(prop?.token_supply || 1);
    if (ts > 0 && tokens > 0) portfolioValue += (tv / ts) * tokens;
  });
  return { totalTokens, portfolioValue, propertiesOwned, avgTokenValue: totalTokens > 0 ? portfolioValue / totalTokens : 0 };
}

async function refreshDashboardSummary() {
  state.platformSummary = await apiRequest("/dashboard/summary");
  renderPlatformStats();
}

async function refreshActiveInvestor() {
  if (!state.activeWallet) {
    state.investorSummary = null; state.portfolio = null; state.walletBalances = null;
    renderInvestorStats(); renderPortfolio(); renderWalletBalancesUI(); return;
  }
  try {
    if (!state.properties.length) await loadProperties();
    let portfolio;
    try { portfolio = await apiRequest(`/portfolio/${state.activeWallet}`); }
    catch (err) {
      // If the backend still returns 404 unexpectedly, treat it as an empty portfolio.
      if (err.message && (err.message.includes("404") || err.message.includes("Not Found") || err.message.includes("User not found"))) {
        portfolio = { holdings: [] };
      } else { throw err; }
    }
    state.portfolio = portfolio;
    state.investorSummary = buildInvestorSummary(portfolio.holdings);
    renderInvestorStats();
    if (nav && nav.currentPage === "portfolio") renderPortfolio();
    if (nav && nav.currentPage === "rent-yield") renderRentYieldPage().catch(() => {});
  } catch (err) { state.investorSummary = null; renderInvestorStats(); renderPortfolio(); throw err; }
  try { await loadWalletBalances(); } catch { state.walletBalances = null; renderWalletBalancesUI(); }
}

/* ══════════════════════════════════════════
   WALLET BALANCES
   ══════════════════════════════════════════ */
function renderWalletBalancesUI() {
  if (!walletBalanceSummary || !walletTokenList || !walletBalanceEmpty) return;
  if (!state.activeWallet) { walletBalanceSummary.innerHTML = ""; walletTokenList.innerHTML = ""; walletBalanceEmpty.textContent = "Select an investor to load balances."; walletBalanceEmpty.style.display = "block"; return; }
  if (!state.walletBalances) { walletBalanceSummary.innerHTML = ""; walletTokenList.innerHTML = ""; walletBalanceEmpty.textContent = "Loading balances..."; walletBalanceEmpty.style.display = "block"; return; }
  const native = safeNumber(state.walletBalances.native?.balance);
  const tokens = Array.isArray(state.walletBalances.tokens) ? state.walletBalances.tokens : [];
  const rentToken = tokens.find(t => t.category === "rent");
  const propTokens = tokens.filter(t => t.category === "property");
  walletBalanceSummary.innerHTML = `
    <div class="balance-card"><span>Native Balance (ETH)</span><strong>${formatTokenAmount(native, 6)}</strong></div>
    <div class="balance-card"><span>Rent Token Balance (${rentToken?.symbol || "mUSDC"})</span><strong>${formatTokenAmount(safeNumber(rentToken?.balance), 4)}</strong></div>
    <div class="balance-card"><span>Property Tokens Held</span><strong>${propTokens.length}</strong></div>`;
  if (!propTokens.length) { walletTokenList.innerHTML = ""; walletBalanceEmpty.textContent = "No property token balances found."; walletBalanceEmpty.style.display = "block"; return; }
  walletBalanceEmpty.style.display = "none";
  walletTokenList.innerHTML = propTokens.map(t => `<div class="token-row"><div class="token-row-header"><div class="token-row-title">${t.property_name || "Property"} (${t.symbol || "TOKEN"})</div><div class="token-row-title">${formatTokenAmount(safeNumber(t.balance), 4)}</div></div><div class="token-row-meta">Property ID: ${t.property_id ?? "--"} | Token: ${formatAddress(t.token_address)}</div></div>`).join("");
}

async function loadWalletBalances() {
  if (!state.activeWallet) { state.walletBalances = null; renderWalletBalancesUI(); return; }
  renderWalletBalancesUI();
  state.walletBalances = await apiRequest(`/wallets/${state.activeWallet}/balances`);
  renderWalletBalancesUI();
  renderPortfolioChart();
}

/* ── Portfolio Allocation Chart ── */
let chartPortfolioAlloc = null;
function renderPortfolioChart() {
  if (typeof Chart === "undefined") return;
  const ctx = document.getElementById("chart-portfolio-alloc");
  if (!ctx) return;
  if (chartPortfolioAlloc) chartPortfolioAlloc.destroy();

  const tokens = state.walletBalances?.tokens?.filter(t => t.category === "property" && Number(t.balance) > 0) || [];
  if (!tokens.length) {
    chartPortfolioAlloc = null;
    ctx.parentElement.innerHTML = '<div class="empty" style="padding:40px 0;">No token holdings to display.</div>';
    return;
  }

  const isDark = !document.body.classList.contains("light-theme");
  const textColor = isDark ? "#a1a1aa" : "#71717a";
  const colors = ["#6366f1", "#8b5cf6", "#10b981", "#f59e0b", "#3b82f6", "#ec4899", "#14b8a6", "#f97316"];

  chartPortfolioAlloc = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: tokens.map(t => t.property_name || t.symbol || "Token"),
      datasets: [{
        data: tokens.map(t => Number(t.balance)),
        backgroundColor: colors.slice(0, tokens.length),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { position: "bottom", labels: { color: textColor, font: { family: "Inter", size: 12 }, padding: 10 } }
      },
      cutout: "60%"
    }
  });
}

/* ══════════════════════════════════════════
   PROPERTIES & MARKETPLACE
   ══════════════════════════════════════════ */
async function loadProperties() {
  state.properties = await apiRequest("/properties");
  renderMarketplace();
  if (state.activeWallet && state.portfolio?.holdings) {
    state.investorSummary = buildInvestorSummary(state.portfolio.holdings);
    renderInvestorStats();
  }
}

function renderMarketplace() {
  const grid = document.getElementById("marketplace-grid");
  if (!state.properties.length) { grid.innerHTML = '<div class="empty">No properties available.</div>'; return; }
  grid.innerHTML = state.properties.map(p => propertyCardHTML(p, { investBtn: true })).join("");
  document.querySelectorAll(".invest-btn").forEach(btn => {
    btn.addEventListener("click", () => openInvestDialog(btn.dataset.propertyId).catch(e => setResponse({ error: e.message })));
  });
}

/* ══════════════════════════════════════════
   PORTFOLIO
   ══════════════════════════════════════════ */
function renderPortfolio() {
  const list = document.getElementById("portfolio-list"), empty = document.getElementById("portfolio-empty");
  if (!state.portfolio?.holdings?.length) {
    list.innerHTML = ""; empty.textContent = state.activeWallet ? "No holdings for this investor." : "No portfolio loaded."; empty.style.display = "block"; return;
  }
  empty.style.display = "none";
  list.innerHTML = state.portfolio.holdings.map(h => {
    const prop = state.properties.find(p => Number(p.id) === Number(h.property_id));
    const tokenUnits = toTokenUnits(h.token_amount, TOKEN_DECIMALS);
    const unitVal = prop && Number(prop.token_supply || 0) > 0 ? Number(prop.total_value || 0) / Number(prop.token_supply || 1) : 0;
    const holdVal = unitVal * tokenUnits;
    const supply = Number(prop?.token_supply || 0);
    const ownershipPct = supply > 0 ? ((tokenUnits / supply) * 100).toFixed(2) : "0.00";
    return `<div class="item"><strong>${h.property_name}</strong>
      <div class="muted">Property ID: ${h.property_id}</div>
      <div class="muted">Tokens: ${formatBaseTokenAmount(h.token_amount, TOKEN_DECIMALS)}</div>
      <div class="muted">Ownership: ${ownershipPct}%</div>
      <div class="muted">Est. Value: ${prop ? formatCurrency(holdVal) : "--"}</div></div>`;
  }).join("");
}

/* ══════════════════════════════════════════
   TRANSACTIONS
   ══════════════════════════════════════════ */
async function renderTransactionsPage() {
  const filter = document.getElementById("tx-filter-active");
  const useActive = filter?.checked && state.activeWallet;
  const params = new URLSearchParams();
  if (useActive) params.append("wallet_address", state.activeWallet);
  const query = params.toString();
  const rows = await apiRequest(`/transactions${query ? "?" + query : ""}`);
  const list = document.getElementById("transaction-list");
  list.innerHTML = rows.length ? rows.map(tx => txCardHTML(tx)).join("") : '<div class="empty">No transactions found.</div>';
}

document.getElementById("tx-filter-active").addEventListener("change", () => renderTransactionsPage().catch(e => setResponse({ error: e.message })));
document.getElementById("tx-refresh").addEventListener("click", () => renderTransactionsPage().catch(e => setResponse({ error: e.message })));

/* ══════════════════════════════════════════
   RENT & YIELD
   ══════════════════════════════════════════ */
function renderClaimableYieldList(summary) {
  const list = document.getElementById("claimable-yield-list");
  if (!list) return;
  const properties = summary?.properties || [];
  if (!properties.length) {
    list.innerHTML = '<div class="empty">No claimable rewards yet.</div>';
    return;
  }
  list.innerHTML = properties.map((item) => `
    <div class="item">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;">
        <div>
          <strong>${item.property_name || "Property #" + item.property_id}</strong>
          <div class="muted">Pending distributions: ${item.pending_payouts}${item.last_distributed_at ? ` • Last accrued: ${new Date(item.last_distributed_at).toLocaleString()}` : ""}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="color:var(--success);font-weight:600;">${item.claimable_amount_eth} ETH</span>
          <button type="button" class="ghost claim-yield-btn" data-property-id="${item.property_id}">Claim Yield</button>
        </div>
      </div>
    </div>`).join("");
  document.querySelectorAll(".claim-yield-btn").forEach((btn) => {
    btn.addEventListener("click", () => openClaimDialog(btn.dataset.propertyId).catch((e) => setResponse({ error: e.message })));
  });
}

function renderClaimHistoryList(history) {
  const list = document.getElementById("claim-history-list");
  if (!list) return;
  if (!history?.length) {
    list.innerHTML = '<div class="empty">No claims yet.</div>';
    return;
  }
  list.innerHTML = history.map((item) => `
    <div class="item">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>${item.property_name || "Property #" + item.property_id}</strong>
        <span style="color:var(--success);font-weight:600;">${item.claimed_amount_eth} ETH</span>
      </div>
      <div class="muted">Claimed payouts: ${item.payout_count} • Tx: ${formatAddress(item.claim_tx_hash)}</div>
      <div class="muted">${item.claimed_at ? new Date(item.claimed_at).toLocaleString() : ""}</div>
    </div>`).join("");
}

async function renderRentYieldPage() {
  if (!state.activeWallet) {
    document.getElementById("yield-total-earned").textContent = "0 ETH";
    document.getElementById("yield-total-payouts").textContent = "0";
    document.getElementById("yield-properties").textContent = "0";
    document.getElementById("yield-total-claimable").textContent = "0 ETH";
    document.getElementById("yield-total-claimed").textContent = "0 ETH";
    document.getElementById("yield-by-property").innerHTML = '<div class="empty">Select an account to see rental earnings.</div>';
    document.getElementById("rent-list").innerHTML = '<div class="empty">Select an account to see distributions.</div>';
    document.getElementById("claimable-yield-list").innerHTML = '<div class="empty">Select an account to see claimable rewards.</div>';
    document.getElementById("claim-history-list").innerHTML = '<div class="empty">Select an account to see claim history.</div>';
    renderYieldTimelineChart([]);
    return;
  }

  let summary = null;
  try {
    summary = await apiRequest(`/investor/yield-summary/${state.activeWallet}`);
    document.getElementById("yield-total-earned").textContent = `${summary.total_earned_eth} ETH`;
    document.getElementById("yield-total-payouts").textContent = String(summary.total_payouts);
    document.getElementById("yield-properties").textContent = String(summary.properties_earning);
    document.getElementById("yield-total-claimable").textContent = `${summary.total_claimable_eth || "0"} ETH`;
    document.getElementById("yield-total-claimed").textContent = `${summary.total_claimed_eth || "0"} ETH`;
  } catch {
    document.getElementById("yield-total-earned").textContent = "0 ETH";
    document.getElementById("yield-total-payouts").textContent = "0";
    document.getElementById("yield-properties").textContent = "0";
    document.getElementById("yield-total-claimable").textContent = "0 ETH";
    document.getElementById("yield-total-claimed").textContent = "0 ETH";
  }

  try {
    state.claimableSummary = await apiRequest(`/rewards/claimable/${state.activeWallet}`);
    document.getElementById("yield-total-claimable").textContent = `${state.claimableSummary.total_claimable_eth} ETH`;
    document.getElementById("yield-total-claimed").textContent = `${state.claimableSummary.total_claimed_eth} ETH`;
    renderClaimableYieldList(state.claimableSummary);
  } catch {
    state.claimableSummary = null;
    renderClaimableYieldList(null);
  }

  try {
    state.claimHistory = await apiRequest(`/rewards/history/${state.activeWallet}`);
    renderClaimHistoryList(state.claimHistory);
  } catch {
    state.claimHistory = [];
    renderClaimHistoryList([]);
  }

  try {
    const dists = await apiRequest(`/investor/distributions/${state.activeWallet}`);
    const byPropEl = document.getElementById("yield-by-property");
    if (dists.length) {
      byPropEl.innerHTML = dists.map(d => `
        <div class="item">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${d.property_name || "Property #" + d.property_id}</strong>
            <span style="color:var(--success);font-weight:600;">${d.total_earned_eth} ETH</span>
          </div>
          <div class="muted">Payments received: ${d.payment_count} • Ownership: ${d.current_ownership}%</div>
        </div>`).join("");
    } else {
      byPropEl.innerHTML = '<div class="empty">No rental earnings yet for this wallet.</div>';
    }
  } catch { }

  try {
    const payouts = await apiRequest(`/investor/rental-earnings/${state.activeWallet}`);
    const list = document.getElementById("rent-list");
    if (payouts.length) {
      list.innerHTML = payouts.map(p => `
        <div class="item">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${p.property_name || "Property #" + p.property_id}</strong>
            <span style="color:var(--success);font-weight:600;">${p.payout_amount_eth} ETH</span>
          </div>
          <div class="muted">Ownership: ${p.ownership_percentage}% • Status: ${p.claim_status || "claimable"} • Tx: ${formatAddress(p.tx_hash)}</div>
          <div class="muted">${new Date(p.distributed_at).toLocaleString()}</div>
        </div>`).join("");
      renderYieldTimelineChart(payouts);
    } else {
      list.innerHTML = '<div class="empty">No individual payouts found.</div>';
      renderYieldTimelineChart([]);
    }
  } catch {
    document.getElementById("rent-list").innerHTML = '<div class="empty">No individual payouts found.</div>';
    renderYieldTimelineChart([]);
  }

  const avgEl = document.getElementById("yield-avg-payout");
  if (avgEl) {
    try {
      const avg = summary && summary.total_payouts > 0 ? (Number(summary.total_earned_eth) / summary.total_payouts).toFixed(6) : "0";
      avgEl.textContent = avg + " ETH";
    } catch {
      avgEl.textContent = "0 ETH";
    }
  }
}

function resetClaimProgress() {
  claimProgress.classList.remove("visible");
  [claimStepPrepare, claimStepSend, claimStepMine, claimStepConfirm].forEach((s) => { if (s) s.className = "invest-step"; });
  claimError.style.display = "none";
  claimError.textContent = "";
  claimSuccess.style.display = "none";
  claimSuccess.textContent = "";
  claimSubmitBtn.disabled = false;
}

function setClaimStep(el, status) {
  if (el) el.className = "invest-step " + status;
}

async function openClaimDialog(propertyId) {
  if (!state.activeWallet) { alert("Please connect MetaMask first."); return; }
  if (!state.claimableSummary) {
    state.claimableSummary = await apiRequest(`/rewards/claimable/${state.activeWallet}`);
  }
  const reward = (state.claimableSummary?.properties || []).find((item) => String(item.property_id) === String(propertyId));
  if (!reward) throw new Error("No claimable rewards found for this property.");
  resetClaimProgress();
  claimPropertyId.value = String(propertyId);
  claimPropertyName.textContent = reward.property_name || `Property #${propertyId}`;
  claimAmountDisplay.textContent = `${reward.claimable_amount_eth} ETH`;
  claimWalletDisplay.textContent = `Wallet: ${formatAddress(state.activeWallet)}`;
  claimDialog.showModal();
}

async function handleClaim(event) {
  event.preventDefault();
  if (state.claimInFlight) return;
  if (!state.activeWallet) { alert("Connect MetaMask first."); return; }
  const propertyId = claimPropertyId.value;
  if (!propertyId) return;

  claimSubmitBtn.disabled = true;
  state.claimInFlight = true;
  claimProgress.classList.add("visible");
  claimError.style.display = "none";
  claimSuccess.style.display = "none";
  try {
    const signer = getSelectedSigner();
    const signerAddress = await signer.getAddress();
    const network = await signer.provider.getNetwork();
    if (network.chainId !== EXPECTED_CHAIN_ID) throw new Error(`Wrong network. Expected chain ${EXPECTED_CHAIN_ID}.`);

    setClaimStep(claimStepPrepare, "active");
    const prepared = await apiRequest("/rewards/prepare-claim", {
      method: "POST",
      body: JSON.stringify({
        property_id: Number(propertyId),
        investor_wallet: signerAddress
      })
    });
    claimAmountDisplay.textContent = `${prepared.claimable_amount_eth} ETH`;
    setClaimStep(claimStepPrepare, "done");

    setClaimStep(claimStepSend, "active");
    const tx = await signer.sendTransaction({
      to: prepared.rent_contract_address,
      data: prepared.calldata,
      value: 0,
    });
    setClaimStep(claimStepSend, "done");

    setClaimStep(claimStepMine, "active");
    const receipt = await tx.wait();
    setClaimStep(claimStepMine, "done");

    setClaimStep(claimStepConfirm, "active");
    const result = await apiRequest("/rewards/confirm-claim", {
      method: "POST",
      body: JSON.stringify({
        property_id: Number(propertyId),
        investor_wallet: signerAddress,
        tx_hash: tx.hash
      })
    });
    setClaimStep(claimStepConfirm, "done");
    claimSuccess.textContent = `Claimed ${result.claimed_amount_eth} ETH successfully.`;
    claimSuccess.style.display = "block";
    setResponse({ tx_hash: tx.hash, receipt_block: receipt.blockNumber, ...result });

    await walletLoadAccounts();
    await walletRefreshBalance();
    wallet._notify();
    const txRefresh = nav && nav.currentPage === "transactions" ? renderTransactionsPage().catch(() => {}) : Promise.resolve();
    await Promise.all([refreshActiveInvestor(), renderRentYieldPage(), txRefresh]);
    updateWalletHubDisplay();
    setTimeout(() => { claimDialog.close(); resetClaimProgress(); }, 1500);
  } catch (err) {
    const rejected = isUserRejectedTransactionError(err);
    const msg = formatInvestmentError(err);
    claimError.textContent = msg;
    claimError.style.display = rejected ? "none" : "block";
    [claimStepPrepare, claimStepSend, claimStepMine, claimStepConfirm].forEach((s) => { if (s && s.classList.contains("active")) setClaimStep(s, "error"); });
    setResponse(rejected ? { status: "cancelled" } : { error: msg });
  } finally {
    claimSubmitBtn.disabled = false;
    state.claimInFlight = false;
  }
}

let chartYieldTimeline = null;
function renderYieldTimelineChart(payouts) {
  if (typeof Chart === "undefined") return;
  const canvas = document.getElementById("chart-yield-timeline");
  if (!canvas) return;
  if (chartYieldTimeline) chartYieldTimeline.destroy();

  if (!payouts || !payouts.length) { chartYieldTimeline = null; return; }

  const isDark = !document.body.classList.contains("light-theme");
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const textColor = isDark ? "#a1a1aa" : "#71717a";

  const sorted = [...payouts].sort((a, b) => new Date(a.distributed_at) - new Date(b.distributed_at));
  const labels = sorted.map(p => new Date(p.distributed_at).toLocaleDateString());
  const data = sorted.map(p => Number(p.payout_amount_eth));

  chartYieldTimeline = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Payout (ETH)",
        data,
        borderColor: "#6366f1",
        backgroundColor: "rgba(99,102,241,0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: "#6366f1"
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor, font: { family: "Inter", size: 12 } } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: "Inter", size: 12 } } }
      }
    }
  });
}

/* ══════════════════════════════════════════
   INVESTMENT DIALOG — full MetaMask flow
   ══════════════════════════════════════════ */
function resetInvestProgress() {
  investProgress.classList.remove("visible");
  [stepPrepare, stepSend, stepMine, stepConfirm].forEach(s => s.className = "invest-step");
  investError.style.display = "none"; investError.textContent = "";
  investSubmitBtn.disabled = false;
}
function setStep(el, status) { el.className = "invest-step " + status; }

async function openInvestDialog(propertyId) {
  const property = state.properties.find(p => String(p.id) === String(propertyId));
  if (!property) return;
  if (!state.activeWallet) { alert("Please connect MetaMask first."); return; }
  try {
    const ethers = getEthers();
    const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    if (!property.token_address) {
      throw new Error("Token contract not deployed for this property yet. Ask an admin to deploy it.");
    }
    const sc = getSaleContract(property, provider);
    const salePricePerTokenWei = await sc.salePricePerTokenWei();
    if (!salePricePerTokenWei || salePricePerTokenWei.isZero()) {
      throw new Error("On-chain sale price is zero for this property");
    }
    investPropertyName.textContent = `${property.name} (${property.location})`;
    investPropertyId.value = property.id;
    investMinText.textContent = `On-chain price per token: ${formatWeiAsEth(salePricePerTokenWei)} ETH`;
    const amountInput = document.getElementById("invest-amount");
    amountInput.oninput = () => {
      const tokens = Number(amountInput.value) || 0;
      if (!tokens) { investEthCost.textContent = "--"; return; }
      investEthCost.textContent = formatWeiAsEth(salePricePerTokenWei.mul(ethers.BigNumber.from(String(tokens)))) + " ETH";
    };
    amountInput.oninput();
    renderWalletUI();
    resetInvestProgress();
    renderActiveUserDetails();
    investWalletDisplay.textContent = `Investing as: ${formatAddress(state.activeWallet)}`;
    investDialog.dataset.salePriceWei = salePricePerTokenWei.toString();
    investDialog.showModal();
  } catch (err) { setResponse({ error: "Failed to load investment: " + err.message }); }
}

async function handleInvest(event) {
  event.preventDefault();
  if (state.investmentInFlight) return;
  if (!state.activeWallet) { alert("Connect MetaMask first."); return; }

  const propertyId = investPropertyId.value, tokenAmount = document.getElementById("invest-amount").value;
  if (!propertyId || !tokenAmount) return;
  const property = state.properties.find(p => String(p.id) === String(propertyId));
  if (!property || !property.token_address) { setResponse({ error: "Property/token not found" }); return; }
  investSubmitBtn.disabled = true; state.investmentInFlight = true;
  investProgress.classList.add("visible"); investError.style.display = "none";
  try {
    const ethers = getEthers();
    const signer = getSelectedSigner();
    const signerAddress = await signer.getAddress();
    const network = await signer.provider.getNetwork();
    if (network.chainId !== EXPECTED_CHAIN_ID) throw new Error(`Wrong network. Expected chain ${EXPECTED_CHAIN_ID}.`);
    const tokenAmountBn = ethers.BigNumber.from(String(tokenAmount));
    setStep(stepPrepare, "active");
    // Backend derives authoritative ETH cost from the on-chain SecurityToken.
    // No USD<->ETH conversion happens anywhere; pricing is entirely wei-based.
    const prepared = await apiRequest("/investments/prepare", {
      method: "POST",
      body: JSON.stringify({
        property_id: Number(propertyId),
        investor_wallet: signerAddress,
        token_amount: Number(tokenAmount)
      })
    });
    setResponse(prepared); setStep(stepPrepare, "done");
    await loadProperties();
    const updatedProp = state.properties.find(p => String(p.id) === String(propertyId));
    if (!updatedProp?.token_address) throw new Error("Token contract not available after migration");
    const saleContract = getSaleContract(updatedProp, signer);
    const contractPropId = await saleContract.propertyId();
    if (Number(contractPropId.toString()) !== Number(propertyId)) throw new Error("Token contract property ID mismatch.");
    const salePricePerTokenWei = await saleContract.salePricePerTokenWei();
    const requiredWei = salePricePerTokenWei.mul(tokenAmountBn);
    setStep(stepSend, "active");
    const tx = await saleContract.invest(Number(propertyId), tokenAmountBn, { value: requiredWei });
    setStep(stepSend, "done");
    setStep(stepMine, "active");
    const receipt = await tx.wait();
    setStep(stepMine, "done");
    setStep(stepConfirm, "active");
    const result = await apiRequest(`/investments/${prepared.investment_id}/confirm`, { method: "POST", body: JSON.stringify({ tx_hash: tx.hash }) });
    setStep(stepConfirm, "done");
    setResponse({ tx_hash: tx.hash, receipt_block: receipt.blockNumber, ...result });
    // Force immediate refresh of all data after investment
    await walletLoadAccounts();
    await walletRefreshBalance();
    wallet._notify();
    await Promise.all([loadProperties(), refreshDashboardSummary(), refreshActiveInvestor()]);
    renderAccountDropdown();
    updateWalletHubDisplay();
    setTimeout(() => { investDialog.close(); resetInvestProgress(); investForm.reset(); }, 1500);
  } catch (err) {
    const rejected = isUserRejectedTransactionError(err);
    const msg = formatInvestmentError(err);
    investError.textContent = msg; investError.style.display = rejected ? "none" : "block";
    [stepPrepare, stepSend, stepMine, stepConfirm].forEach(s => { if (s.classList.contains("active")) setStep(s, "error"); });
    setResponse(rejected ? { status: "cancelled" } : { error: msg });
  } finally { investSubmitBtn.disabled = false; state.investmentInFlight = false; }
}

investForm.addEventListener("submit", handleInvest);
document.getElementById("close-invest").addEventListener("click", () => { investDialog.close(); resetInvestProgress(); });
claimForm.addEventListener("submit", handleClaim);
document.getElementById("close-claim").addEventListener("click", () => { claimDialog.close(); resetClaimProgress(); });

/* ── Auto-refresh & init ── */
refreshDashboardSummary().catch(e => setResponse({ error: e.message }));
loadProperties().catch(e => setResponse({ error: e.message }));
setInterval(() => { refreshDashboardSummary().catch(() => {}); }, 8000);
setInterval(() => { loadProperties().catch(() => {}); }, 8000);
setInterval(() => { if (state.activeWallet) refreshActiveInvestor().catch(() => {}); }, 10000);
