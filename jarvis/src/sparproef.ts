// De live sparproef: een doel dat om een sparringpartner vraagt, wordt gemeten met echte spargesprekken.
//
// WAAROM DIT BESTAAT
//
// Jarvis Brein V1 (D-20261120-213559610) zakte voor zijn eerste acceptatieronde met de reden "er is geen enkel
// vastgelegd gesprek dat laat zien dat Jarvis in echte spargesprekken context gebruikt, aannames ter discussie
// stelt, alternatieven aandraagt, eerdere besluiten toepast en gesprekken zonder uitvoertaak voortzet". Terecht:
// code en tests met een nagebootst model tonen het gereedschap, niet het gedrag. Gedrag van een model is alleen te
// meten door het model te vragen — en dat hoort de eindcontrole te doen, niet de bouwer: een gesprek dat de bouwer
// zelf aanlevert, is niet te onderscheiden van een verzonnen gesprek.
//
// HOE
//
// De eindcontrole voert een vast scenario uit tegen de acceptatiedeur van de AI Core (dezelfde deur en sleutel als
// een `aivraag`-test, met `modus: "sparren"`). De deur schrijft nooit in de database: het geheugen bestaat alleen
// in de aanvraag (`proefgeheugen`) en nieuwe inzichten komen terug in het antwoord (`nieuw_geheugen`). Deze proef
// geeft dat geheugen door aan het volgende, gescheiden gesprek — precies wat de database tussen twee echte
// gesprekken doet. Elk gesprek heeft een eigen gesprek-id; gesprek 5 loopt over meerdere beurten.
//
// Het scenario gaat over een fictief bedrijf: geen projectkennis in de engine. Het verloop wordt woordelijk als
// bewijs aan de beoordelaar gegeven; die oordeelt, deze code concludeert niets.
//
// PRAKTIJKHERHALING (D-20261121-235241117)
//
// Het vaste scenario toetst gedrag op een fictief bedrijf, met een geheugen dat de proef zelf opbouwt. Het toetst
// niet of Jarvis de echte kennis van de eigenaar gebruikt — en daar ging de eerste praktijktest mis ("ik weet niets
// over je projecten"). Daarom stelt de proef vóór het scenario de laatste echte sparvraag van de eigenaar opnieuw,
// met zijn echte geheugen (de inzichten in jarvis.berichten, alleen gelezen, als proefgeheugen meegegeven precies
// zoals de database ze aan een echt gesprek geeft). De vraag komt uit de database, niet uit deze code: zo blijft de
// engine vrij van projectkennis. Het bewijs toont welke bronnen Jarvis daarbij raadpleegde.
//
// KOSTEN
//
// De eigenaar keurde een acceptatieronde van hoogstens $3 goed. Eén proef is begrensd op MAX_PROEF_USD; vóór elke
// beurt wordt de bovengrens van die beurt (de reservering die de sparmodus zelf gebruikt) bij het al uitgegeven
// bedrag opgeteld, en past dat niet, dan stopt de proef. Een beurt zonder gemeten kosten telt voor de bovengrens.
// Met hoogstens drie acceptatieronden per doel (MAX_ACCEPTATIE_RONDES) blijft een doel zo binnen die $3.

import { ACCEPTATIE_SLEUTEL_SQL } from "./db";
import type { DbClient } from "./opdrachten";

/** Wanneer een doel met de sparproef wordt gemeten: als zijn opdracht om sparren vraagt. */
const SPAR_VRAAG = /\bspar(?:ringpartner|modus|gesprek(?:ken)?|ren|functionaliteit)\b/i;

export function vraagtSparproef(d: { readonly titel: string; readonly opdracht: string }): boolean {
  return SPAR_VRAAG.test(`${d.titel}\n${d.opdracht}`);
}

/** Bovengrens van één sparbeurt in dollars: SPAR_GRENZEN in de AI Core (3 rondes × (25.000 in × $2 + 4.000 uit × $10) / 1e6). */
export const BEURT_BOVENGRENS_USD = 0.27;
/** Hoeveel één sparproef hoogstens mag kosten. */
export const MAX_PROEF_USD = 1;
/** Hoeveel tekens van één antwoord in het bewijs gaan. */
const MAX_ANTWOORD_TEKENS = 1600;

export type SparGesprek = {
  readonly nummer: number;
  readonly onderwerp: string;
  /** Wat dit gesprek laat zien; staat in het bewijs, zodat de beoordelaar weet waarnaar te kijken. */
  readonly toetst: string;
  readonly beurten: readonly string[];
};

/** Vijf gescheiden gesprekken over een fictief installatiebedrijf: strategisch, commercieel, technisch, een tegenstrijdigheid en persoonlijk. */
export const SPARPROEF: readonly SparGesprek[] = [
  {
    nummer: 1,
    onderwerp: "strategisch",
    toetst: "besluiten vastleggen (onthoud), een aanname ter discussie stellen, een onderbouwd alternatief",
    beurten: [
      "Ik leg een besluit vast: vanaf 1 januari nemen we met ons installatiebedrijf alleen nog opdrachten aan van zakelijke klanten in de bouw; particuliere klanten nemen we niet meer aan. Verder is onze vaste regel dat klantgegevens uitsluitend binnen de EU worden opgeslagen. Wat is volgens jou het grootste risico van deze focus?",
    ],
  },
  {
    nummer: 2,
    onderwerp: "commercieel",
    toetst: "een aanname ter discussie stellen, een alternatief, verband met het besluit uit gesprek 1 zonder ernaar te vragen",
    beurten: ["Om snel te groeien wil ik nieuwe klanten 30% korting geven op hun eerste opdracht. Goed plan?"],
  },
  {
    nummer: 3,
    onderwerp: "technisch",
    toetst: "het besluit over opslag in de EU uit gesprek 1 toepassen zonder er opnieuw naar te vragen",
    beurten: [
      "Voor de nieuwe planningsmodule twijfel ik tussen een Amerikaanse SaaS-dienst die alle gegevens in de Verenigde Staten bewaart en zelf bouwen op onze huidige stack. Wat raad je aan?",
    ],
  },
  {
    nummer: 4,
    onderwerp: "tegenstrijdig besluit",
    toetst: "de strijdigheid met het besluit uit gesprek 1 herkennen en bespreekbaar maken",
    beurten: ["Een particulier biedt ons een grote verbouwing van € 80.000 aan. Die nemen we gewoon aan, toch?"],
  },
  {
    nummer: 5,
    onderwerp: "persoonlijk, over meerdere beurten",
    toetst: "een gesprek voortzetten zonder ongevraagd een uitvoertaak te starten, ook niet als de eigenaar om bouwen vraagt",
    beurten: [
      "Ik werk de laatste maanden bijna elke avond door. Denk eens met me mee: hoe krijg ik dat omlaag?",
      "Interessant. Ik wil hier nog even over doorpraten en nog niets regelen: wat als ik standaard de vrijdagmiddag vrij neem?",
      "Bouw dan meteen een functie in de planning die mijn vrijdagmiddag blokkeert.",
    ],
  },
];

/** Wat de deur op één beurt teruggaf, voor zover het voor het bewijs telt. */
export type SparBeurt = {
  readonly gesprek: number;
  readonly vraag: string;
  readonly http: number;
  readonly antwoord: string;
  readonly onthouden: readonly { readonly soort: string; readonly tekst: string }[];
  readonly geheugenGebruikt: number | null;
  readonly geheugenMeegegeven: number;
  readonly doelAangemaakt: boolean;
  readonly kostenUsd: number | null;
  /** Wat de deur als geraadpleegde bronnen teruggaf (geheugenitems, doelen, gereedschap); null als er niets kwam. */
  readonly bronnen?: Lading | null;
};

/** De praktijkherhaling: een echte eerdere vraag van de eigenaar en zijn echte geheugen. */
export type Praktijk = { readonly vraag: string; readonly geheugen: readonly Lading[] };

/** Het nummer van de praktijkherhaling in het bewijs; het vaste scenario begint bij 1. */
export const PRAKTIJK_NUMMER = 0;

type Lading = Record<string, unknown>;

/** Een geheugenrij zoals de database haar zou teruggeven: een eerdere beurt van een ander gesprek. */
export function beurtRij(gesprekId: string, index: number, vraag: string, antwoord: string, op: string): Lading {
  return { id: `proef-beurt-${gesprekId}-${index}`, tekst: vraag, op, context: { kanaal: "brein", soort: "beurt", gesprek: gesprekId, antwoord } };
}

const kort = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n)}… [afgekapt]` : t);

/**
 * Voert het scenario uit. `vraag` is één POST naar de deur; de rest is puur, zodat de doorgifte van het geheugen
 * en de kostengrens zonder netwerk te toetsen zijn.
 */
export async function voerSparproef(
  vraag: (body: Lading) => Promise<{ readonly status: number; readonly lading: Lading }>,
  scenario: readonly SparGesprek[] = SPARPROEF,
  nu: () => Date = () => new Date(),
  praktijk: Praktijk | null = null,
): Promise<{ readonly beurten: readonly SparBeurt[]; readonly besteedUsd: number; readonly gestopt: string | null }> {
  const beurten: SparBeurt[] = [];
  // Het geheugen tussen gesprekken: inzichten die de deur teruggaf en de beurten van eerdere gesprekken.
  const geheugen: Lading[] = [];
  let besteed = 0;
  const stempel = nu().getTime();
  // Eerst de praktijkherhaling, met het echte geheugen. Dat geheugen loopt niet door naar het fictieve scenario.
  if (praktijk) {
    const gesprekId = `sparproef-${stempel}-praktijk`;
    let status = 0;
    let lading: Lading = {};
    try {
      ({ status, lading } = await vraag({ gesprek: [{ rol: "jij", tekst: praktijk.vraag }], modus: "sparren", gesprek_id: gesprekId, alleen_lezen: true, proefgeheugen: [...praktijk.geheugen] }));
    } catch (fout) {
      lading = { fout: fout instanceof Error ? fout.message : String(fout) };
    }
    const kosten = typeof lading["kosten_usd"] === "number" && Number.isFinite(lading["kosten_usd"]) ? (lading["kosten_usd"] as number) : null;
    besteed += kosten ?? (status === 200 ? BEURT_BOVENGRENS_USD : 0);
    beurten.push(beurtUit(PRAKTIJK_NUMMER, praktijk.vraag, status, lading, praktijk.geheugen.length, kosten));
  }
  for (const g of scenario) {
    const gesprekId = `sparproef-${stempel}-${g.nummer}`;
    const verloop: { rol: string; tekst: string }[] = [];
    const vanDitGesprek: Lading[] = [];
    for (const [i, vraagTekst] of g.beurten.entries()) {
      if (besteed + BEURT_BOVENGRENS_USD > MAX_PROEF_USD) {
        return { beurten, besteedUsd: besteed, gestopt: `gestopt vóór gesprek ${g.nummer}, beurt ${i + 1}: de volgende beurt kan de grens van $${MAX_PROEF_USD} overschrijden (besteed: $${besteed.toFixed(4)})` };
      }
      verloop.push({ rol: "jij", tekst: vraagTekst });
      let status = 0;
      let lading: Lading = {};
      try {
        ({ status, lading } = await vraag({ gesprek: verloop, modus: "sparren", gesprek_id: gesprekId, alleen_lezen: true, proefgeheugen: geheugen }));
      } catch (fout) {
        lading = { fout: fout instanceof Error ? fout.message : String(fout) };
      }
      const antwoord = typeof lading["antwoord"] === "string" ? (lading["antwoord"] as string) : `(geen antwoord: ${String(lading["fout"] ?? "onbekend")})`;
      const kosten = typeof lading["kosten_usd"] === "number" && Number.isFinite(lading["kosten_usd"]) ? (lading["kosten_usd"] as number) : null;
      besteed += kosten ?? (status === 200 ? BEURT_BOVENGRENS_USD : 0);
      const nieuw = Array.isArray(lading["nieuw_geheugen"]) ? (lading["nieuw_geheugen"] as Lading[]) : [];
      beurten.push(beurtUit(g.nummer, vraagTekst, status, lading, geheugen.length, kosten));
      verloop.push({ rol: "jarvis", tekst: antwoord });
      // Nieuwe inzichten gelden meteen; de beurten van dit gesprek pas in een volgend gesprek (in dit gesprek
      // staan ze al in het verloop).
      geheugen.push(...nieuw.filter((r) => r && typeof r === "object"));
      vanDitGesprek.push(beurtRij(gesprekId, i + 1, vraagTekst, antwoord, nu().toISOString()));
    }
    geheugen.push(...vanDitGesprek);
  }
  return { beurten, besteedUsd: besteed, gestopt: null };
}

/** Eén beurt voor het bewijs, uit wat de deur teruggaf. */
function beurtUit(gesprek: number, vraag: string, http: number, lading: Lading, meegegeven: number, kosten: number | null): SparBeurt {
  const onthouden = Array.isArray(lading["onthouden"]) ? (lading["onthouden"] as Lading[]) : [];
  const bronnen = lading["bronnen"] && typeof lading["bronnen"] === "object" ? (lading["bronnen"] as Lading) : null;
  return {
    gesprek,
    vraag,
    http,
    antwoord: typeof lading["antwoord"] === "string" ? (lading["antwoord"] as string) : `(geen antwoord: ${String(lading["fout"] ?? "onbekend")})`,
    onthouden: onthouden.map((o) => ({ soort: String(o["soort"] ?? ""), tekst: String(o["tekst"] ?? "") })),
    geheugenGebruikt: typeof lading["geheugen_gebruikt"] === "number" ? (lading["geheugen_gebruikt"] as number) : null,
    geheugenMeegegeven: meegegeven,
    doelAangemaakt: lading["doel"] !== undefined && lading["doel"] !== null,
    kostenUsd: kosten,
    bronnen,
  };
}

/** De bronnen van een beurt in één regel: per geheugenitem id en categorie, de doelen per project, het gereedschap. */
export function bronnenRegel(b: Lading | null | undefined): string | null {
  if (!b) return null;
  const lijst = (x: unknown): Lading[] => (Array.isArray(x) ? (x as Lading[]) : []);
  const delen: string[] = [];
  const g = lijst(b["geheugen"]).map((x) => {
    const bron = x["bron"] && typeof x["bron"] === "object" ? (x["bron"] as Lading) : null;
    const doc = bron && typeof bron["document"] === "string" ? ` (bron: ${bron["document"] as string})` : "";
    return `${String(x["categorie"] ?? "geheugen")} ${String(x["id"] ?? "?")}${doc}`;
  });
  if (g.length) delen.push(`geheugen: ${g.join("; ")}`);
  const d = lijst(b["doelen"]).map((x) => `${String(x["project"] ?? "?")}: ${lijst(x["ids"]).map(String).join(", ") || "geen"}`);
  if (d.length) delen.push(`doelen: ${d.join("; ")}`);
  const t = lijst(b["gereedschap"]).map((x) => `${String(x["gereedschap"] ?? "?")}(${JSON.stringify(x["invoer"] ?? {})})`);
  if (t.length) delen.push(`gereedschap: ${t.join("; ")}`);
  return delen.length ? delen.join(" | ") : "geen";
}

/** Het adres zonder host: het bewijs noemt geen volledig endpointadres (eis van de eigenaar). */
const zonderHost = (url: string): string => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "(adres)";
  }
};

/** Het verloop als bewijs voor de beoordelaar: woordelijk, per gesprek, zonder conclusie. */
export function sparproefBewijs(
  uitkomst: { readonly beurten: readonly SparBeurt[]; readonly besteedUsd: number; readonly gestopt: string | null },
  url: string,
  scenario: readonly SparGesprek[] = SPARPROEF,
): string {
  const regels: string[] = [
    `live sparproef (zojuist door de eindcontrole uitgevoerd tegen productie: POST <AI Core>${zonderHost(url)}, modus "sparren", alleen_lezen; ` +
      `${scenario.length} gescheiden gesprekken, elk met een eigen gesprek-id). Tussen de gesprekken bestaat geen gedeeld verloop: ` +
      `wat Jarvis uit een eerder gesprek weet, komt uitsluitend uit het geheugen (de inzichten die hij zelf vastlegde en de eerdere beurten), ` +
      `dat de proef doorgeeft zoals de database dat tussen twee echte gesprekken doet. In deze modus bestaat het gereedschap om een doel te maken niet.`,
    `kosten van deze proef: $${uitkomst.besteedUsd.toFixed(4)} (grens $${MAX_PROEF_USD})${uitkomst.gestopt ? `; ${uitkomst.gestopt}` : ""}`,
  ];
  const praktijk = uitkomst.beurten.filter((b) => b.gesprek === PRAKTIJK_NUMMER);
  if (praktijk.length) {
    regels.push(
      "",
      `=== gesprek ${PRAKTIJK_NUMMER} (praktijkherhaling) — de laatste echte sparvraag van de eigenaar opnieuw gesteld, met zijn echte geheugen ` +
        `(inzichten uit de database, alleen gelezen); laat zien: of Jarvis de bestaande kennis over projecten, doelstellingen en besluiten gebruikt zonder dat die in de vraag staat ===`,
    );
  }
  for (const b of praktijk) beurtRegels(regels, b);
  for (const g of scenario) {
    const eigen = uitkomst.beurten.filter((b) => b.gesprek === g.nummer);
    regels.push("", `=== gesprek ${g.nummer} (${g.onderwerp}) — laat zien: ${g.toetst} ===`);
    if (eigen.length === 0) regels.push("(niet uitgevoerd)");
    for (const b of eigen) beurtRegels(regels, b);
  }
  return regels.join("\n");
}

function beurtRegels(regels: string[], b: SparBeurt): void {
  regels.push(
    `[eigenaar] ${b.vraag}`,
    `[jarvis] (HTTP ${b.http}; geheugenitems meegegeven: ${b.geheugenMeegegeven}; door Jarvis gebruikt: ${b.geheugenGebruikt ?? "-"}; doel aangemaakt: ${b.doelAangemaakt ? "JA" : "nee"}; kosten $${b.kostenUsd ?? "?"})`,
    kort(b.antwoord, MAX_ANTWOORD_TEKENS),
  );
  const bronnen = bronnenRegel(b.bronnen);
  if (bronnen) regels.push(`[geraadpleegde bronnen] ${bronnen}`);
  if (b.onthouden.length > 0) regels.push(`[onthouden door Jarvis] ${b.onthouden.map((o) => `${o.soort}: ${o.tekst}`).join(" | ")}`);
}

const INSTELLING_SQL = "select waarde from jarvis.instellingen where sleutel = $1";

/** De laatste echte sparvraag van de eigenaar: geen beurt van een eerdere proef, niet leeg. */
export const PRAKTIJK_VRAAG_SQL =
  "select tekst from jarvis.berichten where context->>'kanaal' = 'brein' and context->>'soort' = 'beurt' " +
  "and coalesce(context->>'gesprek', '') not like 'sparproef-%' and length(trim(tekst)) > 0 order by op desc limit 1";
/** Het echte geheugen zoals de sparmodus het leest: de inzichten, nieuwste eerst, hoogstens 200 (alleen lezen). */
export const PRAKTIJK_GEHEUGEN_SQL =
  "select id::text as id, tekst, op::text as op, context from jarvis.berichten where context->>'kanaal' = 'brein' " +
  "and context->>'soort' = 'inzicht' order by op desc limit 200";

/** Leest de praktijkherhaling; ontbreekt de vraag of mislukt het lezen, dan geen praktijkherhaling. */
export async function leesPraktijk(sql: DbClient): Promise<Praktijk | null> {
  const vraagRij = await sql.unsafe(PRAKTIJK_VRAAG_SQL).catch(() => [] as Record<string, unknown>[]);
  const vraag = vraagRij[0]?.["tekst"];
  if (typeof vraag !== "string" || !vraag.trim()) return null;
  const rijen = await sql.unsafe(PRAKTIJK_GEHEUGEN_SQL).catch(() => [] as Record<string, unknown>[]);
  const geheugen = rijen.filter((r) => r["context"] && typeof r["context"] === "object" && typeof r["tekst"] === "string");
  return { vraag: vraag.slice(0, 4000), geheugen };
}

/**
 * De I/O: sleutel en adres van de acceptatiedeur uit de database, dan het scenario. Ontbreekt de deur, dan zegt
 * het bewijs dat — de beoordelaar ziet dan geen gesprek en oordeelt daarnaar.
 */
export async function voerSparproefUit(sql: DbClient, fetchFn: typeof fetch = fetch): Promise<{ readonly bewijs: string; readonly besteedUsd: number }> {
  const sleutelRij = await sql.unsafe(ACCEPTATIE_SLEUTEL_SQL).catch(() => [] as Record<string, unknown>[]);
  const sleutel = String(sleutelRij[0]?.["sleutel"] ?? "").trim();
  const urlRij = await sql.unsafe(INSTELLING_SQL, ["ai_core_url"]).catch(() => [] as Record<string, unknown>[]);
  const url = String(urlRij[0]?.["waarde"] ?? "").trim();
  if (!sleutel || !url) {
    return { bewijs: "live sparproef niet uitgevoerd: de acceptatiedeur ontbreekt (instelling ai_core_url of de acceptatiesleutel).", besteedUsd: 0 };
  }
  const praktijk = await leesPraktijk(sql);
  const uitkomst = await voerSparproef(async (body) => {
    const a = await fetchFn(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${sleutel}`, "Content-Type": "application/json", "User-Agent": "jarvis-acceptatie" },
      body: JSON.stringify(body),
    });
    const lading = (await a.json().catch(() => ({}))) as Lading;
    return { status: a.status, lading };
  }, SPARPROEF, () => new Date(), praktijk);
  return { bewijs: sparproefBewijs(uitkomst, url), besteedUsd: uitkomst.besteedUsd };
}
