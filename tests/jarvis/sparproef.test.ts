// De live sparproef (D-20261120-213559610): de eindcontrole meet een spardoel met echte gesprekken.
//
// Hier zonder netwerk: een nagebootste deur. Getoetst wordt wat deze code zelf belooft — gescheiden gesprekken,
// geheugen dat alleen via het proefgeheugen van gesprek naar gesprek gaat, de kostengrens, en een woordelijk
// bewijs. Het oordeel over het gedrag van het model velt de beoordelaar in de eindcontrole, niet deze test.

import { describe, expect, it } from "vitest";

import {
  BEURT_BOVENGRENS_USD,
  CONTROLE_ZONDER_WEB,
  acceptatieVragenUit,
  acceptatieVragenMetNummerUit,
  scenarioUitVragen,
  MAX_PROEF_USD,
  PRAKTIJK_GEHEUGEN_SQL,
  PRAKTIJK_VRAAG_SQL,
  bronnenRegel,
  exacteVraagUit,
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
    expect(p).toEqual({ vraag: "Echte vraag?", geheugen: echtGeheugen, herkomst: "de laatste echte sparvraag van de eigenaar", leesfout: null });
    expect(PRAKTIJK_VRAAG_SQL).toContain("not like 'sparproef-%'");
    const leeg = { unsafe: async () => [], end: async () => {} } as unknown as DbClient;
    expect(await leesPraktijk(leeg)).toBeNull();
  });

  it("stelt de exacte vraag uit de opdracht en zet een leesfout zichtbaar in het bewijs in plaats van hem weg te vangen", async () => {
    const opdracht = 'Stel in een echte sparsessie exact deze vraag:\n\n"Ik overweeg een nieuwe dienst naast Product X. Is dat verstandig?"\n\nJarvis moet ...';
    const vraag = exacteVraagUit(opdracht);
    expect(vraag).toBe("Ik overweeg een nieuwe dienst naast Product X. Is dat verstandig?");
    expect(exacteVraagUit("Geen voorgeschreven vraag.")).toBeNull();
    const geweigerd = {
      unsafe: async () => {
        throw new Error("permission denied for table berichten");
      },
      end: async () => {},
    } as unknown as DbClient;
    const p = await leesPraktijk(geweigerd, vraag);
    expect(p).toMatchObject({ vraag, geheugen: [], herkomst: "de exacte vraag uit de opdracht van het doel" });
    expect(p?.leesfout).toContain("permission denied for table berichten");
    const uitkomst = await voerSparproef(async () => ({ status: 200, lading: { antwoord: "Antwoord.", kosten_usd: 0.01, bronnen: { geheugen: [], doelen: [{ project: "product-x", ids: ["D-1"] }], gereedschap: [] } } }), [], () => new Date("2026-11-22T00:00:00Z"), p);
    const bewijs = sparproefBewijs(uitkomst, "https://geheim-host/api/chat", [], p);
    expect(bewijs).toContain(`[eigenaar] ${vraag}`);
    expect(bewijs).toContain("LEESFOUT: persoonlijk geheugen (jarvis.berichten) niet te lezen voor de eindcontrole: permission denied");
    expect(bewijs).toContain("doelen: product-x: D-1");
    expect(sparproefBewijs({ beurten: [], besteedUsd: 0, gestopt: null }, "https://x/api/chat", [], null)).toContain("praktijkherhaling) niet uitgevoerd");
  });
});

describe("vragen uit de opdracht (D-20261124-200610788): de proef stelt de acceptatievragen van het doel zelf", () => {
  const opdracht = [
    "# Opdracht", "", "## Doel", "1. Dit is geen vraag maar een stap.", "", "## Functionele acceptatietests", "",
    "Toon aan dat Jarvis antwoord geeft op vragen zoals:", "",
    "1. Wat wordt het weer morgen in Ede?", "2. Welke films draaien vandaag in de bioscoop in Ede?", "3) Welke aanbieders leveren vergelijkbare diensten?",
    "", "Test daarnaast iets anders.", "", "## Uitvoering", "4. Wat staat er na de kop?",
  ].join("\n");

  it("leest alleen de genummerde vragen onder de acceptatiekop", () => {
    expect(acceptatieVragenUit(opdracht)).toEqual([
      "Wat wordt het weer morgen in Ede?",
      "Welke films draaien vandaag in de bioscoop in Ede?",
      "Welke aanbieders leveren vergelijkbare diensten?",
    ]);
    expect(acceptatieVragenUit("Geen kop.\n1. Een vraag zonder acceptatiekop?")).toEqual([]);
  });

  it("zet een controlevraag zonder zoekbehoefte vooraan en elke vraag in een eigen gesprek", () => {
    const sc = scenarioUitVragen(["A?", "B?"]);
    expect(sc[0]).toBe(CONTROLE_ZONDER_WEB);
    expect(sc.map((g) => g.nummer)).toEqual([1, 2, 3]);
    expect(sc.slice(1).map((g) => g.beurten)).toEqual([["A?"], ["B?"]]);
  });

  it("stelt in de eindcontrole die vragen met het echte geheugen, en het bewijs toont zoekopdrachten en webbronnen", async () => {
    const echt = [{ id: "i-1", tekst: "Projectinformatie.", op: "2026-11-22T00:00:00Z", context: { kanaal: "brein", soort: "inzicht", inzicht_soort: "projectinfo" } }];
    const sql = {
      unsafe: async (q: string) => (q.includes("acceptatie_sleutel") ? [{ sleutel: "s" }] : q === PRAKTIJK_GEHEUGEN_SQL ? echt : q === PRAKTIJK_VRAAG_SQL ? [{ tekst: "Oude vraag?" }] : [{ waarde: "https://voorbeeld.test/api/chat" }]),
      end: async () => {},
    } as unknown as DbClient;
    const bodies: Record<string, unknown>[] = [];
    const uit = await voerSparproefUit(sql, (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      const zoekt = !String(JSON.stringify(body["gesprek"])).includes("Pythagoras");
      const web = zoekt
        ? { beschikbaar: true, zoekopdrachten: ["weer Ede morgen"], opgehaald: [], bronnen: [{ url: "https://www.knmi.nl/", titel: "KNMI", datum: "24 nov" }], kosten_zoeken_usd: 0.01 }
        : { beschikbaar: true, zoekopdrachten: [], opgehaald: [], bronnen: [], kosten_zoeken_usd: 0 };
      return new Response(JSON.stringify({ antwoord: "ok", kosten_usd: 0.05, nieuw_geheugen: [], bronnen: { geheugen: [], doelen: [], gereedschap: [], web } }), { status: 200 });
    }) as unknown as typeof fetch, opdracht);
    expect(bodies).toHaveLength(4);
    expect(bodies.map((b) => (b["gesprek"] as { tekst: string }[])[0]!.tekst)).toEqual([CONTROLE_ZONDER_WEB.beurten[0], "Wat wordt het weer morgen in Ede?", "Welke films draaien vandaag in de bioscoop in Ede?", "Welke aanbieders leveren vergelijkbare diensten?"]);
    expect(bodies[0]!["proefgeheugen"]).toEqual(echt);
    expect(uit.bewijs).not.toContain("Oude vraag?");
    expect(uit.bewijs).toContain("vragen uit de opdracht: 3");
    expect(uit.bewijs).toContain("web: 0 zoekopdrachten");
    expect(uit.bewijs).toContain("web: 1 zoekopdracht [weer Ede morgen]; bronnen: KNMI <https://www.knmi.nl/> (24 nov)");
    expect(uit.besteedUsd).toBeCloseTo(0.2, 6);
  });
});

describe("alleen de resterende vragen (D-20261124-200610788, reactie van de eigenaar 2026-11-25)", () => {
  const opdracht = [
    "## Functionele acceptatietests", "", "1. Wat wordt het weer morgen in Ede?", "2. Welke films draaien vandaag in de bioscoop in Ede?",
    "6. Welke informatie uit twee tegenstrijdige openbare bronnen is het meest betrouwbaar?",
  ].join("\n");
  const sql = {
    unsafe: async (q: string) => (q.includes("acceptatie_sleutel") ? [{ sleutel: "s" }] : q === PRAKTIJK_GEHEUGEN_SQL ? [] : q === PRAKTIJK_VRAAG_SQL ? [] : [{ waarde: "https://voorbeeld.test/api/chat" }]),
    end: async () => {},
  } as unknown as DbClient;

  it("leest het nummer van elke vraag mee", () => {
    expect(acceptatieVragenMetNummerUit(opdracht).map((v) => v.nummer)).toEqual(["1", "2", "6"]);
  });

  it("de controlevraag is een losse, tijdsonafhankelijke kennisvraag zonder besluit erin", () => {
    expect(CONTROLE_ZONDER_WEB.beurten[0]).toContain("Pythagoras");
    expect(CONTROLE_ZONDER_WEB.beurten[0]).not.toMatch(/besluit/i);
  });

  it("stelt alleen de gekozen vragen, na de controlevraag, en het bewijs zegt welke zijn overgeslagen", async () => {
    const vragen: string[] = [];
    const uit = await voerSparproefUit(sql, (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { gesprek: { tekst: string }[] };
      vragen.push(body.gesprek[0]!.tekst);
      return new Response(JSON.stringify({ antwoord: "ok", kosten_usd: 0.05, nieuw_geheugen: [] }), { status: 200 });
    }) as unknown as typeof fetch, opdracht, new Set(["6"]), "tests 1, 2 behouden");
    expect(vragen).toEqual([CONTROLE_ZONDER_WEB.beurten[0], "Welke informatie uit twee tegenstrijdige openbare bronnen is het meest betrouwbaar?"]);
    expect(uit.bewijs).toContain("vragen uit de opdracht: 1 (nummer 6 van 3; tests 1, 2 behouden)");
    expect(uit.bewijs).toContain("gesprek 2 (vraag 6 uit de opdracht)");
  });
});

