/**
 * Gmail fetch of the e-dekont, entirely in the browser: Google Identity Services issues a short-lived
 * read-only access token to this page, the page queries the Gmail API for Ziraat's e-dekont messages sent
 * after the reservation and downloads the raw RFC 822 message (the same bytes as "Download original").
 * The token stays in memory; only the one e-mail the buyer picks goes to the prover.
 *
 * Needs an OAuth client id (NEXT_PUBLIC_GOOGLE_CLIENT_ID) — see docs/GMAIL-OAUTH.md.
 */
import { config } from "./config";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GIS_SRC = "https://accounts.google.com/gsi/client";

type TokenClient = { requestAccessToken(opts?: { prompt?: string }): void };
type GoogleAccounts = {
  accounts: {
    oauth2: {
      initTokenClient(cfg: { client_id: string; scope: string; callback: (r: { access_token?: string; error?: string; error_description?: string; expires_in?: number }) => void; error_callback?: (e: { type?: string; message?: string }) => void }): TokenClient;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

export const gmailConfigured = () => !!config.googleClientId;

let cached: { token: string; until: number } | null = null;

function loadGis(): Promise<GoogleAccounts> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve(window.google);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const onload = () => (window.google ? resolve(window.google) : reject(new Error("Google Identity Services did not load")));
    if (existing) {
      existing.addEventListener("load", onload);
      existing.addEventListener("error", () => reject(new Error("could not load Google Identity Services")));
      return;
    }
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = onload;
    s.onerror = () => reject(new Error("could not load Google Identity Services (blocked?)"));
    document.head.appendChild(s);
  });
}

/** A read-only Gmail access token for this page (popup consent the first time; cached until it expires). */
export async function getGmailToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 30_000) return cached.token;
  if (!config.googleClientId) throw new Error("Gmail fetch is not configured (NEXT_PUBLIC_GOOGLE_CLIENT_ID)");
  const google = await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error_description ?? r.error ?? "Google did not return a token"));
        cached = { token: r.access_token, until: Date.now() + (r.expires_in ?? 3600) * 1000 };
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error(e.type === "popup_closed" ? "Google sign-in was closed before finishing" : (e.message ?? "Google sign-in failed"))),
    });
    client.requestAccessToken({ prompt: cached ? "" : "consent" });
  });
}

async function gmailGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    if (res.status === 401) cached = null;
    const body = await res.text();
    throw new Error(`Gmail API ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export type DekontMail = { id: string; internalDate: number; subject: string; snippet: string };

/** Ziraat e-dekont messages received after `sinceUnix` (seconds), newest first. */
export async function findDekontMails(token: string, sinceUnix: number, max = 5): Promise<DekontMail[]> {
  // Gmail's `after:` takes epoch seconds; allow 10 minutes of clock skew before the reservation
  const q = `from:ileti.ziraatbank.com.tr subject:e-dekont has:attachment after:${Math.max(0, sinceUnix - 600)}`;
  const list = await gmailGet<{ messages?: { id: string }[] }>(token, `/messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
  const ids = list.messages ?? [];
  const metas = await Promise.all(
    ids.map((m) => gmailGet<{ id: string; internalDate: string; snippet?: string; payload?: { headers?: { name: string; value: string }[] } }>(token, `/messages/${m.id}?format=metadata&metadataHeaders=Subject`)),
  );
  return metas
    .map((m) => ({
      id: m.id,
      internalDate: Math.floor(Number(m.internalDate) / 1000),
      subject: m.payload?.headers?.find((h) => h.name.toLowerCase() === "subject")?.value ?? "",
      snippet: m.snippet ?? "",
    }))
    .sort((a, b) => b.internalDate - a.internalDate);
}

/** The raw RFC 822 message as standard base64 (what the prover's `eml_base64` expects). */
export async function fetchRawEmlBase64(token: string, id: string): Promise<string> {
  const m = await gmailGet<{ raw?: string }>(token, `/messages/${id}?format=raw`);
  if (!m.raw) throw new Error("Gmail returned no raw message");
  const b64 = m.raw.replace(/-/g, "+").replace(/_/g, "/");
  return b64 + "=".repeat((4 - (b64.length % 4)) % 4);
}

export function forgetGmailToken() {
  cached = null;
}
