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
};

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
): Promise<{ readonly beurten: readonly SparBeurt[]; readonly besteedUsd: number; readonly gestopt: string | null }> {
  const beurten: SparBeurt[] = [];
  // Het geheugen tussen gesprekken: inzichten die de deur teruggaf en de beurten van eerdere gesprekken.
  const geheugen: Lading[] = [];
  let besteed = 0;
  const stempel = nu().getTime();
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
      const onthouden = Array.isArray(lading["onthouden"]) ? (lading["onthouden"] as Lading[]) : [];
      beurten.push({
        gesprek: g.nummer,
        vraag: vraagTekst,
        http: status,
        antwoord,
        onthouden: onthouden.map((o) => ({ soort: String(o["soort"] ?? ""), tekst: String(o["tekst"] ?? "") })),
        geheugenGebruikt: typeof lading["geheugen_gebruikt"] === "number" ? (lading["geheugen_gebruikt"] as number) : null,
        geheugenMeegegeven: geheugen.length,
        doelAangemaakt: lading["doel"] !== undefined && lading["doel"] !== null,
        kostenUsd: kosten,
      });
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

/** Het verloop als bewijs voor de beoordelaar: woordelijk, per gesprek, zonder conclusie. */
export function sparproefBewijs(
  uitkomst: { readonly beurten: readonly SparBeurt[]; readonly besteedUsd: number; readonly gestopt: string | null },
  url: string,
  scenario: readonly SparGesprek[] = SPARPROEF,
): string {
  const regels: string[] = [
    `live sparproef (zojuist door de eindcontrole uitgevoerd tegen productie: POST ${url}, modus "sparren", alleen_lezen; ` +
      `${scenario.length} gescheiden gesprekken, elk met een eigen gesprek-id). Tussen de gesprekken bestaat geen gedeeld verloop: ` +
      `wat Jarvis uit een eerder gesprek weet, komt uitsluitend uit het geheugen (de inzichten die hij zelf vastlegde en de eerdere beurten), ` +
      `dat de proef doorgeeft zoals de database dat tussen twee echte gesprekken doet. In deze modus bestaat het gereedschap om een doel te maken niet.`,
    `kosten van deze proef: $${uitkomst.besteedUsd.toFixed(4)} (grens $${MAX_PROEF_USD})${uitkomst.gestopt ? `; ${uitkomst.gestopt}` : ""}`,
  ];
  for (const g of scenario) {
    const eigen = uitkomst.beurten.filter((b) => b.gesprek === g.nummer);
    regels.push("", `=== gesprek ${g.nummer} (${g.onderwerp}) — laat zien: ${g.toetst} ===`);
    if (eigen.length === 0) regels.push("(niet uitgevoerd)");
    for (const b of eigen) {
      regels.push(
        `[eigenaar] ${b.vraag}`,
        `[jarvis] (HTTP ${b.http}; geheugenitems meegegeven: ${b.geheugenMeegegeven}; door Jarvis gebruikt: ${b.geheugenGebruikt ?? "-"}; doel aangemaakt: ${b.doelAangemaakt ? "JA" : "nee"}; kosten $${b.kostenUsd ?? "?"})`,
        kort(b.antwoord, MAX_ANTWOORD_TEKENS),
      );
      if (b.onthouden.length > 0) regels.push(`[onthouden door Jarvis] ${b.onthouden.map((o) => `${o.soort}: ${o.tekst}`).join(" | ")}`);
    }
  }
  return regels.join("\n");
}

const INSTELLING_SQL = "select waarde from jarvis.instellingen where sleutel = $1";

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
  const uitkomst = await voerSparproef(async (body) => {
    const a = await fetchFn(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${sleutel}`, "Content-Type": "application/json", "User-Agent": "jarvis-acceptatie" },
      body: JSON.stringify(body),
    });
    const lading = (await a.json().catch(() => ({}))) as Lading;
    return { status: a.status, lading };
  });
  return { bewijs: sparproefBewijs(uitkomst, url), besteedUsd: uitkomst.besteedUsd };
}
