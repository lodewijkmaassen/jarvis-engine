// Edge Function `jarvis-db`: de eigen database van Jarvis over HTTPS.
//
// WAAROM
//
// De cloud-uitvoerder van Jarvis kan geen Postgres-verbinding maken (ruwe TCP
// is daar geblokkeerd; gemeten 2026-09-13) en een verbindingsreeks hoort
// niet in een omgeving waar elke opdracht hem kan lezen. Het platform kent
// wél "API credentials": een proxy voegt een header toe aan verzoeken naar
// een genoemde host, en het geheim komt de sessie nooit in. Deze functie is
// de host aan de andere kant van die header.
//
// WAT ZE DOET
//
// Eén statement per aanroep, en uitsluitend statements die letterlijk in
// toegestaan.json staan — dezelfde teksten die de engine in db.ts gebruikt.
// Alles anders is 400. De verbinding is de rol jarvis_werker (alleen het
// schema jarvis, RLS), uit het function-secret JARVIS_DB_URL; nooit de
// automatische SUPABASE_DB_URL (dat is postgres). Het API-token uit het
// function-secret JARVIS_API_TOKEN wordt in constante tijd vergeleken.
//
// Aanroep:  POST /functions/v1/jarvis-db
//           Authorization: Bearer <JARVIS_API_TOKEN>
//           {"sql": "<toegestaan statement>", "params": [...]}
// Antwoord: {"rows": [...]} of {"fout": "..."}

import postgres from "npm:postgres@3.4.5";
import toegestaan from "./toegestaan.json" with { type: "json" };

const TOEGESTAAN: ReadonlySet<string> = new Set(toegestaan as string[]);

function gelijkInConstanteTijd(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let verschil = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    verschil |= (x[i % Math.max(x.length, 1)] ?? 0) ^ (y[i % Math.max(y.length, 1)] ?? 0);
  }
  return verschil === 0;
}

function antwoord(status: number, lading: unknown): Response {
  return new Response(JSON.stringify(lading), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return antwoord(405, { fout: "alleen POST" });

  const token = Deno.env.get("JARVIS_API_TOKEN") ?? "";
  const url = Deno.env.get("JARVIS_DB_URL") ?? "";
  if (token.length < 16 || url.length === 0) {
    return antwoord(503, { fout: "functie niet ingericht: JARVIS_API_TOKEN en JARVIS_DB_URL ontbreken als secrets" });
  }
  const kop = req.headers.get("authorization") ?? "";
  const gegeven = kop.startsWith("Bearer ") ? kop.slice(7).trim() : "";
  if (!gegeven || !gelijkInConstanteTijd(gegeven, token)) return antwoord(401, { fout: "geen geldig token" });

  let body: { sql?: unknown; params?: unknown };
  try {
    body = await req.json();
  } catch {
    return antwoord(400, { fout: "geen JSON" });
  }
  const sql = typeof body.sql === "string" ? body.sql : "";
  const params = Array.isArray(body.params) ? body.params : [];
  if (!TOEGESTAAN.has(sql)) return antwoord(400, { fout: "statement niet toegestaan" });
  if (params.length > 8 || params.some((p) => p !== null && !["string", "number", "boolean"].includes(typeof p))) {
    return antwoord(400, { fout: "parameters: hoogstens acht, alleen tekst, getal, boolean of null" });
  }

  const verbinding = postgres(url, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 });
  try {
    const rows = await verbinding.unsafe(sql, params as (string | number | boolean | null)[]);
    return antwoord(200, { rows: Array.from(rows) });
  } catch (fout) {
    const tekst = fout instanceof Error ? fout.message : String(fout);
    // Nooit de verbindingsreeks in een antwoord.
    return antwoord(500, { fout: tekst.replace(/postgres(ql)?:\/\/\S+/gi, "<verbindingsreeks>").slice(0, 300) });
  } finally {
    await verbinding.end({ timeout: 2 });
  }
});
