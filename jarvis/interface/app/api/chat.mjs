// Vercel Function voor de Jarvis AI Core-chat; de logica staat in _chat-kern.mjs.
// chat-config.json (publieke Supabase-identifiers) schrijft bouw.mjs naast dit bestand.
import { readFileSync } from "node:fs";
import { verwerk } from "./_chat-kern.mjs";

function leesCfg() {
  try {
    return JSON.parse(readFileSync(new URL("./chat-config.json", import.meta.url), "utf8"));
  } catch {
    return null;
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
