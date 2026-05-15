"use client";

import { RUNTIME_CONFIG } from "./runtime-config";

const TOKEN_KEY = "estatechain.session.v1";

export type SessionRecord = {
  token: string;
  user: {
    id?: number;
    wallet_address: string;
    role: string;
    email?: string | null;
    kyc_status?: string;
    active?: boolean;
  };
  expires_at?: string;
};

export class ApiError extends Error {
  status: number;
  payload: unknown;
  path: string;

  constructor(message: string, status: number, payload: unknown, path: string) {
    super(message);
    this.status = status;
    this.payload = payload;
    this.path = path;
  }
}

function readSession(): SessionRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionRecord;
    if (!parsed?.token || !parsed?.user) return null;
    if (parsed.expires_at) {
      const t = Date.parse(parsed.expires_at);
      if (Number.isFinite(t) && t < Date.now()) {
        window.localStorage.removeItem(TOKEN_KEY);
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session: SessionRecord | null) {
  if (typeof window === "undefined") return;
  if (!session?.token) {
    window.localStorage.removeItem(TOKEN_KEY);
  } else {
    window.localStorage.setItem(TOKEN_KEY, JSON.stringify(session));
  }
  window.dispatchEvent(new CustomEvent("estatechain:session-changed"));
}

export function getSession(): SessionRecord | null {
  return readSession();
}

export function getToken(): string | null {
  return readSession()?.token ?? null;
}

export function clearSession() {
  writeSession(null);
}

/**
 * HTTPS pages must not call `http://` APIs (mixed content). Render supports HTTPS;
 * normalize when the env var was pasted with `http://`.
 */
export function normalizeApiBaseUrl(base: string): string {
  let b = base.trim().replace(/\/$/, "");
  if (!b) return b;
  const isLocal = /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(b);
  if (!isLocal && typeof window !== "undefined" && window.location.protocol === "https:" && b.startsWith("http://")) {
    b = "https://" + b.slice("http://".length);
  }
  return b;
}

export function getApiBase(): string {
  if (RUNTIME_CONFIG.apiBaseUrl) return normalizeApiBaseUrl(RUNTIME_CONFIG.apiBaseUrl);
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  return "";
}

export type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  authOptional?: boolean;
};

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = getApiBase();
  if (!base) {
    throw new ApiError(
      "Backend URL is not configured. Set NEXT_PUBLIC_API_BASE_URL in your environment.",
      0,
      null,
      path,
    );
  }

  const url = new URL(base + path);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const init: RequestInit = {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  };

  const res = await fetch(url.toString(), init);
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const isJson = contentType.includes("application/json");
  const payload: unknown = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

  if (!res.ok) {
    if (res.status === 401 && !options.authOptional) {
      clearSession();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/")) {
        window.location.href = "/";
      }
    }
    const detail =
      (payload && typeof payload === "object" && "detail" in (payload as Record<string, unknown>)
        ? String((payload as Record<string, unknown>).detail)
        : null) || (typeof payload === "string" ? payload : null) || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(detail, res.status, payload, path);
  }

  return payload as T;
}

/** POST multipart (do not set Content-Type — browser sets boundary). */
export async function apiPostMultipart<T = unknown>(path: string, formData: FormData): Promise<T> {
  const base = getApiBase();
  if (!base) {
    throw new ApiError(
      "Backend URL is not configured. Set NEXT_PUBLIC_API_BASE_URL in your environment.",
      0,
      null,
      path,
    );
  }

  const url = new URL(base + path);
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(url.toString(), { method: "POST", headers, body: formData });
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const isJson = contentType.includes("application/json");
  const payload: unknown = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

  if (!res.ok) {
    if (res.status === 401) {
      clearSession();
    }
    const detail =
      (payload && typeof payload === "object" && "detail" in (payload as Record<string, unknown>)
        ? String((payload as Record<string, unknown>).detail)
        : null) || (typeof payload === "string" ? payload : null) || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(detail, res.status, payload, path);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"]) => apiRequest<T>(path, { method: "GET", query }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "POST", body }),
  postMultipart: <T>(path: string, formData: FormData) => apiPostMultipart<T>(path, formData),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PUT", body }),
  del: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};
