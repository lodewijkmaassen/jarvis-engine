/**
 * Jarvis Brein V1 (D-20261120-213559610): een sparmodus naast de opdrachtmodus, met geheugen over gesprekken heen,
 * selectieve context en een hard maandplafond. Deterministisch getest met een nagebootst model en een nagebootste
 * berichtentabel; er gaat geen enkele echte aanroep uit.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — gewone .mjs zonder typen
import { SPAR_MODEL, SPAR_GRENZEN, MODEL, verwerk } from "../../jarvis/interface/app/api/_chat-kern.mjs";
// @ts-expect-error — gewone .mjs zonder typen
import { MAAND_LIMIET_USD, bovengrens, items, kostenVan, selecteer, termen } from "../../jarvis/interface/app/api/_brein.mjs";

type Rij = { id: string; van: string; tekst: string; op: string; status: string; context: Record<string, unknown> };
type Oproep = { url: string; method: string; body: unknown };
const cfg = { url: "https://x.supabase.co", key: "sb_publishable_test" };

/** Een nagebootste wereld: Supabase (auth, berichten, doel_nieuw, acceptatiesleutel) en een model met vaste antwoorden. */
function wereld(modelAntwoorden: object[], { rijen = [] as Rij[], ledgerFout = false } = {}) {
  const tabel: Rij[] = [...rijen];
  const oproepen: Oproep[] = [];
  const modelVerzoeken: Record<string, unknown>[] = [];
  let teller = 0;
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    oproepen.push({ url, method, body });
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "u" }), { status: 200 });
    if (url.includes("rpc/acceptatie_geldig")) return new Response("true", { status: 200 });
    if (url.includes("rpc/acceptatie_raadpleeg")) return new Response(JSON.stringify({ aantal: 0, doelen: [] }), { status: 200 });
    if (url.includes("rpc/doel_nieuw")) return new Response(JSON.stringify("D-1"), { status: 200 });
    if (url.includes("api.anthropic.com")) {
      modelVerzoeken.push(body);
      const uit = modelAntwoorden.shift() ?? { content: [{ type: "text", text: "klaar" }], usage: { input_tokens: 10, output_tokens: 10 } };
      return new Response(JSON.stringify(uit), { status: 200 });
    }
    if (url.includes("/rest/v1/berichten")) {
      const u = new URL(url);
      if (method === "POST") {
        teller += 1;
        const rij = { id: `r${teller}`, op: new Date(Date.UTC(2026, 10, 20, 12, teller)).toISOString(), ...body } as Rij;
        tabel.push(rij);
        return new Response(JSON.stringify([rij]), { status: 201 });
      }
      if (method === "PATCH") {
        const id = (u.searchParams.get("id") ?? "").replace(/^eq\./, "");
        const rij = tabel.find((r) => r.id === id);
        if (rij) Object.assign(rij, body);
        return new Response(null, { status: 204 });
      }
      const soort = (u.searchParams.get("context->>soort") ?? "").replace(/^eq\./, "");
      const id = (u.searchParams.get("id") ?? "").replace(/^eq\./, "");
      if (ledgerFout && u.searchParams.get("select") === "context") return new Response("{}", { status: 500 });
      const uit = tabel.filter((r) => r.context?.kanaal === "brein" && (!soort || r.context.soort === soort) && (!id || r.id === id));
      return new Response(JSON.stringify(uit), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  return { tabel, oproepen, modelVerzoeken, fetchFn };
}

const tekst = (t: string, usage = { input_tokens: 1000, output_tokens: 200 }) => ({ content: [{ type: "text", text: t }], usage });
const spar = (t: string, extra: object = {}) => ({ modus: "sparren", gesprek_id: "gesprek-0001", gesprek: [{ rol: "jij", tekst: t }], ...extra });
const schrijfOproepen = (o: Oproep[]) => o.filter((x) => x.url.includes("/rest/v1/berichten") && x.method !== "GET");

describe("sparmodus: geen uitvoertaak zonder de eigenaar", () => {
  it("biedt het model geen maak_doel aan en gebruikt het sparmodel", async () => {
    const w = wereld([tekst("Interessant.")]);
    const r = await verwerk({ token: "t", body: spar("Zullen we een eigen inlog bouwen?"), cfg, sleutel: "k", fetchFn: w.fetchFn });
    expect(r.status).toBe(200);
    const v = w.modelVerzoeken[0] as { model: string; tools: { name: string }[] };
    expect(v.model).toBe(SPAR_MODEL);
    expect(v.tools.map((t) => t.name)).toEqual(["raadpleeg_doelen", "raadpleeg_geheugen", "onthoud"]);
  });
  it("maakt geen doel aan, ook niet als het model toch maak_doel aanroept", async () => {
    const w = wereld([
      { content: [{ type: "tool_use", id: "a", name: "maak_doel", input: { titel: "Bouw het" } }], usage: { input_tokens: 10, output_tokens: 10 } },
      tekst("Ik maak hier geen taak van; gebruik de knop als je dat wilt."),
    ]);
    const r = await verwerk({ token: "t", body: spar("Bouw een AI-telefonist"), cfg, sleutel: "k", fetchFn: w.fetchFn });
    expect(r.lading.doel).toBeUndefined();
    expect(w.oproepen.some((o) => o.url.includes("doel_nieuw"))).toBe(false);
  });
  it("zonder modus blijft de chat de opdrachtmodus van vroeger (ander model, wel maak_doel, geen geheugen)", async () => {
    const w = wereld([{ content: [{ type: "tool_use", id: "a", name: "maak_doel", input: { titel: "Login" } }] }]);
    const r = await verwerk({ token: "t", body: { gesprek: [{ rol: "jij", tekst: "Pas de login aan" }] }, cfg, sleutel: "k", fetchFn: w.fetchFn });
    expect((w.modelVerzoeken[0] as { model: string }).model).toBe(MODEL);
    expect(r.lading.doel).toEqual({ id: "D-1", titel: "Login" });
    expect(w.oproepen.some((o) => o.url.includes("/rest/v1/berichten"))).toBe(false);
  });
});

describe("geheugen over gesprekken heen", () => {
  it("onthoudt een besluit met bron, en past het in een later, gescheiden gesprek toe zonder ernaar te vragen", async () => {
    const w = wereld([
      { content: [{ type: "tool_use", id: "o1", name: "onthoud", input: { soort: "besluit", tekst: "Kasboek gebruikt de bestaande Supabase Auth; geen eigen authenticatie.", project: "kasboek" } }], usage: { input_tokens: 10, output_tokens: 10 } },
      tekst("Onthouden: Kasboek gebruikt Supabase Auth."),
    ]);
    const r1 = await verwerk({ token: "t", body: spar("Besluit: voor Kasboek geen eigen authenticatie, we houden Supabase Auth."), cfg, sleutel: "k", fetchFn: w.fetchFn });
    expect(r1.lading.onthouden).toHaveLength(1);
    const inzicht = w.tabel.find((x) => x.context.soort === "inzicht")!;
    expect(inzicht.status).toBe("verwerkt"); // de berichtenwachtrij pakt alleen 'nieuw' op
    expect(inzicht.van).toBe("eigenaar");
    expect(inzicht.context.bron).toEqual({ gesprek: "gesprek-0001", beurt: expect.any(String) });

    // Tweede gesprek, ander id, over iets anders: het besluit gaat toch mee als gegevens bij het bericht.
    const w2 = wereld([tekst("Dat botst met je besluit.")], { rijen: w.tabel });
    await verwerk({ token: "t", body: { ...spar("Zullen we voor Kasboek toch zelf inloggen bouwen?"), gesprek_id: "gesprek-0002" }, cfg, sleutel: "k", fetchFn: w2.fetchFn });
    const v = w2.modelVerzoeken[0] as { system: { text: string }[]; messages: { role: string; content: { type: string; text: string }[] }[] };
    const laatste = v.messages[v.messages.length - 1];
    expect(laatste.role).toBe("user");
    const blok = laatste.content.find((c) => c.text.startsWith("[Geheugen van Jarvis"))!;
    expect(blok.text).toContain("Supabase Auth");
    // Nooit als systeeminstructie.
    expect(v.system.map((s) => s.text).join("\n")).not.toContain("Supabase Auth");
  });
  it("een correctie laat het oude inzicht vervallen; een gewist inzicht komt nooit meer terug", async () => {
    const oud: Rij = { id: "i1", van: "eigenaar", tekst: "Voorkeur: maandag is voor Kasboek.", op: "2026-11-01T00:00:00Z", status: "verwerkt", context: { kanaal: "brein", soort: "inzicht", inzicht_soort: "voorkeur" } };
    const gewist: Rij = { id: "i2", van: "eigenaar", tekst: "", op: "2026-11-02T00:00:00Z", status: "verwerkt", context: { kanaal: "brein", soort: "inzicht", inzicht_soort: "feit", gewist: true } };
    const w = wereld([
      { content: [{ type: "tool_use", id: "o", name: "onthoud", input: { soort: "voorkeur", tekst: "Maandag is voor ToVas Flow.", vervangt: "i1" } }], usage: { input_tokens: 1, output_tokens: 1 } },
      tekst("Onthouden."),
    ], { rijen: [oud, gewist] });
    await verwerk({ token: "t", body: spar("Nee, maandag wordt ToVas Flow."), cfg, sleutel: "k", fetchFn: w.fetchFn });
    expect(w.tabel.find((x) => x.id === "i1")!.context).toMatchObject({ vervallen: true, vervangen_door: expect.any(String) });
    const actief = items(w.tabel).filter((i: { soort: string }) => i.soort === "inzicht").map((i: { tekst: string }) => i.tekst);
    expect(actief).toEqual(["Maandag is voor ToVas Flow."]);
  });
  it("selecteert deterministisch en begrensd: besluiten altijd, de rest alleen bij overlap, het lopende gesprek niet dubbel", () => {
    const rij = (id: string, soort: string, tekst: string, extra: object = {}): Rij => ({ id, van: "eigenaar", tekst, op: `2026-11-1${id.length}T00:00:00Z`, status: "verwerkt", context: { kanaal: "brein", soort, ...extra } });
    const geheugen = items([
      rij("b", "inzicht", "We bouwen geen eigen authenticatie.", { inzicht_soort: "besluit" }),
      rij("f", "inzicht", "De offertemodule heeft 12 klanten.", { inzicht_soort: "feit" }),
      rij("g", "inzicht", "Iets over vakantieplanning.", { inzicht_soort: "feit" }),
      rij("t1", "beurt", "Wat vragen we voor de offertemodule?", { antwoord: "Een vast bedrag per maand." }),
      rij("t2", "beurt", "Prijs van de offertemodule nu?", { antwoord: "Nog open." }),
      ...Array.from({ length: 400 }, (_, i) => rij(`x${i}`, "beurt", `offertemodule prijs variant ${i} ${"lang ".repeat(200)}`, { antwoord: "x".repeat(800) })),
    ]);
    const a = selecteer(geheugen, "Prijs voor de offertemodule", { uitsluiten: ["Prijs van de offertemodule nu?"] });
    const b = selecteer(geheugen, "Prijs voor de offertemodule", { uitsluiten: ["Prijs van de offertemodule nu?"] });
    expect(a).toEqual(b);
    expect(a[0].id).toBe("b");
    expect(a.map((x: { id: string }) => x.id)).toContain("f");
    expect(a.map((x: { id: string }) => x.id)).not.toContain("g");
    expect(a.map((x: { id: string }) => x.id)).not.toContain("t2");
    expect(JSON.stringify(a).length).toBeLessThan(10000);
    expect(termen("De Offertemodule!")).toEqual(new Set(["offert"]));
  });
});

describe("kosten: hard maandplafond", () => {
  it("reserveert vóór de aanroep de bovengrens en legt daarna het gemeten bedrag vast", async () => {
    const w = wereld([tekst("Antwoord.", { input_tokens: 5000, output_tokens: 1000 })]);
    const r = await verwerk({ token: "t", body: spar("Wat vind je van dit plan?"), cfg, sleutel: "k", fetchFn: w.fetchFn });
    const eersteSchrijf = w.oproepen.findIndex((o) => o.url.includes("/rest/v1/berichten") && o.method === "POST");
    const eersteModel = w.oproepen.findIndex((o) => o.url.includes("api.anthropic.com"));
    expect(eersteSchrijf).toBeGreaterThanOrEqual(0);
    expect(eersteSchrijf).toBeLessThan(eersteModel);
    const beurt = w.tabel.find((x) => x.context.soort === "beurt")!;
    expect(beurt.context.kosten_usd).toBeCloseTo((5000 * 2 + 1000 * 10) / 1e6, 6);
    expect(beurt.context.antwoord).toBe("Antwoord.");
    expect(r.lading.kosten_usd).toBeCloseTo(0.02, 4);
  });
  it("doet geen betaalde aanroep als het maandbudget met deze beurt zou worden overschreden", async () => {
    const reservering = bovengrens(SPAR_MODEL, SPAR_GRENZEN);
    const vol: Rij = { id: "k", van: "eigenaar", tekst: "eerder", op: new Date().toISOString(), status: "verwerkt", context: { kanaal: "brein", soort: "beurt", antwoord: "x", kosten_usd: MAAND_LIMIET_USD - reservering + 0.01 } };
    const w = wereld([tekst("mag niet")], { rijen: [vol] });
    const r = await verwerk({ token: "t", body: spar("Nog een vraag"), cfg, sleutel: "k", fetchFn: w.fetchFn });
    expect(r.lading.limiet).toBe(true);
    expect(w.modelVerzoeken).toHaveLength(0);
    expect(schrijfOproepen(w.oproepen)).toHaveLength(0);
  });
  it("gaat dicht als het uitgegeven bedrag niet te lezen is", async () => {
    const w = wereld([tekst("mag niet")], { ledgerFout: true });
    const r = await verwerk({ token: "t", body: spar("Vraag"), cfg, sleutel: "k", fetchFn: w.fetchFn });
    expect(r.status).toBe(502);
    expect(w.modelVerzoeken).toHaveLength(0);
  });
  it("de bovengrens per beurt is klein ten opzichte van het maandbudget, en de rekensom klopt", () => {
    expect(bovengrens(SPAR_MODEL, SPAR_GRENZEN)).toBeLessThan(0.5);
    expect(kostenVan("claude-sonnet-5-5", { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6 })).toBeCloseTo(12.1, 6);
    expect(kostenVan("claude-haiku-5-5", { input_tokens: 1e6, output_tokens: 1e6 })).toBeCloseTo(0.6, 6);
  });
  it("cachet de vaste prompt en begrenst elke aanroep", async () => {
    const w = wereld([tekst("ok")]);
    await verwerk({ token: "t", body: spar("Vraag"), cfg, sleutel: "k", fetchFn: w.fetchFn });
    const v = w.modelVerzoeken[0] as { max_tokens: number; system: { cache_control?: object }[] };
    expect(v.max_tokens).toBe(SPAR_GRENZEN.maxUit);
    expect(v.system[0].cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("acceptatiedeur in de sparmodus", () => {
  it("schrijft niets in de database, geeft nieuwe inzichten terug en bouwt in een tweede gesprek voort op een meegegeven geheugen", async () => {
    const w = wereld([
      { content: [{ type: "tool_use", id: "o", name: "onthoud", input: { soort: "voorkeur", tekst: "De eigenaar werkt op vrijdag niet aan klantprojecten." } }], usage: { input_tokens: 1, output_tokens: 1 } },
      tekst("Onthouden."),
    ]);
    const r1 = await verwerk({ token: "acceptatiesleutel", body: { ...spar("Vrijdag werk ik niet aan klantprojecten."), alleen_lezen: true }, cfg, sleutel: "k", fetchFn: w.fetchFn });
    expect(r1.lading.alleen_lezen).toBe(true);
    expect(r1.lading.nieuw_geheugen).toHaveLength(1);
    expect(w.oproepen.some((o) => o.url.includes("/rest/v1/berichten"))).toBe(false);

    const w2 = wereld([tekst("Dan plannen we het donderdag.")]);
    await verwerk({ token: "acceptatiesleutel", body: { ...spar("Wanneer plannen we de klantdemo deze week?"), gesprek_id: "gesprek-0002", alleen_lezen: true, proefgeheugen: r1.lading.nieuw_geheugen }, cfg, sleutel: "k", fetchFn: w2.fetchFn });
    const v = w2.modelVerzoeken[0] as { messages: { content: { text: string }[] }[]; tools: { name: string }[] };
    expect(JSON.stringify(v.messages)).toContain("vrijdag niet aan klantprojecten");
    expect(v.tools.some((t) => t.name === "maak_doel")).toBe(false);
  });
});
