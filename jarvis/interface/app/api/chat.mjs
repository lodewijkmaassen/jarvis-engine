// Vercel Function voor de Jarvis AI Core-chat; de logica staat in _chat-kern.mjs. Bereikbaar op /api/chat
// via api/chat.mjs in de projectwortel.
// chat-config.json (publieke Supabase-identifiers) schrijft bouw.mjs naast een kopie van dit bestand. Draait de
// functie vanuit de bron (zo bundelt Vercel api/chat.mjs), dan staan dezelfde publieke identifiers in de
// omgeving van het project: JARVIS_PUBLISHABLE_KEY, en de URL van de eigen database van Jarvis.
import { readFileSync } from "node:fs";
import { verwerk } from "./_chat-kern.mjs";

const JARVIS_URL = "https://mfjuaiezjtjdhahvwqzn.supabase.co";

export function leesCfg(env = process.env) {
  try {
    return JSON.parse(readFileSync(new URL("./chat-config.json", import.meta.url), "utf8"));
  } catch {
    const key = (env.JARVIS_PUBLISHABLE_KEY ?? "").trim();
    return key ? { url: (env.JARVIS_SUPABASE_URL ?? "").trim() || JARVIS_URL, key } : null;
  }
}

export async function POST(request) {
  const kop = request.headers.get("authorization") ?? "";
  const token = kop.startsWith("Bearer ") ? kop.slice(7).trim() : "";
  let body = null;
  try { body = await request.json(); } catch { /* leeg: verwerk geeft 400 */ }
  const { status, lading } = await verwerk({ token, body, cfg: leesCfg(), sleutel: process.env.ANTHROPIC_API_KEY ?? "" });
  return new Response(JSON.stringify(lading), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
