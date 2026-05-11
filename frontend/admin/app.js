/* ══════════════════════════════════════════════════
   EstateChain — Admin Dashboard
   ══════════════════════════════════════════════════ */

const state = { properties: [], transactions: [], users: [], summary: null, currentUser: null };

/* ── Auth guard: require an authenticated admin wallet before bootstrap ──
   This re-validates the JWT against the backend on every page load and
   redirects to the landing page if the session is missing, invalid, or for
   a non-admin role. Existing business logic below remains untouched. */
(async function bootstrap() {
  try {
    state.currentUser = await EstateChainAuth.requireRole("admin");
  } catch (e) {
    // requireRole already redirects on failure
    return;
  }

  initTheme();
  initWalletUI();
  initHealthCheck();
  const nav = initNavigation("dashboard");
  window.__nav = nav; // expose for any inline handlers referencing nav

  // Make sure the wallet UI reflects the authenticated wallet on first paint.
  EstateChainAuth.onChange(() => {
    const u = EstateChainAuth.getUser();
    if (!u) return;
    const lbl = document.getElementById("mm-wallet-label");
    if (lbl) lbl.textContent = "Admin Wallet";
  });

  /* ── Page change handler ── */
  window.addEventListener("pagechange", async (e) => {
    try {
      const page = e.detail.page;
      if (page === "dashboard") await loadDashboard();
      if (page === "properties") await loadPropertiesPage();
      if (page === "transactions") await loadTransactionsPage();
      if (page === "investors") await loadInvestorsPage();
      if (page === "analytics") await loadAnalyticsPage();
      if (page === "rent-mgmt") await loadRentManagementPage();
    } catch (err) { setResponse({ error: err.message }); }
  });

  await loadDashboard().catch(() => {});
})();

function setResponse(p) { console.log("[API]", p); }

async function withFormSubmitLock(form, action) {
  if (!form || form.dataset.submitting === "true") return;
  const submitButton = form.querySelector('button[type="submit"]');
  const originalText = submitButton ? submitButton.textContent : "";
  form.dataset.submitting = "true";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Saving...";
  }
  try {
    return await action();
  } finally {
    form.dataset.submitting = "false";
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
}

/* ══════════════════════════════════════════
   DASHBOARD PAGE
   ══════════════════════════════════════════ */
async function loadDashboard() {
  try {
    const [summary, properties, transactions, users, rentAnalytics] = await Promise.all([
      apiRequest("/dashboard/summary"),
      apiRequest("/properties"),
      apiRequest("/transactions"),
      apiRequest("/users").catch(() => []),
      apiRequest("/admin/rent-analytics").catch(() => ({ total_rent_collected_wei: "0", total_rent_distributed_wei: "0", total_payments: 0, active_rentals: 0 }))
    ]);
    state.summary = summary;
    state.properties = properties;
    state.transactions = transactions;
    state.users = users;

    const divisor = Math.pow(10, TOKEN_DECIMALS);
    document.getElementById("s-properties").textContent = summary.properties_loaded || 0;
    document.getElementById("s-investors").textContent = users.length || 0;

    let totalSupply = 0;
    properties.forEach(p => totalSupply += Number(p.token_supply || 0));
    document.getElementById("s-token-supply").textContent = totalSupply.toLocaleString();
    document.getElementById("s-avg-price").textContent = formatCurrency(summary.avg_min_spend_per_token || 0);

    const totalValue = Number(summary.total_portfolio_value ?? 0) / (divisor || 1);
    const totalHoldings = Number(summary.total_token_holdings ?? 0) / (divisor || 1);
    document.getElementById("s-total-value").textContent = formatCurrency(totalValue);
    document.getElementById("s-total-holdings").textContent = formatTokenAmount(totalHoldings);
    document.getElementById("s-total-tx").textContent = transactions.length;

    const adminBalance = wallet.balance != null ? wallet.balance : (wallet.accounts[0] ? Number(wallet.accounts[0].balance_eth || 0) : 0);
    document.getElementById("s-eth-balance").textContent = Number(adminBalance || 0).toFixed(4) + " ETH";
    const adminWalletEl = document.getElementById("admin-wallet-display");
    if (adminWalletEl) {
      adminWalletEl.innerHTML = `<span class="mono">${wallet.address ? wallet.address : "--"}</span> <span class="pill" style="font-size:0.75rem;margin-left:6px;">MetaMask</span>`;
    }

    // Rent analytics in dashboard
    const rentCollectedEl = document.getElementById("s-rent-collected");
    const activeRentalsEl = document.getElementById("s-active-rentals");
    if (rentCollectedEl) {
      const collectedEth = (Number(rentAnalytics.total_rent_collected_wei || 0) / 1e18);
      rentCollectedEl.textContent = collectedEth.toFixed(4) + " ETH";
    }
    if (activeRentalsEl) {
      activeRentalsEl.textContent = String(rentAnalytics.active_rentals || 0);
    }

    // Charts
    renderDashboardCharts(transactions, properties);
  } catch (err) { console.error("loadDashboard error:", err); }
}

/* ── Dashboard Charts ── */
let chartTxBreakdown = null;
let chartPropertyProgress = null;
let _lastChartDataHash = "";

function renderDashboardCharts(transactions, properties) {
  if (typeof Chart === "undefined") return;

  // Only re-render if data actually changed
  const dataHash = JSON.stringify({ t: transactions.length, p: properties.map(p => p.sold_percentage) });
  if (dataHash === _lastChartDataHash && chartTxBreakdown && chartPropertyProgress) return;
  _lastChartDataHash = dataHash;

  const isDark = !document.body.classList.contains("light-theme");
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const textColor = isDark ? "#a1a1aa" : "#71717a";

  // Transaction Breakdown — Doughnut
  const breakdown = {};
  transactions.forEach(t => { const label = t.action_label || t.type; breakdown[label] = (breakdown[label] || 0) + 1; });
  const txLabels = Object.keys(breakdown);
  const txData = Object.values(breakdown);
  const txColors = ["#6366f1", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899"];

  const ctx1 = document.getElementById("chart-tx-breakdown");
  if (ctx1) {
    if (chartTxBreakdown) chartTxBreakdown.destroy();
    chartTxBreakdown = new Chart(ctx1, {
      type: "doughnut",
      data: {
        labels: txLabels,
        datasets: [{ data: txData, backgroundColor: txColors.slice(0, txLabels.length), borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: {
          legend: { position: "bottom", labels: { color: textColor, font: { family: "Inter", size: 12 }, padding: 12 } }
        },
        cutout: "65%"
      }
    });
  }

  // Property Progress — Bar
  const propLabels = properties.map(p => p.name || "Property #" + p.id);
  const propData = properties.map(p => Number(p.sold_percentage ?? 0));

  const ctx2 = document.getElementById("chart-property-progress");
  if (ctx2) {
    if (chartPropertyProgress) chartPropertyProgress.destroy();
    chartPropertyProgress = new Chart(ctx2, {
      type: "bar",
      data: {
        labels: propLabels,
        datasets: [{ label: "Sold %", data: propData, backgroundColor: "#6366f1", borderRadius: 4, barThickness: 24 }]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: { max: 100, grid: { color: gridColor }, ticks: { color: textColor, font: { family: "Inter", size: 12 } } },
          y: { grid: { display: false }, ticks: { color: textColor, font: { family: "Inter", size: 12 } } }
        }
      }
    });
  }
}

/* ══════════════════════════════════════════
   PROPERTIES PAGE
   ══════════════════════════════════════════ */
async function loadPropertiesPage() {
  try {
    state.properties = await apiRequest("/properties");
    const grid = document.getElementById("property-grid");
    if (!state.properties.length) {
      grid.innerHTML = '<div class="empty">No properties found.</div>';
    } else {
      grid.innerHTML = state.properties.map(p => {
        const base = propertyCardHTML(p, { editBtn: true });
        const deployBtn = p.token_address
          ? `<span class="pill" style="margin-top:8px;display:inline-block;">Token deployed</span>`
          : `<button type="button" class="deploy-token-btn" data-property-id="${p.id}">Deploy Token</button>`;
        // Sync Rent Chain: registers the property on-chain + syncs monthly rent + adds any
        // new investors to the RentDistribution contract. Run after issuing tokens to new
        // investors, or after changing the monthly rent.
        const syncBtn = p.token_address
          ? `<button type="button" class="sync-rent-chain-btn" data-property-id="${p.id}" style="margin-left:8px;">Sync Rent Chain</button>`
          : '';
        return base.replace('</div></article>', `${deployBtn}${syncBtn}</div></article>`);
      }).join("");
    }
    // Attach edit button handlers
    document.querySelectorAll('.edit-property-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = btn.dataset.propertyId;
        try {
          const prop = await apiRequest(`/properties/${id}`);
          document.getElementById('edit-property-id').value = prop.id;
          document.getElementById('edit-name').value = prop.name || '';
          document.getElementById('edit-location').value = prop.location || '';
          document.getElementById('edit-total-value').value = prop.total_value || '';
          document.getElementById('edit-token-supply').value = prop.token_supply || '';
          document.getElementById('edit-token-symbol').value = prop.token_symbol || '';
          const salePriceInput = document.getElementById('edit-token-sale-price-eth');
          if (salePriceInput) salePriceInput.value = prop.token_sale_price_eth || '';
          document.getElementById('edit-monthly-rent-eth').value = prop.monthly_rent_eth || '';
          document.getElementById('edit-property-dialog').showModal();
        } catch (err) { alert(err.message); }
      });
    });
    // Attach deploy-token button handlers
    document.querySelectorAll('.deploy-token-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.propertyId;
        btn.disabled = true;
        btn.textContent = 'Deploying…';
        try {
          await apiRequest(`/properties/${id}/deploy-token`, { method: 'POST' });
          await loadPropertiesPage();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Deploy Token';
          alert('Deploy failed: ' + err.message);
        }
      });
    });
    // Attach sync-rent-chain button handlers
    document.querySelectorAll('.sync-rent-chain-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.propertyId;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Syncing…';
        try {
          const result = await apiRequest(`/properties/${id}/sync-rent-chain`, { method: 'POST' });
          alert(`Rent chain synced. Investors on-chain: ${result.investor_count}`);
        } catch (err) {
          alert('Sync failed: ' + err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      });
    });
  } catch (err) { console.error("loadPropertiesPage error:", err); }
}

/* ── Forms ── */
document.getElementById("create-property-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await withFormSubmitLock(e.target, async () => {
    const fd = new FormData(e.target);
    const entries = Object.fromEntries(fd.entries());
    const payload = { ...entries };
    // Normalize monthly_rent_eth: remove if empty
    if (!payload.monthly_rent_eth) delete payload.monthly_rent_eth;
    try {
      await apiRequest("/properties", { method: "POST", body: JSON.stringify(payload) });
      e.target.reset();
      await loadPropertiesPage();
      await loadDashboard();
    } catch (err) { console.error("createProperty error:", err); alert(err.message); }
  });
});

document.getElementById("mint-nft-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await withFormSubmitLock(e.target, async () => {
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      await apiRequest(`/properties/${payload.property_id}/mint-nft`, {
        method: "POST", body: JSON.stringify({ to_address: payload.to_address, token_uri: payload.token_uri })
      });
      e.target.reset();
      await loadPropertiesPage();
    } catch (err) { console.error("mintNFT error:", err); alert(err.message); }
  });
});

// Edit property form
document.getElementById('edit-property-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await withFormSubmitLock(e.target, async () => {
    const id = document.getElementById('edit-property-id').value;
    const payload = {
      name: document.getElementById('edit-name').value,
      location: document.getElementById('edit-location').value,
      total_value: document.getElementById('edit-total-value').value,
      token_supply: document.getElementById('edit-token-supply').value,
      token_symbol: document.getElementById('edit-token-symbol').value,
      token_sale_price_eth: document.getElementById('edit-token-sale-price-eth').value,
      monthly_rent_eth: document.getElementById('edit-monthly-rent-eth').value || null
    };
    try {
      await apiRequest(`/properties/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      document.getElementById('edit-property-dialog').close();
      await loadPropertiesPage();
      await loadDashboard();
    } catch (err) { alert(err.message); }
  });
});

document.getElementById('close-edit-property').addEventListener('click', () => {
  document.getElementById('edit-property-dialog').close();
});

/* ══════════════════════════════════════════
   TRANSACTIONS PAGE
   ══════════════════════════════════════════ */
async function loadTransactionsPage() {
  const typeFilter = document.getElementById("tx-type-filter");
  const txType = typeFilter ? typeFilter.value : "";
  try {
    const params = new URLSearchParams();
    if (txType) params.append("tx_type", txType);
    const query = params.toString();
    const transactions = await apiRequest(`/transactions${query ? "?" + query : ""}`);
    state.transactions = transactions;
    const list = document.getElementById("transaction-list");
    if (!transactions.length) {
      list.innerHTML = '<div class="empty">No transactions found.</div>';
    } else {
      list.innerHTML = transactions.map(tx => txCardHTML(tx)).join("");
    }
  } catch (err) { console.error("loadTransactionsPage error:", err); }
}

document.getElementById("tx-type-filter").addEventListener("change", () => loadTransactionsPage().catch(e => console.error(e)));
document.getElementById("tx-refresh").addEventListener("click", () => loadTransactionsPage().catch(e => console.error(e)));

/* ══════════════════════════════════════════
   INVESTORS PAGE
   ══════════════════════════════════════════ */
async function loadInvestorsPage() {
  try {
    const [users, properties] = await Promise.all([
      apiRequest("/users").catch(() => []),
      apiRequest("/properties")
    ]);
    state.users = users;
    state.properties = properties;

    const invList = document.getElementById("investor-list");
    if (!users.length) {
      invList.innerHTML = '<div class="empty">No registered investors.</div>';
    } else {
      let html = "";
      for (const user of users) {
        let holdings = [];
        try {
          const portfolio = await apiRequest(`/portfolio/${user.wallet_address}`);
          holdings = portfolio.holdings || [];
        } catch {}
        const totalTokens = holdings.reduce((sum, h) => sum + toTokenUnits(h.token_amount, TOKEN_DECIMALS), 0);
        const totalValue = holdings.reduce((sum, h) => {
          const prop = properties.find(p => Number(p.id) === Number(h.property_id));
          if (!prop) return sum;
          const unitVal = Number(prop.total_value || 0) / Number(prop.token_supply || 1);
          return sum + unitVal * toTokenUnits(h.token_amount, TOKEN_DECIMALS);
        }, 0);
        const displayName = formatAddress(user.wallet_address);
        const kycClass = (user.kyc_status || "pending") === "approved" ? "kyc-approved" : "kyc-pending";
        html += `<div class="item investor-item">
          <div class="investor-item-header">
            <strong>${displayName}</strong>
            <span class="pill">${holdings.length} properties</span>
          </div>
          <div class="investor-item-meta">
            <span>Tokens: ${formatTokenAmount(totalTokens)}</span>
            <span>Portfolio Value: ${formatCurrency(totalValue)}</span>
            <span class="${kycClass}">KYC: ${user.kyc_status || "pending"}</span>
          </div>
        </div>`;
      }
      invList.innerHTML = html;
    }
  } catch (err) { console.error("loadInvestorsPage error:", err); }
}

/* ══════════════════════════════════════════
   ANALYTICS PAGE
   ══════════════════════════════════════════ */
async function loadAnalyticsPage() {
  try {
    const [properties, transactions] = await Promise.all([
      apiRequest("/properties"),
      apiRequest("/transactions")
    ]);
    state.properties = properties;
    state.transactions = transactions;

    // Investment volume
    const investTxs = transactions.filter(t => t.type === "INVESTMENT_COMPLETED" || t.type === "INVESTMENT_FUNDED");
    const rentTxs = transactions.filter(t => t.type === "RENT_DISTRIBUTED" || t.type === "RENT_PAID");
    let investVolume = 0;
    investTxs.forEach(t => {
      const amt = Number(t.display_amount || 0);
      if (t.amount_unit === "ETH") investVolume += amt * 2500;
      else investVolume += amt;
    });
    document.getElementById("a-invest-volume").textContent = formatCurrency(investVolume);
    document.getElementById("a-avg-invest").textContent = investTxs.length ? formatCurrency(investVolume / investTxs.length) : "$0.00";
    document.getElementById("a-rent-total").textContent = rentTxs.length;
    document.getElementById("a-active-props").textContent = properties.filter(p => Number(p.tokens_sold || 0) > 0).length;

    // Property performance
    const propsEl = document.getElementById("analytics-properties");
    if (!properties.length) {
      propsEl.innerHTML = '<div class="empty">No properties.</div>';
    } else {
      propsEl.innerHTML = properties.map(p => {
        const soldPct = Math.min(100, Number(p.sold_percentage ?? 0));
        return `<div class="item"><div class="property-top"><strong>${p.name}</strong><span class="pill">${p.location}</span></div>
          <div class="supply-progress" style="margin-top:8px;">
            <div class="supply-progress-meta"><span>Sold ${soldPct.toFixed(2)}%</span><span>${formatCurrency(p.total_value)}</span></div>
            <div class="supply-progress-track"><div class="supply-progress-fill" style="width:${soldPct.toFixed(2)}%"></div></div>
          </div></div>`;
      }).join("");
    }

    // Transaction breakdown
    const breakdown = {};
    transactions.forEach(t => { breakdown[t.action_label] = (breakdown[t.action_label] || 0) + 1; });
    const bdEl = document.getElementById("analytics-tx-breakdown");
    bdEl.innerHTML = Object.entries(breakdown).map(([label, count]) =>
      `<article class="stat-card subtle-card"><span>${label}</span><strong>${count}</strong></article>`
    ).join("") || '<div class="empty">No data.</div>';

  } catch (err) { console.error("loadAnalyticsPage error:", err); }
}

/* ══════════════════════════════════════════
   RENT MANAGEMENT PAGE
   ══════════════════════════════════════════ */
async function loadRentManagementPage() {
  // Analytics
  try {
    const analytics = await apiRequest("/admin/rent-analytics");
    const collectedEth = Number(analytics.total_rent_collected_wei || 0) / 1e18;
    const distributedEth = Number(analytics.total_rent_distributed_wei || 0) / 1e18;
    document.getElementById("rm-total-collected").textContent = collectedEth.toFixed(4) + " ETH";
    document.getElementById("rm-total-distributed").textContent = distributedEth.toFixed(4) + " ETH";
    document.getElementById("rm-total-payments").textContent = String(analytics.total_payments || 0);
    document.getElementById("rm-active-rentals").textContent = String(analytics.active_rentals || 0);
  } catch (err) { console.error("rent analytics error:", err); }

  // Rent payments
  try {
    const payments = await apiRequest("/admin/rent-payments");
    const el = document.getElementById("rm-payments-list");
    if (!payments.length) {
      el.innerHTML = '<div class="empty">No rent payments yet.</div>';
    } else {
      el.innerHTML = payments.map(p => {
        const tenantName = formatAddress(p.tenant_wallet);
        return `<div class="item">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${p.property_name || "Property #" + p.property_id}</strong>
            <span style="color:var(--success);font-weight:600;">${p.amount_eth} ETH</span>
          </div>
          <div class="muted">Tenant: ${tenantName} • Status: ${p.payment_status}</div>
          <div class="muted">Tx: ${formatAddress(p.tx_hash)} • ${new Date(p.payment_date).toLocaleString()}</div>
        </div>`;
      }).join("");
    }
  } catch (err) { console.error("rent payments error:", err); }

  // Distributions
  try {
    const dists = await apiRequest("/admin/distributions");
    const el = document.getElementById("rm-distributions-list");
    if (!dists.length) {
      el.innerHTML = '<div class="empty">No distributions yet.</div>';
    } else {
      const totalDistWei = Number(dists[0]?.total_distributed || 0) / 1e18;
      el.innerHTML = dists.map(d => {
        const distEth = (Number(d.total_distributed || 0) / 1e18).toFixed(6);
        const collEth = (Number(d.total_rent_collected || 0) / 1e18).toFixed(6);
        return `<div class="item">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${d.property_name || "Property #" + d.property_id}</strong>
            <span style="color:var(--success);font-weight:600;">${distEth} ETH distributed</span>
          </div>
          <div class="muted">Rent collected: ${collEth} ETH • Investors paid: ${d.investor_count}</div>
          <div class="muted">Tx: ${formatAddress(d.distribution_tx_hash)} • ${new Date(d.distributed_at).toLocaleString()}</div>
        </div>`;
      }).join("");
    }
  } catch (err) { console.error("distributions error:", err); }

  // Active rentals
  try {
    const rentals = await apiRequest("/admin/active-rentals");
    const el = document.getElementById("rm-active-rentals-list");
    if (!rentals.length) {
      el.innerHTML = '<div class="empty">No active rentals.</div>';
    } else {
      el.innerHTML = rentals.map(r => {
        const tenantName = formatAddress(r.tenant_wallet);
        return `<div class="item">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${r.property_name || "Property #" + r.property_id}</strong>
            <span class="pill">${r.status}</span>
          </div>
          <div class="muted">Tenant: ${tenantName} • ${r.location || ""}</div>
          <div class="muted">Since: ${r.rental_start_date || "--"}</div>
        </div>`;
      }).join("");
    }
  } catch (err) { console.error("active rentals error:", err); }
}

/* ── Set Rent Form ── */
document.getElementById("set-rent-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await withFormSubmitLock(e.target, async () => {
    const fd = new FormData(e.target);
    const propertyId = fd.get("property_id");
    const monthlyRentEth = fd.get("monthly_rent_eth");
    const successEl = document.getElementById("set-rent-success");
    const errorEl = document.getElementById("set-rent-error");
    successEl.style.display = "none"; errorEl.style.display = "none";
    try {
      const res = await apiRequest(`/properties/${propertyId}/set-rent`, {
        method: "POST",
        body: JSON.stringify({ monthly_rent_eth: monthlyRentEth })
      });
      successEl.textContent = `Rent set! Property #${propertyId}: ${res.monthly_rent_eth} ETH/month`;
      successEl.style.display = "block";
      e.target.reset();
      await loadRentManagementPage();
    } catch (err) {
      errorEl.textContent = err.message || "Failed to set rent.";
      errorEl.style.display = "block";
    }
  });
});

/* ── Auto-refresh ── */
setInterval(() => {
  const nav = window.__nav;
  if (nav && nav.currentPage === "dashboard") loadDashboard().catch(() => {});
}, 30000);
