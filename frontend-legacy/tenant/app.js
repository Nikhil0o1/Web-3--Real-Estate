/* ══════════════════════════════════════════════════
   EstateChain — Tenant Dashboard
   Full rent payment via RentDistribution smart contract.
   ══════════════════════════════════════════════════ */

const state = {
  properties: [],
  transactions: [],
  activeWallet: null,
  paymentInFlight: false
};

function setResponse(p) { console.log("[API]", p); }

/* ── DOM refs ── */
const activeAddrEl = document.getElementById("t-active-address");
const activeBalEl = document.getElementById("t-active-balance");

/* ── Auth guard: require a tenant session ── */
let nav;
(async function bootstrapAuth() {
  try {
    state.currentUser = await EstateChainAuth.requireRole("tenant");
  } catch (e) {
    return; // redirected
  }

  initTheme();
  initWalletUI();
  initHealthCheck();
  nav = initNavigation("dashboard");
  window.__nav = nav;

  // Seed active wallet with authenticated wallet (so wallet-scoped APIs work
  // immediately, before MetaMask provider events fire).
  if (state.currentUser && state.currentUser.wallet_address) {
    state.activeWallet = state.currentUser.wallet_address;
  }

  updateTenantWalletUI();
  await loadDashboard().catch(() => {});
})();

/* ── Account helpers (role-filtered for tenants #7–#12) ── */
function getSelectedSigner() {
  const ethers = getEthers();
  if (!hasMetaMask()) throw new Error("MetaMask is not installed.");
  const provider = new ethers.providers.Web3Provider(window.ethereum, "any");
  return provider.getSigner();
}

function renderAccountDropdown() {
  return;
}

function setActiveWallet(addr) {
  state.activeWallet = addr || null;
  updateTenantWalletUI();
  if (nav && nav.currentPage === "dashboard") loadDashboard().catch(() => {});
  if (nav && nav.currentPage === "rentals") loadRentals().catch(() => {});
  if (nav && nav.currentPage === "payments") { loadPaymentHistory().catch(() => {}); loadActiveRentals().catch(() => {}); }
  if (nav && nav.currentPage === "transactions") loadTransactions().catch(() => {});
}

const tenantRefreshAccountsBtn = document.getElementById("tenant-refresh-accounts");
if (tenantRefreshAccountsBtn) tenantRefreshAccountsBtn.addEventListener("click", () => {
  walletLoadAccounts().then(() => { renderAccountDropdown(); }).catch(() => {});
});

/* ── Wallet change handler ── */
wallet.onChange((w) => {
  updateTenantWalletUI();
  if (w.connected && !state.activeWallet) {
    setActiveWallet(w.address);
  }
});

function updateTenantWalletUI() {
  const acct = wallet.accounts.find(a => normalizeWallet(a.address) === normalizeWallet(state.activeWallet));
  const addrEl = document.getElementById("t-wallet-addr");
  const balEl = document.getElementById("t-eth-balance");
  const netEl = document.getElementById("t-network");
  if (activeAddrEl) activeAddrEl.textContent = state.activeWallet ? formatAddress(state.activeWallet) : "--";
  if (activeBalEl) activeBalEl.textContent = acct ? Number(acct.balance_eth).toFixed(4) + " ETH" : "0.0000 ETH";
  if (addrEl) addrEl.textContent = state.activeWallet ? formatAddress(state.activeWallet) : "--";
  if (balEl) balEl.textContent = acct ? Number(acct.balance_eth).toFixed(4) + " ETH" : "0.0000 ETH";
  if (netEl) netEl.textContent = wallet.connected ? (wallet.chainOk ? "Sepolia (11155111)" : "Wrong Network") : "Not Connected";
}

/* ── Page change handler ── */
window.addEventListener("pagechange", async (e) => {
  try {
    const page = e.detail.page;
    if (page === "dashboard") await loadDashboard();
    if (page === "rentals") await loadRentals();
    if (page === "payments") { await loadPaymentHistory(); await loadActiveRentals(); }
    if (page === "transactions") await loadTransactions();
    if (page === "contact") await loadContactInfo();
  } catch (err) { console.error(err); }
});

/* ══════════════════════════════════════════
   DASHBOARD
   ══════════════════════════════════════════ */
async function loadDashboard() {
  try {
    const properties = await apiRequest("/tenant/properties");
    state.properties = properties;
    document.getElementById("t-rentals").textContent = properties.length;
    document.getElementById("t-total-props").textContent = properties.length;

    if (state.activeWallet) {
      const [payments, rentals] = await Promise.all([
        apiRequest(`/tenant/payment-history/${state.activeWallet}`).catch(() => []),
        apiRequest(`/tenant/active-rentals/${state.activeWallet}`).catch(() => [])
      ]);
      document.getElementById("t-rent-paid").textContent = payments.length;
      document.getElementById("t-active-rentals-count").textContent = rentals.length;

      const recentEl = document.getElementById("t-recent-tx");
      if (payments.length) {
        recentEl.innerHTML = payments.slice(0, 5).map(p => `
          <div class="item">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong>${p.property_name || "Property #" + p.property_id}</strong>
              <span style="color:var(--success);font-weight:600;">${p.amount_eth} ETH</span>
            </div>
            <div class="muted">Tx: ${formatAddress(p.tx_hash)} • ${new Date(p.payment_date).toLocaleString()}</div>
          </div>`).join("");
      } else {
        recentEl.innerHTML = '<div class="empty">No rent payments yet for this account.</div>';
      }
    } else {
      document.getElementById("t-rent-paid").textContent = "0";
      document.getElementById("t-active-rentals-count").textContent = "0";
      document.getElementById("t-recent-tx").innerHTML = '<div class="empty">Select an account to see activity.</div>';
    }
    updateTenantWalletUI();
  } catch (err) { console.error(err); }
}

/* ══════════════════════════════════════════
   RENTALS — Marketplace with Pay Rent buttons
   ══════════════════════════════════════════ */
async function loadRentals() {
  try {
    state.properties = await apiRequest("/tenant/properties");
    const grid = document.getElementById("rental-grid");
    if (!state.properties.length) {
      grid.innerHTML = '<div class="empty">No properties available.</div>';
      return;
    }

    // Check active rentals for the current tenant
    let activeRentals = [];
    if (state.activeWallet) {
      try {
        activeRentals = await apiRequest(`/tenant/active-rentals/${state.activeWallet}`);
      } catch { activeRentals = []; }
    }

    grid.innerHTML = state.properties.map(p => {
      const rentEth = p.monthly_rent_eth && p.monthly_rent_eth !== "0" ? p.monthly_rent_eth : null;
      const rentEnabled = p.rent_enabled;
      const hasInvestors = Number(p.tokens_sold || 0) > 0;
      const soldPct = Math.min(100, Number(p.sold_percentage || 0));
      
      // Check if tenant has active rental for this property
      const activeRental = activeRentals.find(r => Number(r.property_id) === Number(p.id));
      const rentalStatus = activeRental ? "active" : (rentEnabled ? "available" : "inactive");
      const statusLabel = activeRental ? "Currently Renting" : (rentEnabled ? "Available" : "No Rent Set");
      const statusClass = activeRental ? "active" : (rentEnabled ? "active" : "inactive");

      // Calculate next due date (1 month from rental start or last payment)
      let nextDueText = "--";
      if (activeRental) {
        const startDate = new Date(activeRental.rental_start_date);
        const now = new Date();
        const nextDue = new Date(startDate);
        while (nextDue <= now) {
          nextDue.setMonth(nextDue.getMonth() + 1);
        }
        nextDueText = nextDue.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      }

      return `<article class="rental-card">
        <div class="rental-card-body">
          <div class="rental-card-header">
            <div>
              <span class="pill">Property #${p.id}</span>
              <h3 style="margin:6px 0 2px;">${p.name}</h3>
              <p class="muted">${p.location}</p>
            </div>
            <span class="rental-status-badge rental-status-badge--${statusClass}">
              <span class="rental-status-badge--dot"></span>
              ${statusLabel}
            </span>
          </div>
          
          <div class="rental-rent-display ${rentEnabled ? '' : 'not-set'}">
            <div>
              <span class="rent-label">Monthly Rent</span>
              <div class="rent-value">${rentEth ? rentEth + ' ETH' : 'Not Set'}</div>
            </div>
          </div>

          <div class="rental-info-grid">
            <div class="rental-info-item">
              <span class="info-label">Property Value</span>
              <span class="info-value">${formatCurrency(p.total_value)}</span>
            </div>
            <div class="rental-info-item">
              <span class="info-label">Token Symbol</span>
              <span class="info-value">${p.token_symbol}</span>
            </div>
            <div class="rental-info-item">
              <span class="info-label">Investors</span>
              <span class="info-value">${hasInvestors ? 'Active' : 'None'}</span>
            </div>
            <div class="rental-info-item">
              <span class="info-label">${activeRental ? 'Next Due' : 'Ownership Sold'}</span>
              <span class="info-value">${activeRental ? nextDueText : soldPct.toFixed(1) + '%'}</span>
            </div>
          </div>

          <div class="supply-progress">
            <div class="supply-progress-meta">
              <span>Ownership Sold ${soldPct.toFixed(2)}%</span>
              <span>${Number(p.tokens_available || 0).toLocaleString()} tokens left</span>
            </div>
            <div class="supply-progress-track">
              <div class="supply-progress-fill" style="width:${soldPct.toFixed(2)}%"></div>
            </div>
          </div>

          <p class="muted" style="font-size:11px;">Contract: ${formatAddress(p.token_address)}</p>

          ${state.activeWallet
            ? (rentEnabled
              ? `<button type="button" class="pay-rent-btn" data-property-id="${p.id}">
                  <span class="btn-icon">💰</span> Pay Rent — ${rentEth} ETH
                </button>`
              : `<button type="button" class="pay-rent-btn" disabled>
                  Rent Not Set by Property Owner
                </button>`)
            : `<button type="button" class="pay-rent-btn" disabled>
                Select a Tenant Account First
              </button>`
          }
        </div>
      </article>`;
    }).join("");

    // Use delegated handler so clicks keep working even after frequent re-renders.
    grid.onclick = (event) => {
      const btn = event.target.closest(".pay-rent-btn:not([disabled])");
      if (!btn) return;
      openPayRentDialog(btn.dataset.propertyId).catch(e => alert(e.message));
    };
  } catch (err) { console.error(err); }
}

/* ══════════════════════════════════════════
   PAY RENT DIALOG
   ══════════════════════════════════════════ */
const payRentDialog = document.getElementById("pay-rent-dialog");
const payRentForm = document.getElementById("pay-rent-form");
const payRentPropertyName = document.getElementById("pay-rent-property-name");
const payRentPropertyId = document.getElementById("pay-rent-property-id");
const payRentAmountDisplay = document.getElementById("pay-rent-amount-display");
const payRentWalletDisplay = document.getElementById("pay-rent-wallet-display");
const payRentDistPreview = document.getElementById("pay-rent-distribution-preview");
const payRentProgress = document.getElementById("pay-rent-progress");
const payRentError = document.getElementById("pay-rent-error");
const payRentSuccess = document.getElementById("pay-rent-success");
const payRentSubmitBtn = document.getElementById("pay-rent-submit-btn");
const rentStepPrepare = document.getElementById("rent-step-prepare");
const rentStepSend = document.getElementById("rent-step-send");
const rentStepMine = document.getElementById("rent-step-mine");
const rentStepConfirm = document.getElementById("rent-step-confirm");

function resetRentProgress() {
  payRentProgress.classList.remove("visible");
  [rentStepPrepare, rentStepSend, rentStepMine, rentStepConfirm].forEach(s => s.className = "invest-step");
  payRentError.style.display = "none"; payRentError.textContent = "";
  payRentSuccess.style.display = "none"; payRentSuccess.textContent = "";
  payRentSubmitBtn.disabled = false;
}

function setRentStep(el, status) { el.className = "invest-step " + status; }

async function openPayRentDialog(propertyId) {
  if (!state.activeWallet) { alert("Connect MetaMask first."); return; }

  const property = state.properties.find(p => String(p.id) === String(propertyId));
  if (!property) { alert("Property not found."); return; }
  if (!property.rent_enabled) { alert("Rent not set for this property."); return; }

  payRentPropertyName.textContent = `${property.name} — ${property.location}`;
  payRentPropertyId.value = property.id;
  payRentAmountDisplay.textContent = `Monthly Rent: ${property.monthly_rent_eth} ETH`;
  payRentWalletDisplay.textContent = `Paying as: ${formatAddress(state.activeWallet)}`;
  resetRentProgress();
  payRentDistPreview.innerHTML = '<div class="muted" style="font-size:0.85rem;">Loading distribution preview...</div>';

  // Open dialog immediately so the button always feels responsive.
  payRentDialog.showModal();

  // Load distribution preview
  apiRequest(`/tenant/preview-distribution/${propertyId}`)
    .then((preview) => {
      if (!payRentDialog.open) return;
      if (preview.breakdown && preview.breakdown.length) {
        payRentDistPreview.innerHTML = `<div style="font-size:0.85rem;"><strong>Distribution Preview (${preview.investor_count} investors):</strong>` +
          preview.breakdown.map(b => `<div class="muted" style="margin-left:8px;">• ${formatAddress(b.investor)}: ${b.payout_eth} ETH (${b.ownership_pct}%)</div>`).join("") +
          `</div>`;
      } else {
        payRentDistPreview.innerHTML = '<div class="muted" style="font-size:0.85rem;">No investors to distribute to yet.</div>';
      }
    })
    .catch((err) => {
      if (!payRentDialog.open) return;
      payRentDistPreview.innerHTML = `<div class="muted" style="font-size:0.85rem;">Could not load preview: ${err.message}</div>`;
    });
}

async function handlePayRent(event) {
  event.preventDefault();
  if (state.paymentInFlight) return;
  if (!state.activeWallet) { alert("Select a tenant account first."); return; }

  const propertyId = payRentPropertyId.value;
  const property = state.properties.find(p => String(p.id) === String(propertyId));
  if (!property || !property.rent_enabled) { alert("Property not found or rent not set."); return; }

  payRentSubmitBtn.disabled = true;
  state.paymentInFlight = true;
  payRentProgress.classList.add("visible");
  payRentError.style.display = "none";
  payRentSuccess.style.display = "none";

  try {
    const ethers = getEthers();
    const signer = getSelectedSigner();
    const signerAddress = await signer.getAddress();

    // Step 1: Prepare — get rent contract info from backend
    setRentStep(rentStepPrepare, "active");
    const prepared = await apiRequest(`/tenant/pay-rent/prepare/${propertyId}`);
    setRentStep(rentStepPrepare, "done");

    // Step 2: Sign and send payRent() transaction
    setRentStep(rentStepSend, "active");
    const rentContract = new ethers.Contract(prepared.rent_contract_address, RENT_DISTRIBUTION_ABI, signer);
    // Ensure we pass an integer wei value. Prefer using the integer `monthly_rent_wei`
    // when available (already in base units). Otherwise parse the ETH decimal
    // string defensively using `safeParseEther` which limits precision.
    let valueToSend;
    try {
      if (prepared.monthly_rent_wei && String(prepared.monthly_rent_wei).match(/^\d+$/)) {
        valueToSend = ethers.BigNumber.from(String(prepared.monthly_rent_wei));
      } else {
        valueToSend = safeParseEther(prepared.monthly_rent_eth ?? prepared.monthly_rent_wei ?? "0");
      }
    } catch (e) {
      // Fallback: try parseEther on the ETH string, but log for debugging.
      console.warn("safe wei conversion failed, falling back to parseEther:", e, prepared);
      valueToSend = ethers.utils.parseEther(String(prepared.monthly_rent_eth || "0"));
    }
    const tx = await rentContract.payRent(Number(propertyId), {
      value: valueToSend
    });
    setRentStep(rentStepSend, "done");

    // Step 3: Mine
    setRentStep(rentStepMine, "active");
    const receipt = await tx.wait();
    setRentStep(rentStepMine, "done");

    // Step 4: Confirm with backend — index events
    setRentStep(rentStepConfirm, "active");
    const result = await apiRequest(`/tenant/pay-rent/confirm/${propertyId}`, {
      method: "POST",
      body: JSON.stringify({ tx_hash: tx.hash, tenant_wallet: signerAddress })
    });
    setRentStep(rentStepConfirm, "done");

    payRentSuccess.textContent = `Rent paid! ${result.investors_paid} investors received ETH. Tx: ${formatAddress(tx.hash)}`;
    payRentSuccess.style.display = "block";

    // Refresh everything
    await walletLoadAccounts();
    wallet._notify();
    renderAccountDropdown();
    updateTenantWalletUI();
    await loadRentals();
    await loadDashboard();
    await loadPaymentHistory();
    await loadTransactions();

    setTimeout(() => { payRentDialog.close(); resetRentProgress(); }, 2000);
  } catch (err) {
    const msg = isUserRejectedTransactionError(err) ? "Transaction cancelled." : formatInvestmentError(err);
    payRentError.textContent = msg;
    payRentError.style.display = "block";
    [rentStepPrepare, rentStepSend, rentStepMine, rentStepConfirm].forEach(s => {
      if (s.classList.contains("active")) setRentStep(s, "error");
    });
  } finally {
    payRentSubmitBtn.disabled = false;
    state.paymentInFlight = false;
  }
}

payRentForm.addEventListener("submit", handlePayRent);
document.getElementById("close-pay-rent").addEventListener("click", () => { payRentDialog.close(); resetRentProgress(); });

/* ══════════════════════════════════════════
   PAYMENTS — History & Active Rentals
   ══════════════════════════════════════════ */
async function loadPaymentHistory() {
  const el = document.getElementById("payment-history");
  if (!state.activeWallet) {
    el.innerHTML = '<div class="empty">Select an account to see payment history.</div>';
    return;
  }
  try {
    const payments = await apiRequest(`/tenant/payment-history/${state.activeWallet}`);
    if (!payments.length) { el.innerHTML = '<div class="empty">No rent payments found.</div>'; renderPaymentTimelineChart([]); return; }
    el.innerHTML = payments.map(p => `
      <div class="item">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${p.property_name || "Property #" + p.property_id}</strong>
          <span style="color:var(--success);font-weight:600;">${p.amount_eth} ETH</span>
        </div>
        <div class="muted">Status: ${p.payment_status} • Block: ${p.block_number || "--"}</div>
        <div class="muted">Tx: ${formatAddress(p.tx_hash)} • ${new Date(p.payment_date).toLocaleString()}</div>
      </div>`).join("");
    renderPaymentTimelineChart(payments);
  } catch (err) { el.innerHTML = `<div class="empty">Error: ${err.message}</div>`; }
}

async function loadActiveRentals() {
  const el = document.getElementById("active-rentals-list");
  if (!state.activeWallet) {
    el.innerHTML = '<div class="empty">Select an account to see active rentals.</div>';
    return;
  }
  try {
    const rentals = await apiRequest(`/tenant/active-rentals/${state.activeWallet}`);
    if (!rentals.length) { el.innerHTML = '<div class="empty">No active rentals.</div>'; return; }
    el.innerHTML = rentals.map(r => `
      <div class="item">
        <strong>${r.property_name || "Property #" + r.property_id}</strong>
        <div class="muted">${r.location || ""}</div>
        <div class="muted">Since: ${r.rental_start_date || "--"} • Status: ${r.status}</div>
      </div>`).join("");
  } catch (err) { el.innerHTML = `<div class="empty">Error: ${err.message}</div>`; }
}

/* ══════════════════════════════════════════
   TRANSACTIONS
   ══════════════════════════════════════════ */
async function loadTransactions() {
  const list = document.getElementById("transaction-list");
  if (!state.activeWallet) {
    list.innerHTML = '<div class="empty">Select an account to see transactions.</div>';
    return;
  }
  try {
    const txs = await apiRequest(`/transactions?wallet_address=${state.activeWallet}`);
    state.transactions = txs;
    list.innerHTML = txs.length ? txs.map(tx => txCardHTML(tx)).join("") : '<div class="empty">No transactions found.</div>';
  } catch (err) { console.error(err); }
}

document.getElementById("tx-refresh").addEventListener("click", () => loadTransactions().catch(() => {}));

/* ══════════════════════════════════════════
   CONTACT
   ══════════════════════════════════════════ */
async function loadContactInfo() {
  try {
    const ownerEl = document.getElementById("contact-owner-wallet");
    if (ownerEl && wallet.address) {
      ownerEl.innerHTML = `<strong>Wallet:</strong> <span class="mono">${wallet.address}</span>`;
    } else if (ownerEl) {
      ownerEl.innerHTML = "<strong>Wallet:</strong> Not available";
    }
  } catch (err) { console.error(err); }
}

/* ── Payment Timeline Chart ── */
let chartPaymentTimeline = null;
function renderPaymentTimelineChart(payments) {
  if (typeof Chart === "undefined") return;
  const canvas = document.getElementById("chart-payment-timeline");
  if (!canvas) return;
  if (chartPaymentTimeline) chartPaymentTimeline.destroy();

  if (!payments || !payments.length) {
    chartPaymentTimeline = null;
    return;
  }

  const isDark = !document.body.classList.contains("light-theme");
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const textColor = isDark ? "#a1a1aa" : "#71717a";

  const sorted = [...payments].sort((a, b) => new Date(a.payment_date) - new Date(b.payment_date));
  const labels = sorted.map(p => new Date(p.payment_date).toLocaleDateString());
  const data = sorted.map(p => Number(p.amount_eth));

  chartPaymentTimeline = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Rent Paid (ETH)",
        data,
        backgroundColor: "#10b981",
        borderRadius: 4,
        barThickness: 20
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

/* ── Auto-refresh ── */
setInterval(() => { if (nav && nav.currentPage === "dashboard") loadDashboard().catch(() => {}); }, 10000);
setInterval(() => {
  if (wallet.connected) {
    walletLoadAccounts().then(() => { renderAccountDropdown(); updateTenantWalletUI(); }).catch(() => {});
  }
}, 5000);
