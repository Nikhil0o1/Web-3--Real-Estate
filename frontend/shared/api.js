/**
 * EstateChain API Client — Phase E consolidation
 * Centralized HTTP layer with standard headers, error handling, retry logic.
 */
(function (global) {
  'use strict';

  const DEFAULT_RETRY_STATUS = new Set([502, 503, 504]);
  const DEFAULT_RETRY_ATTEMPTS = 2;
  const DEFAULT_RETRY_DELAY_MS = 300;

  function getApiBaseUrl() {
    const runtimeBase =
      (global.__ESTATECHAIN_CONFIG__?.API_BASE_URL) ||
      document.querySelector('meta[name="api-base-url"]')?.content ||
      '';
    if (runtimeBase) return runtimeBase.replace(/\/$/, '');
    if (global.location?.origin && global.location.origin !== 'null') {
      return global.location.origin.replace(/\/$/, '');
    }
    return '';
  }

  const API_BASE = getApiBaseUrl();

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function _fetchWithRetry(url, options, attempt = 1, maxAttempts = DEFAULT_RETRY_ATTEMPTS) {
    const res = await fetch(url, options);
    if (!res.ok && attempt < maxAttempts && DEFAULT_RETRY_STATUS.has(res.status)) {
      await delay(DEFAULT_RETRY_DELAY_MS * attempt);
      return _fetchWithRetry(url, options, attempt + 1, maxAttempts);
    }
    return res;
  }

  function _attachAuthHeader(headers) {
    try {
      const auth = global.EstateChainAuth;
      if (!auth) return headers;
      const token = auth.getToken && auth.getToken();
      if (token && !headers.Authorization) {
        return { ...headers, Authorization: `Bearer ${token}` };
      }
    } catch (_) {
      // ignore
    }
    return headers;
  }

  function _handleAuthFailure(status, path) {
    if (status !== 401) return;
    try {
      const auth = global.EstateChainAuth;
      if (auth && typeof auth.clearSession === 'function') {
        auth.clearSession();
      }
      // Don't bounce off the landing page (avoids redirect loop for /auth/* calls)
      const onLanding = (global.location.pathname || '/') === '/';
      const isAuthPath = (path || '').startsWith('/auth/');
      if (!onLanding && !isAuthPath) {
        global.location.href = '/';
      }
    } catch (_) {
      // ignore
    }
  }

  async function apiRequest(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const fetchOptions = {
      headers: _attachAuthHeader({
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      }),
      ...options,
    };
    // Don't let spread above overwrite the headers we just composed
    fetchOptions.headers = _attachAuthHeader({
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    });

    // Remove body for GET/HEAD (fetch allows it but some proxies reject)
    if (fetchOptions.body && (!options.method || /^get$/i.test(options.method))) {
      delete fetchOptions.body;
    }

    const res = await _fetchWithRetry(url, fetchOptions);
    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    if (!res.ok) {
      let errText = res.statusText || `HTTP ${res.status}`;
      try {
        if (contentType.includes('application/json')) {
          const payload = await res.json();
          errText = payload.detail || payload.message || JSON.stringify(payload);
        } else {
          const txt = await res.text();
          errText = txt ? txt.slice(0, 200) : errText;
        }
      } catch (_e) {
        // ignore
      }
      _handleAuthFailure(res.status, path);
      const err = new Error(errText);
      err.status = res.status;
      err.path = path;
      throw err;
    }

    if (contentType.includes('application/json')) {
      return res.json();
    }

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      const preview = (text || '').slice(0, 300).replace(/\s+/g, ' ');
      throw new Error(`Expected JSON but received non-JSON response. Preview: ${preview}`);
    }
  }

  // Convenience wrappers
  async function apiGet(path, params = null) {
    let url = path;
    if (params && Object.keys(params).length) {
      const qs = new URLSearchParams(params).toString();
      url += (path.includes('?') ? '&' : '?') + qs;
    }
    return apiRequest(url, { method: 'GET' });
  }

  async function apiPost(path, body = null) {
    return apiRequest(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async function apiPut(path, body = null) {
    return apiRequest(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async function apiDelete(path) {
    return apiRequest(path, { method: 'DELETE' });
  }

  // Config caching layer (moved from utils.js for cleaner separation)
  async function getRuntimeConfigAsync() {
    if (global.__ESTATECHAIN_CONFIG__) {
      return global.__ESTATECHAIN_CONFIG__;
    }
    try {
      const cfg = await apiGet('/config');
      global.__ESTATECHAIN_CONFIG__ = cfg;
      return cfg;
    } catch (_e) {
      return global.__ESTATECHAIN_CONFIG__ || {};
    }
  }

  function getRuntimeConfig() {
    return global.__ESTATECHAIN_CONFIG__ || {};
  }

  // Health check helper
  async function healthCheck() {
    try {
      await apiGet('/health');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Expose API client
  const EstateChainAPI = {
    base: API_BASE,
    request: apiRequest,
    get: apiGet,
    post: apiPost,
    put: apiPut,
    delete: apiDelete,
    getRuntimeConfig,
    getRuntimeConfigAsync,
    healthCheck,
  };

  // Namespace guard
  if (global.EstateChainAPI) {
    console.warn('[api.js] EstateChainAPI already exists; re-exporting with merged defaults.');
  }
  global.EstateChainAPI = Object.assign({}, global.EstateChainAPI, EstateChainAPI);

  // Backwards compatibility: expose apiRequest on window (used by legacy utils.js)
  global.apiRequest = apiRequest;
  global.getRuntimeConfig = getRuntimeConfig;
  global.getRuntimeConfigAsync = getRuntimeConfigAsync;
})(window);
