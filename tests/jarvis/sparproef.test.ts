// De live sparproef (D-20261120-213559610): de eindcontrole meet een spardoel met echte gesprekken.
//
// Hier zonder netwerk: een nagebootste deur. Getoetst wordt wat deze code zelf belooft — gescheiden gesprekken,
// geheugen dat alleen via het proefgeheugen van gesprek naar gesprek gaat, de kostengrens, en een woordelijk
// bewijs. Het oordeel over het gedrag van het model velt de beoordelaar in de eindcontrole, niet deze test.

import { describe, expect, it } from "vitest";

import {
  BEURT_BOVENGRENS_USD,
  MAX_PROEF_USD,
  PRAKTIJK_GEHEUGEN_SQL,
  PRAKTIJK_VRAAG_SQL,
  bronnenRegel,
  leesPraktijk,
  SPARPROEF,
  sparproefBewijs,
  vraagtSparproef,
  voerSparproef,
  voerSparproefUit,
} from "../../jarvis/src/sparproef";
import { MAX_ACCEPTATIE_RONDES } from "../../jarvis/src/doel-acceptatie";
import type { DbClient } from "../../jarvis/src/opdrachten";

type Body = Record<string, unknown>;

/** Een deur die elk verzoek bewaart, en bij een vraag over een besluit een inzicht teruggeeft. */
function nepDeur(kosten: number | null = 0.03) {
  const verzoeken: Body[] = [];
  let teller = 0;
  const vraag = async (body: Body) => {
    verzoeken.push(JSON.parse(JSON.stringify(body)) as Body);
    const verloop = body["gesprek"] as { rol: string; tekst: string }[];
    const laatste = verloop[verloop.length - 1]!.tekst;
    const nieuw = /besluit vast/.test(laatste)
      ? [{ id: `proef-${++teller}`, tekst: "Alleen zakelijke klanten in de bouw.", op: "2026-11-21T00:00:00Z", context: { kanaal: "brein", soort: "inzicht", inzicht_soort: "besluit" } }]
      : [];
    return {
      status: 200,
      lading: {
        antwoord: `antwoord op: ${laatste.slice(0, 30)}`,
        modus: "sparren",
        onthouden: nieuw.map((n) => ({ soort: "besluit", tekst: n.tekst })),
        ...(kosten === null ? {} : { kosten_usd: kosten }),
        geheugen_gebruikt: (body["proefgeheugen"] as unknown[]).length,
        alleen_lezen: true,
        nieuw_geheugen: nieuw,
      },
    };
  };
  return { vraag, verzoeken };
}

describe("wanneer de sparproef draait", () => {
  it("bij een doel dat om een sparringpartner vraagt, niet bij een gewoon doel", () => {
    expect(vraagtSparproef({ titel: "Jarvis Brain V1", opdracht: "…een intelligente, proactieve en kritische sparringpartner." })).toBe(true);
    expect(vraagtSparproef({ titel: "x", opdracht: "Kostenlimiet voor de nieuwe sparfunctionaliteit." })).toBe(true);
    expect(vraagtSparproef({ titel: "Knop toevoegen", opdracht: "Voeg een knop Exporteren toe." })).toBe(false);
    // "sparen" (geld) is geen sparren.
    expect(vraagtSparproef({ titel: "Spaardoel", opdracht: "Toon hoeveel ik deze maand kan sparen." })).toBe(false);
  });
});

describe("het scenario", () => {
  it("heeft minstens vijf gescheiden gesprekken, waaronder technisch, commercieel en strategisch, en één over meerdere beurten", () => {
    expect(SPARPROEF.length).toBeGreaterThanOrEqual(5);
    const onderwerpen = SPARPROEF.map((g) => g.onderwerp).join(" ");
    for (const o of ["technisch", "commercieel", "strategisch", "tegenstrijdig"]) expect(onderwerpen).toContain(o);
    expect(SPARPROEF.some((g) => g.beurten.length > 1)).toBe(true);
  });

  it("houdt drie acceptatieronden samen binnen de $3 die de eigenaar toestond", () => {
    expect(MAX_ACCEPTATIE_RONDES * MAX_PROEF_USD).toBeLessThanOrEqual(3);
  });
});

describe("de uitvoering", () => {
  it("stuurt elk gesprek in sparmodus, alleen lezen, met een eigen gesprek-id", async () => {
    const deur = nepDeur();
    await voerSparproef(deur.vraag);
    const ids = new Set(deur.verzoeken.map((v) => v["gesprek_id"]));
    expect(ids.size).toBe(SPARPROEF.length);
    for (const v of deur.verzoeken) {
      expect(v["modus"]).toBe("sparren");
      expect(v["alleen_lezen"]).toBe(true);
      expect(String(v["gesprek_id"])).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    }
  });

  it("geeft geheugen alleen via het proefgeheugen door: een volgend gesprek begint zonder het verloop van het vorige", async () => {
    const deur = nepDeur();
    await voerSparproef(deur.vraag);
    const eerste = deur.verzoeken[0]!;
    expect(eerste["proefgeheugen"]).toEqual([]);
    const tweede = deur.verzoeken[1]!;
    // Het verloop van gesprek 2 bevat alleen zijn eigen vraag.
    expect((tweede["gesprek"] as unknown[]).length).toBe(1);
    const geheugen = tweede["proefgeheugen"] as Body[];
    // Het besluit uit gesprek 1 en de beurt van gesprek 1.
    expect(geheugen.some((r) => (r["context"] as Body)["soort"] === "inzicht" && (r["context"] as Body)["inzicht_soort"] === "besluit")).toBe(true);
    expect(geheugen.some((r) => (r["context"] as Body)["soort"] === "beurt" && typeof (r["context"] as Body)["antwoord"] === "string")).toBe(true);
  });

  it("zet een gesprek over meerdere beurten voort met het eigen verloop, en zet die beurten niet dubbel in het geheugen", async () => {
    const deur = nepDeur();
    await voerSparproef(deur.vraag);
    const vijf = deur.verzoeken.filter((v) => String(v["gesprek_id"]).endsWith("-5"));
    expect(vijf.length).toBe(3);
    expect((vijf[2]!["gesprek"] as { rol: string }[]).map((b) => b.rol)).toEqual(["jij", "jarvis", "jij", "jarvis", "jij"]);
    const beurtenVanVijf = (vijf[2]!["proefgeheugen"] as Body[]).filter((r) => String((r["context"] as Body)["gesprek"] ?? "").endsWith("-5"));
    expect(beurtenVanVijf).toEqual([]);
  });

  it("stopt voordat de volgende beurt de grens kan overschrijden", async () => {
    const deur = nepDeur(0.5);
    const uit = await voerSparproef(deur.vraag);
    expect(uit.gestopt).toMatch(/gestopt vóór gesprek/);
    expect(uit.besteedUsd + BEURT_BOVENGRENS_USD).toBeGreaterThan(MAX_PROEF_USD);
    expect(uit.besteedUsd).toBeLessThanOrEqual(MAX_PROEF_USD);
  });

  it("telt een beurt zonder gemeten kosten voor de bovengrens", async () => {
    const deur = nepDeur(null);
    const uit = await voerSparproef(deur.vraag);
    expect(uit.beurten.length).toBe(Math.floor(MAX_PROEF_USD / BEURT_BOVENGRENS_USD));
    expect(uit.besteedUsd).toBeLessThanOrEqual(MAX_PROEF_USD);
  });
});

describe("het bewijs", () => {
  it("geeft het verloop woordelijk per gesprek, met wat het laat zien en of er een doel ontstond", async () => {
    const deur = nepDeur();
    const uit = await voerSparproef(deur.vraag);
    const bewijs = sparproefBewijs(uit, "https://voorbeeld.test/api/chat");
    for (const g of SPARPROEF) {
      expect(bewijs).toContain(`=== gesprek ${g.nummer} (${g.onderwerp})`);
      for (const b of g.beurten) expect(bewijs).toContain(`[eigenaar] ${b}`);
    }
    expect(bewijs).toContain("doel aangemaakt: nee");
    expect(bewijs).toContain("[onthouden door Jarvis] besluit: Alleen zakelijke klanten in de bouw.");
    expect(bewijs).toContain("live sparproef");
  });

  it("zegt het als de deur ontbreekt, zonder iets aan te roepen", async () => {
    const sql: DbClient = { unsafe: async () => [], end: async () => {} } as unknown as DbClient;
    let aangeroepen = false;
    const uit = await voerSparproefUit(sql, (async () => {
      aangeroepen = true;
      return new Response("{}");
    }) as unknown as typeof fetch);
    expect(aangeroepen).toBe(false);
    expect(uit.besteedUsd).toBe(0);
    expect(uit.bewijs).toMatch(/niet uitgevoerd/);
  });

  it("stuurt de sleutel alleen in de header naar het adres uit de instellingen", async () => {
    const sql = {
      unsafe: async (q: string) => (q.includes("acceptatie_sleutel") ? [{ sleutel: "geheim-sleutel" }] : [{ waarde: "https://voorbeeld.test/api/chat" }]),
      end: async () => {},
    } as unknown as DbClient;
    const gezien: { url: string; kop: string; body: string }[] = [];
    const uit = await voerSparproefUit(sql, (async (url: string, init: RequestInit) => {
      gezien.push({ url, kop: String((init.headers as Record<string, string>)["Authorization"]), body: String(init.body) });
      return new Response(JSON.stringify({ antwoord: "ok", kosten_usd: 0.01, nieuw_geheugen: [] }), { status: 200 });
    }) as unknown as typeof fetch);
    expect(gezien.length).toBe(SPARPROEF.reduce((n, g) => n + g.beurten.length, 0));
    expect(gezien.every((g) => g.url === "https://voorbeeld.test/api/chat" && g.kop === "Bearer geheim-sleutel")).toBe(true);
    expect(gezien.every((g) => !g.body.includes("geheim-sleutel"))).toBe(true);
    expect(uit.bewijs).not.toContain("geheim-sleutel");
  });
});

describe("praktijkherhaling (D-20261121-235241117): de echte vraag met het echte geheugen", () => {
  const echtGeheugen = [
    { id: "i-1", tekst: "Projectinformatie over het product.", op: "2026-11-22T00:00:00Z", context: { kanaal: "brein", soort: "inzicht", inzicht_soort: "projectinfo", project: "product-x", bron: { document: "project/PROJECT.md" } } },
  ];

  it("stelt de echte vraag eerst, met het echte geheugen, en laat dat geheugen niet doorlopen naar het fictieve scenario", async () => {
    const deur = nepDeur();
    await voerSparproef(deur.vraag, SPARPROEF, () => new Date(), { vraag: "Een echte vraag over product X?", geheugen: echtGeheugen });
    const eerste = deur.verzoeken[0]!;
    expect(String(eerste["gesprek_id"])).toMatch(/-praktijk$/);
    expect((eerste["gesprek"] as { tekst: string }[])[0]!.tekst).toBe("Een echte vraag over product X?");
    expect(eerste["proefgeheugen"]).toEqual(echtGeheugen);
    expect(deur.verzoeken[1]!["proefgeheugen"]).toEqual([]);
  });

  it("zet de bronnen in het bewijs en noemt geen volledig endpointadres", async () => {
    const vraag = async () => ({
      status: 200,
      lading: { antwoord: "Gebruikt de projectinformatie.", kosten_usd: 0.02, geheugen_gebruikt: 1, bronnen: { geheugen: [{ id: "i-1", categorie: "projectinformatie", bron: { document: "project/PROJECT.md" } }], doelen: [{ project: "product-x", ids: ["D-9"] }], gereedschap: [{ gereedschap: "raadpleeg_doelen", invoer: { zoek: "product x" } }] }, nieuw_geheugen: [] },
    });
    const uit = await voerSparproef(vraag, [], () => new Date(), { vraag: "Echte vraag?", geheugen: echtGeheugen });
    const bewijs = sparproefBewijs(uit, "https://geheim-host.voorbeeld.test/api/chat", []);
    expect(bewijs).toContain("=== gesprek 0 (praktijkherhaling)");
    expect(bewijs).toContain("[eigenaar] Echte vraag?");
    expect(bewijs).toContain("[geraadpleegde bronnen] geheugen: projectinformatie i-1 (bron: project/PROJECT.md) | doelen: product-x: D-9 | gereedschap: raadpleeg_doelen");
    expect(bewijs).not.toContain("geheim-host");
    expect(bronnenRegel(null)).toBeNull();
  });

  it("leest de vraag en het geheugen uit de database; zonder eerdere vraag geen praktijkherhaling", async () => {
    const sql = {
      unsafe: async (q: string) => (q === PRAKTIJK_VRAAG_SQL ? [{ tekst: "Echte vraag?" }] : q === PRAKTIJK_GEHEUGEN_SQL ? [...echtGeheugen, { id: "kapot", tekst: null, context: null }] : []),
      end: async () => {},
    } as unknown as DbClient;
    const p = await leesPraktijk(sql);
    expect(p).toEqual({ vraag: "Echte vraag?", geheugen: echtGeheugen });
    expect(PRAKTIJK_VRAAG_SQL).toContain("not like 'sparproef-%'");
    const leeg = { unsafe: async () => [], end: async () => {} } as unknown as DbClient;
    expect(await leesPraktijk(leeg)).toBeNull();
  });
});
