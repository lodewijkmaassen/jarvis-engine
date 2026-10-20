/**
 * De AI Core-chat is een voordeur naar het bestaande doelsysteem (D-20261020-102732031):
 * een vraag geeft antwoord zonder doel, een opdracht wordt via doel_nieuw een gewoon doel,
 * en de sleutel blijft op de server.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — gewone .mjs zonder typen
import { verwerk } from "../../jarvis/interface/app/api/_chat-kern.mjs";

type Oproep = { url: string; init: RequestInit };
const cfg = { url: "https://x.supabase.co", key: "sb_publishable_test" };

function nep(modelUit: object) {
  const oproepen: Oproep[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    oproepen.push({ url, init });
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "u" }), { status: 200 });
    if (url.includes("api.anthropic.com")) return new Response(JSON.stringify(modelUit), { status: 200 });
    if (url.includes("/rest/v1/rpc/doel_nieuw")) return new Response(JSON.stringify("D-20261020-120000"), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  return { oproepen, fetchFn };
}
const vraag = { gesprek: [{ rol: "jij", tekst: "Hoe laat is het?" }] };

describe("chat-kern", () => {
  it("beantwoordt een vraag zonder een doel aan te maken", async () => {
    const { oproepen, fetchFn } = nep({ content: [{ type: "text", text: "Dat weet ik niet." }] });
    const r = await verwerk({ token: "t", body: vraag, cfg, sleutel: "k", fetchFn });
    expect(r.status).toBe(200);
    expect(r.lading.antwoord).toBe("Dat weet ik niet.");
    expect(r.lading.doel).toBeUndefined();
    expect(oproepen.some((o) => o.url.includes("doel_nieuw"))).toBe(false);
  });
  it("maakt van een opdracht een doel via doel_nieuw, met de sessie van de gebruiker en het projectlabel", async () => {
    const { oproepen, fetchFn } = nep({ content: [{ type: "tool_use", name: "maak_doel", input: { titel: "Login aanpassen", opdracht: "Pas de loginpagina aan", project: "tovas-flow" } }] });
    const r = await verwerk({ token: "gebruikerstoken", body: vraag, cfg, sleutel: "k", fetchFn });
    expect(r.lading.doel).toEqual({ id: "D-20261020-120000", titel: "Login aanpassen" });
    const rpc = oproepen.find((o) => o.url.includes("doel_nieuw"))!;
    expect((rpc.init.headers as Record<string, string>).authorization).toBe("Bearer gebruikerstoken");
    expect(JSON.parse(String(rpc.init.body))).toEqual({ p_titel: "Login aanpassen", p_opdracht: "Project: tovas-flow\n\nPas de loginpagina aan", p_acceptatie_url: null });
  });
  it("weigert zonder sessie, zonder sleutel en zonder bericht, en roept dan het model niet aan", async () => {
    const { oproepen, fetchFn } = nep({ content: [] });
    expect((await verwerk({ token: "", body: vraag, cfg, sleutel: "k", fetchFn })).status).toBe(401);
    expect((await verwerk({ token: "t", body: vraag, cfg, sleutel: "", fetchFn })).status).toBe(503);
    expect((await verwerk({ token: "t", body: { gesprek: [] }, cfg, sleutel: "k", fetchFn })).status).toBe(400);
    expect(oproepen.some((o) => o.url.includes("anthropic"))).toBe(false);
  });
  it("laat de sleutel niet in een antwoord lekken als het model faalt", async () => {
    const fetchFn = async (url: string) => (url.includes("anthropic") ? new Response("sk-geheim", { status: 500 }) : new Response("{}", { status: 200 }));
    const r = await verwerk({ token: "t", body: vraag, cfg, sleutel: "sk-geheim", fetchFn });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.lading)).not.toContain("sk-geheim");
  });
});

describe("chat in de uitrol", () => {
  it("bouw zet de functie en de publieke configuratie in api/, en de pagina bevat geen sleutel", () => {
    const doel = mkdtempSync(path.join(tmpdir(), "jarvis-chat-"));
    const r = spawnSync("node", [path.join(process.cwd(), "jarvis/interface/app/bouw.mjs"), doel, "--url", "https://x.supabase.co", "--sleutel", "sb_publishable_test"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    for (const f of ["chat.mjs", "_chat-kern.mjs", "chat-config.json"]) expect(existsSync(path.join(doel, "api", f))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(doel, "api", "chat-config.json"), "utf8"))).toEqual({ url: "https://x.supabase.co", key: "sb_publishable_test" });
    const html = readFileSync(path.join(process.cwd(), "jarvis/interface/v3.html"), "utf8");
    expect(html).not.toMatch(/ANTHROPIC|sk-ant|api\.anthropic/);
    expect(html).toContain('fetch("/api/chat"');
    expect(html).toContain("Nieuw doel"); // de fallback blijft
  });

  it("Vercel vindt de functie op /api/chat: api/chat.mjs in de projectwortel geeft de bestaande POST door", async () => {
    // Vercel draait alleen bestanden in api/ in de projectwortel als functie; public/api/ is statisch (404 na #98).
    // @ts-expect-error — gewone .mjs zonder typen
    const wortel = await import("../../api/chat.mjs");
    // @ts-expect-error — gewone .mjs zonder typen
    const bron = await import("../../jarvis/interface/app/api/chat.mjs");
    expect(wortel.POST).toBe(bron.POST);
  });

  it("zonder chat-config.json naast de functie komen de publieke identifiers uit de omgeving", async () => {
    // @ts-expect-error — gewone .mjs zonder typen
    const { leesCfg } = await import("../../jarvis/interface/app/api/chat.mjs");
    expect(leesCfg({ JARVIS_PUBLISHABLE_KEY: "sb_publishable_test" })).toEqual({ url: "https://mfjuaiezjtjdhahvwqzn.supabase.co", key: "sb_publishable_test" });
    expect(leesCfg({ JARVIS_PUBLISHABLE_KEY: "k", JARVIS_SUPABASE_URL: "https://y.supabase.co" })).toEqual({ url: "https://y.supabase.co", key: "k" });
    expect(leesCfg({})).toBeNull();
  });
  it("geeft een meegestuurde afbeelding door aan het model", async () => {
    const { oproepen, fetchFn } = nep({ content: [{ type: "text", text: "Ik zie een knop." }] });
    const body = { gesprek: [{ rol: "jij", tekst: "Wat zie je?", afbeelding: { media: "image/png", data: "iVBORw0KGgo=" } }] };
    const r = await verwerk({ token: "t", body, cfg, sleutel: "k", fetchFn });
    expect(r.status).toBe(200);
    const model = oproepen.find((o) => o.url.includes("anthropic"))!;
    expect(JSON.parse(String(model.init.body)).messages[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
      { type: "text", text: "Wat zie je?" },
    ]);
  });
  it("accepteert een bericht met alleen een afbeelding", async () => {
    const { fetchFn } = nep({ content: [{ type: "text", text: "Ok." }] });
    const body = { gesprek: [{ rol: "jij", tekst: "", afbeelding: { media: "image/jpeg", data: "AAAA" } }] };
    expect((await verwerk({ token: "t", body, cfg, sleutel: "k", fetchFn })).status).toBe(200);
  });
  it("weigert een afbeelding met een ongeldig type, ongeldige inhoud of te groot, zonder het model aan te roepen", async () => {
    const { oproepen, fetchFn } = nep({ content: [] });
    for (const afbeelding of [
      { media: "image/svg+xml", data: "AAAA" },
      { media: "image/png", data: "niet base64!" },
      { media: "image/png", data: "A".repeat(2_500_004) },
    ]) {
      const r = await verwerk({ token: "t", body: { gesprek: [{ rol: "jij", tekst: "x", afbeelding }] }, cfg, sleutel: "k", fetchFn });
      expect(r.status).toBe(400);
    }
    expect(oproepen.some((o) => o.url.includes("anthropic"))).toBe(false);
  });
});
