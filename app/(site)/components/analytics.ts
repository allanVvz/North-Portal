"use client";

export type ConsentChoice = "accepted" | "rejected";
export type Attribution = Record<string, string>;
const CONSENT_KEY = "north-cookie-consent";
const ATTRIBUTION_KEY = "north-attribution";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid"];

declare global { interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void } }

export function getConsent(): ConsentChoice | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(CONSENT_KEY);
  return value === "accepted" || value === "rejected" ? value : null;
}

export function setConsent(value: ConsentChoice) {
  window.localStorage.setItem(CONSENT_KEY, value);
  window.dispatchEvent(new CustomEvent("north:consent-change", { detail: value }));
}

export function captureAttribution() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const incoming = Object.fromEntries(UTM_KEYS.map((key) => [key, params.get(key)]).filter((pair): pair is [string, string] => Boolean(pair[1])));
  if (!Object.keys(incoming).length) return;
  const current = getAttribution();
  window.sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify({ ...current, ...incoming }));
}

export function getAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.sessionStorage.getItem(ATTRIBUTION_KEY) || "{}"); } catch { return {}; }
}

export function track(event: string, params: Record<string, string | number | boolean> = {}) {
  if (getConsent() !== "accepted") return;
  window.gtag?.("event", event, params);
}

export function loadGa() {
  const id = process.env.NEXT_PUBLIC_GA4_ID;
  if (!id || getConsent() !== "accepted" || document.querySelector(`[data-north-ga="${id}"]`)) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = (...args: unknown[]) => window.dataLayer?.push(args);
  window.gtag("js", new Date());
  window.gtag("config", id, { anonymize_ip: true });
  const script = document.createElement("script");
  script.async = true; script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`; script.dataset.northGa = id;
  document.head.appendChild(script);
}
