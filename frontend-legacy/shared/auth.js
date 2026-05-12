/**
 * EstateChain — Wallet Authentication Client
 * ────────────────────────────────────────────
 * Production-grade Web3 wallet sign-in:
 *   1. user clicks Connect Wallet
 *   2. MetaMask returns an account
 *   3. frontend POST /auth/nonce → backend issues a SIWE-style challenge
 *   4. frontend asks MetaMask to personal_sign(message)
 *   5. frontend POST /auth/verify with (wallet, signature, nonce)
 *       - if registered → backend returns { token, user }, we store it
 *       - if new       → backend returns { is_new_user: true }; UI shows role pick
 *   6. registration → POST /auth/register with same signed nonce flow
 *
 * Session persistence:
 *   - JWT stored in localStorage under `estatechain.session.v1`
 *   - On every API call, /shared/api.js consults `EstateChainAuth.getToken()`
 *     and attaches `Authorization: Bearer <jwt>` automatically.
 *   - MetaMask `accountsChanged` / `chainChanged` / `disconnect` events
 *     invalidate the session and force a re-auth.
 *
 * This module never trusts frontend-only state for authorization — every
 * privileged action is re-checked server-side by JWT verification.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'estatechain.session.v1';
  const VALID_ROLES = ['property_owner', 'investor', 'tenant'];

  const subscribers = new Set();

  // ────────────────────────────────────────────────────────────────
  // session storage
  // ────────────────────────────────────────────────────────────────
  function _readSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.token || !parsed.user) return null;
      // expiry guard
      if (parsed.expires_at) {
        const t = Date.parse(parsed.expires_at);
        if (Number.isFinite(t) && t < Date.now()) {
          localStorage.removeItem(STORAGE_KEY);
          return null;
        }
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function _writeSession(session) {
    if (!session || !session.token) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
    _notify();
  }

  function _notify() {
    const snap = currentSession();
    subscribers.forEach((cb) => {
      try { cb(snap); } catch (e) { console.error('[auth] subscriber error', e); }
    });
  }

  function onChange(cb) {
    if (typeof cb === 'function') subscribers.add(cb);
    return () => subscribers.delete(cb);
  }

  function currentSession() {
    return _readSession();
  }

  function getToken() {
    const s = _readSession();
    return s ? s.token : null;
  }

  function getUser() {
    const s = _readSession();
    return s ? s.user : null;
  }

  function getRole() {
    const u = getUser();
    return u ? (u.role || '').toLowerCase() : null;
  }

  function getWallet() {
    const u = getUser();
    return u ? (u.wallet_address || '').toLowerCase() : null;
  }

  function isAuthenticated() {
    return !!getToken();
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
    _notify();
  }

  // ────────────────────────────────────────────────────────────────
  // backend interactions
  // ────────────────────────────────────────────────────────────────
  function _rawFetch(path, options) {
    const base = (typeof getApiBaseUrl === 'function')
      ? getApiBaseUrl()
      : (global.EstateChainAPI?.base || '');
    return fetch(`${base}${path}`, options);
  }

  async function _post(path, body) {
    const res = await _rawFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const data = contentType.includes('application/json') ? await res.json() : { detail: await res.text() };
    if (!res.ok) {
      const err = new Error(data.detail || data.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function _get(path) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await _rawFetch(path, { method: 'GET', headers });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const data = contentType.includes('application/json') ? await res.json() : { detail: await res.text() };
    if (!res.ok) {
      const err = new Error(data.detail || data.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function _ensureMetaMask() {
    if (typeof global.ethereum === 'undefined') {
      throw new Error('MetaMask is not installed. Install it from https://metamask.io/');
    }
  }

  async function _requestAccount() {
    const accounts = await global.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts.length) throw new Error('No wallet account authorized');
    return accounts[0];
  }

  async function _personalSign(address, message) {
    return global.ethereum.request({
      method: 'personal_sign',
      params: [message, address],
    });
  }

  async function requestNonce(walletAddress) {
    return _post('/auth/nonce', { wallet_address: walletAddress });
  }

  async function lookupWallet(walletAddress) {
    try {
      return await _get(`/auth/lookup/${walletAddress}`);
    } catch (e) {
      return { wallet_address: walletAddress, registered: false, role: null };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // main entrypoint: full sign-in
  // ────────────────────────────────────────────────────────────────
  /**
   * Run the complete sign-in flow. Returns one of:
   *   { status: 'authenticated', session }      — user signed in successfully
   *   { status: 'needs_registration', walletAddress }
   *                                              — caller should show a registration UI
   * Throws on MetaMask / network failures or on signature mismatch.
   */
  async function signIn() {
    _ensureMetaMask();
    const walletAddress = await _requestAccount();

    // Issue a fresh nonce + message
    const challenge = await requestNonce(walletAddress);
    const signature = await _personalSign(walletAddress, challenge.message);

    // Try to verify (this also tells us if the wallet is registered)
    const verifyResp = await _post('/auth/verify', {
      wallet_address: walletAddress,
      signature,
      nonce: challenge.nonce,
    });

    if (verifyResp.is_new_user) {
      return {
        status: 'needs_registration',
        walletAddress: walletAddress.toLowerCase(),
      };
    }

    const session = {
      token: verifyResp.token,
      user: verifyResp.user,
      expires_at: verifyResp.expires_at,
    };
    _writeSession(session);
    return { status: 'authenticated', session };
  }

  /**
   * Complete registration for a brand-new wallet.
   *
   * The caller must:
   *   1. ensure they hold a confirmed MetaMask session for `walletAddress`
   *   2. have shown the user the role-picker UI and collected a choice
   *
   * We re-issue a fresh nonce, re-prompt MetaMask to sign it, and POST it to
   * /auth/register together with the chosen role. On success the new JWT is
   * persisted and the caller can redirect to the role dashboard.
   */
  async function register({ walletAddress, role, email }) {
    if (!walletAddress) throw new Error('walletAddress required');
    if (!VALID_ROLES.includes((role || '').toLowerCase())) {
      throw new Error(`Invalid role: ${role}`);
    }
    _ensureMetaMask();

    const challenge = await requestNonce(walletAddress);
    const signature = await _personalSign(walletAddress, challenge.message);

    const resp = await _post('/auth/register', {
      wallet_address: walletAddress,
      signature,
      nonce: challenge.nonce,
      role: role.toLowerCase(),
      email: email || null,
    });

    const session = {
      token: resp.token,
      user: resp.user,
      expires_at: resp.expires_at,
    };
    _writeSession(session);
    return session;
  }

  /**
   * Re-validate the session against the backend. Useful on dashboard load.
   * Returns the fresh user, or null if the session is invalid.
   */
  async function refresh() {
    const token = getToken();
    if (!token) return null;
    try {
      const me = await _get('/auth/me');
      const cur = currentSession();
      if (cur) {
        cur.user = me;
        _writeSession(cur);
      }
      return me;
    } catch (e) {
      if (e.status === 401 || e.status === 403) clearSession();
      return null;
    }
  }

  /**
   * Logout — revoke the session on the backend (best-effort) and clear local state.
   */
  async function logout({ silent = false } = {}) {
    const token = getToken();
    if (token) {
      try {
        await _rawFetch('/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (_) {
        // ignore — we still clear local state below
      }
    }
    clearSession();
    if (!silent) {
      global.location.href = '/';
    }
  }

  // ────────────────────────────────────────────────────────────────
  // MetaMask event integration
  // ────────────────────────────────────────────────────────────────
  /**
   * Install MetaMask listeners that invalidate the session whenever the user
   * changes accounts, switches networks, or disconnects. Idempotent.
   */
  function installWalletListeners() {
    if (typeof global.ethereum === 'undefined') return;
    if (global.__estatechain_auth_listeners_installed__) return;
    global.__estatechain_auth_listeners_installed__ = true;

    const handleAccountsChanged = (accounts) => {
      const sessionWallet = getWallet();
      const newAddr = accounts && accounts[0] ? accounts[0].toLowerCase() : null;
      if (!newAddr) {
        // User disconnected — drop session.
        if (sessionWallet) {
          clearSession();
          global.location.href = '/';
        }
        return;
      }
      if (sessionWallet && newAddr !== sessionWallet) {
        // Switched accounts — session no longer matches; force re-auth.
        clearSession();
        global.location.href = '/';
      }
    };

    const handleChainChanged = (chainIdHex) => {
      const expected = (typeof EXPECTED_CHAIN_HEX !== 'undefined')
        ? EXPECTED_CHAIN_HEX
        : '0xaa36a7';
      // If the user moves OFF the expected chain we require a fresh sign-in
      // for safety (txs would fail anyway). We do NOT clear the session if
      // they switched back ON to the expected chain.
      if (chainIdHex && chainIdHex.toLowerCase() !== expected.toLowerCase()) {
        if (isAuthenticated()) {
          clearSession();
          global.location.href = '/';
        }
      }
    };

    const handleDisconnect = () => {
      if (isAuthenticated()) {
        clearSession();
        global.location.href = '/';
      }
    };

    try { global.ethereum.on('accountsChanged', handleAccountsChanged); } catch {}
    try { global.ethereum.on('chainChanged', handleChainChanged); } catch {}
    try { global.ethereum.on('disconnect', handleDisconnect); } catch {}
  }

  // ────────────────────────────────────────────────────────────────
  // dashboard guard
  // ────────────────────────────────────────────────────────────────
  /**
   * Call at the top of a role dashboard's bootstrap. Redirects to `/` if the
   * user isn't signed in or signed in under a different role. Returns the
   * authenticated user on success.
   *
   * Also verifies that the live MetaMask account (if connected) matches the
   * authenticated wallet. If it doesn't, the session is cleared — the user
   * must re-sign-in with the matching wallet.
   */
  async function requireRole(expectedRole) {
    const session = currentSession();
    if (!session) {
      global.location.href = '/';
      throw new Error('not authenticated');
    }
    const me = await refresh();
    if (!me) {
      global.location.href = '/';
      throw new Error('session invalid');
    }
    if ((me.role || '').toLowerCase() !== expectedRole.toLowerCase()) {
      // Wrong dashboard for this user — redirect to their proper one.
      global.location.href = '/' + me.role.toLowerCase();
      throw new Error(`role mismatch: expected ${expectedRole}, got ${me.role}`);
    }
    // Sanity-check the live MetaMask account vs. the JWT subject (best-effort)
    try {
      if (typeof global.ethereum !== 'undefined') {
        const accounts = await global.ethereum.request({ method: 'eth_accounts' });
        const current = accounts && accounts[0] ? accounts[0].toLowerCase() : null;
        const sessionWallet = (me.wallet_address || '').toLowerCase();
        if (current && sessionWallet && current !== sessionWallet) {
          clearSession();
          global.location.href = '/';
          throw new Error('wallet/session mismatch');
        }
      }
    } catch (_) { /* ignore */ }
    return me;
  }

  // ────────────────────────────────────────────────────────────────
  // public API
  // ────────────────────────────────────────────────────────────────
  const EstateChainAuth = {
    // state
    currentSession,
    getToken,
    getUser,
    getRole,
    getWallet,
    isAuthenticated,
    clearSession,
    onChange,
    // flows
    signIn,
    register,
    refresh,
    logout,
    requireRole,
    // primitives
    requestNonce,
    lookupWallet,
    // lifecycle
    installWalletListeners,
    // constants
    VALID_ROLES,
  };

  global.EstateChainAuth = EstateChainAuth;

  // Install listeners eagerly so even legacy pages benefit from session invalidation.
  // Defer slightly so the rest of /shared loads first.
  setTimeout(installWalletListeners, 0);
})(window);
