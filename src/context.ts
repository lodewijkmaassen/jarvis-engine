// Contextassemblage: van een taakomschrijving naar een begrensd, herleidbaar
// contextpakket.
//
// Dit is de kern van de belofte "een blanco sessie vindt zelf de juiste
// context". Drie eigenschappen maken het bruikbaar als bewijs:
//
//   1. Deterministisch — dezelfde repo-staat en dezelfde taak geven exact
//      hetzelfde pakket, inclusief volgorde. Een pakket dat morgen anders is
//      bewijst niets.
//   2. Begrensd — er is een hard tokenbudget per taakklasse.
//   3. Eerlijk — wat niet paste staat MET REDEN op de weglatingslijst. Een
//      agent die iets mist kan dan gericht bijvragen in plaats van te gokken.
import {
  classificeer,
  normaliseerPad,
  renderVoorKlasse,
  schatTokens,
  type ContextKlasse,
} from "./classify";
import type { JarvisConfig, TaakKlasse } from "./config";
import { buildManifest, type ContextManifest, type ReadSource } from "./manifest";
import { isActiefRecord, type KnowledgeRecord } from "./records";
import { buildIndex, search, type RetrievalResult } from "./retrieval";
import { uniqueTokens } from "./text";

export type ItemSoort = "kern" | "randvoorwaarde" | "record" | "bestand" | "precedent";

export type ContextItem = {
  readonly soort: ItemSoort;
  /** Record-id of repo-relatief pad. */
  readonly id: string;
  readonly reden: string;
  readonly tokens: number;
  readonly tekst: string;
  readonly bestandsKlasse?: ContextKlasse;
};

export type WeggelatenItem = {
  readonly soort: ItemSoort;
  readonly id: string;
  readonly reden: string;
  readonly tokens: number;
};

export type ContextPakket = {
  readonly taak: string;
  readonly klasse: TaakKlasse;
  readonly budget: number;
  readonly gebruikt: number;
  readonly termen: readonly string[];
  readonly items: readonly ContextItem[];
  readonly weggelaten: readonly WeggelatenItem[];
  readonly manifest: ContextManifest;
  /** Bevindingen over de kennisbasis zelf (open conflicten, vervangen records). */
  readonly signalen: readonly string[];
};

export type ContextVerzoek = {
  readonly taak: string;
  readonly klasse: TaakKlasse;
  readonly config: JarvisConfig;
  readonly records: readonly KnowledgeRecord[];
  /** Bestanden die de taak expliciet raakt. */
  readonly bestanden?: readonly string[];
  /** Afgeronde taken die als precedent kunnen dienen (pad -> uitkomsttekst). */
  readonly precedenten?: readonly { readonly pad: string; readonly tekst: string }[];
  readonly readSource: ReadSource;
  readonly gegenereerdOp: string;
  /** Maximum aantal kennisrecords uit retrieval. Standaard 12. */
  readonly maxRecords?: number;
};

/** Compacte, stabiele weergave van één kennisrecord voor in het pakket. */
export function renderRecord(record: KnowledgeRecord): string {
  const regels: string[] = [
    `### ${record.id} — ${record.titel}`,
    `type: ${record.type} | datum: ${record.datum} | tags: ${record.tags.join(", ") || "-"}`,
    record.samenvatting,
  ];
  switch (record.type) {
    case "DEC":
      regels.push(`status: ${record.status}`, `besluit: ${record.besluit}`, `motivatie: ${record.motivatie}`);
      if (record.alternatieven.length > 0) {
        regels.push(`afgewezen alternatieven: ${record.alternatieven.join(" | ")}`);
      }
      if (record.vervangt.length > 0) regels.push(`vervangt: ${record.vervangt.join(", ")}`);
      break;
    case "CON":
      regels.push(`hardheid: ${record.hardheid} | handhaving: ${record.handhaving}`, `regel: ${record.regel}`);
      break;
    case "LRN":
      regels.push(`observatie: ${record.observatie}`, `les: ${record.les}`);
      break;
    case "RSK":
      regels.push(
        `status: ${record.status} | kans: ${record.kans} | impact: ${record.impact}`,
        `risico: ${record.beschrijving}`,
        `mitigatie: ${record.mitigatie}`,
      );
      break;
    case "CFL":
      regels.push(
        `status: ${record.status} | tussen: ${record.tussen.join(", ")}`,
        `conflict: ${record.beschrijving}`,
      );
      break;
  }
  if (record.bronnen.length > 0) regels.push(`bronnen: ${record.bronnen.join(", ")}`);
  return regels.join("\n");
}

/** Een budgetteerder die op volgorde vult en de rest met reden laat liggen. */
class Budget {
  private gebruikt = 0;
  readonly items: ContextItem[] = [];
  readonly weggelaten: WeggelatenItem[] = [];

  constructor(private readonly plafond: number) {}

  /** `verplicht` items tellen mee maar worden nooit geweigerd. */
  voegToe(item: ContextItem, verplicht = false): boolean {
    if (!verplicht && this.gebruikt + item.tokens > this.plafond) {
      this.weggelaten.push({
        soort: item.soort,
        id: item.id,
        reden: `budget vol (${this.gebruikt}/${this.plafond} tokens gebruikt, dit item vraagt ${item.tokens})`,
        tokens: item.tokens,
      });
      return false;
    }
    this.items.push(item);
    this.gebruikt += item.tokens;
    return true;
  }

  sla(item: WeggelatenItem): void {
    this.weggelaten.push(item);
  }

  get totaal(): number {
    return this.gebruikt;
  }
}

async function leesEnClassificeer(
  pad: string,
  termen: readonly string[],
  config: JarvisConfig,
  readSource: ReadSource,
): Promise<{ readonly tekst: string; readonly klasse: ContextKlasse; readonly reden: string } | null> {
  const inhoud = await readSource(normaliseerPad(pad));
  if (inhoud === null) return null;
  const { klasse, reden } = classificeer(pad, inhoud, {
    nooit: config.context_nooit,
    symbolen: config.context_symbolen,
    fragmentRegels: config.context_fragment_regels,
  });
  const tekst = renderVoorKlasse(klasse, inhoud, termen, config.context_fragment_regels);
  if (tekst === null) return null;
  return { tekst, klasse, reden };
}

/**
 * Stelt het contextpakket samen.
 *
 * Vulvolgorde is de prioriteitsvolgorde. Kern en harde randvoorwaarden zijn
 * verplicht: die mogen nooit sneuvelen voor budget, want dat zijn precies de
 * regels waarop een agent niet mag improviseren. Alles daarna vult op tot het
 * budget vol is.
 */
export async function bouwContextPakket(verzoek: ContextVerzoek): Promise<ContextPakket> {
  const { config, records, taak, klasse, readSource } = verzoek;
  const plafond = config.budget[klasse];
  const budget = new Budget(plafond);
  const termen = uniqueTokens(taak);
  const signalen: string[] = [];
  const gebruikteBronnen = new Set<string>();

  const actief = records.filter((r) => isActiefRecord(r));
  for (const record of records) {
    if (record.type === "CFL" && record.status === "open") {
      signalen.push(`open conflict ${record.id} tussen ${record.tussen.join(", ")}`);
    }
  }

  // 1. Kern — de projectkaart en de actuele stand. Altijd, ongeacht de taak.
  for (const [pad, reden] of [
    [config.project_kaart, "projectkaart (kern)"],
    [config.current_state, "actuele projectstatus (kern)"],
  ] as const) {
    const gelezen = await leesEnClassificeer(pad, termen, config, readSource);
    if (!gelezen) {
      budget.sla({ soort: "kern", id: pad, reden: "bestand ontbreekt", tokens: 0 });
      signalen.push(`kernbestand ontbreekt: ${pad}`);
      continue;
    }
    gebruikteBronnen.add(normaliseerPad(pad));
    budget.voegToe(
      {
        soort: "kern",
        id: normaliseerPad(pad),
        reden,
        tokens: schatTokens(gelezen.tekst),
        tekst: gelezen.tekst,
        bestandsKlasse: gelezen.klasse,
      },
      true,
    );
  }

  // 2. Harde randvoorwaarden — kort, klein, en nooit weglaatbaar.
  const hardeConstraints = actief
    .filter((r): r is Extract<KnowledgeRecord, { type: "CON" }> => r.type === "CON" && r.hardheid === "hard")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const con of hardeConstraints) {
    const tekst = renderRecord(con);
    budget.voegToe(
      {
        soort: "randvoorwaarde",
        id: con.id,
        reden: "harde randvoorwaarde — geldt altijd",
        tokens: schatTokens(tekst),
        tekst,
      },
      true,
    );
    for (const bron of con.bronnen) gebruikteBronnen.add(bron);
  }

  // 3. Records via deterministische retrieval.
  const opgenomen = new Set(hardeConstraints.map((c) => c.id));
  const index = buildIndex(actief);
  const resultaat: RetrievalResult = search(index, taak, { limiet: verzoek.maxRecords ?? 12 });
  for (const hit of resultaat.hits) {
    if (opgenomen.has(hit.record.id)) continue;
    const tekst = renderRecord(hit.record);
    const geplaatst = budget.voegToe({
      soort: "record",
      id: hit.record.id,
      reden: `treffer op ${hit.termen.map((t) => t.term).join(", ") || "tags"} (score ${hit.score})`,
      tokens: schatTokens(tekst),
      tekst,
    });
    if (geplaatst) {
      opgenomen.add(hit.record.id);
      for (const bron of hit.record.bronnen) gebruikteBronnen.add(bron);
    }
  }

  // 4. Expliciet geraakte bestanden, geclassificeerd.
  for (const pad of verzoek.bestanden ?? []) {
    const gelezen = await leesEnClassificeer(pad, termen, config, readSource);
    if (!gelezen) {
      budget.sla({ soort: "bestand", id: normaliseerPad(pad), reden: "niet leesbaar of uitgesloten", tokens: 0 });
      continue;
    }
    const geplaatst = budget.voegToe({
      soort: "bestand",
      id: normaliseerPad(pad),
      reden: gelezen.reden,
      tokens: schatTokens(gelezen.tekst),
      tekst: gelezen.tekst,
      bestandsKlasse: gelezen.klasse,
    });
    if (geplaatst) gebruikteBronnen.add(normaliseerPad(pad));
  }

  // 5. Precedent uit eerder afgeronde taken — alleen de uitkomst, nooit het
  //    volledige dossier.
  for (const precedent of verzoek.precedenten ?? []) {
    budget.voegToe({
      soort: "precedent",
      id: normaliseerPad(precedent.pad),
      reden: "eerdere vergelijkbare taak",
      tokens: schatTokens(precedent.tekst),
      tekst: precedent.tekst,
    });
  }

  const manifest = await buildManifest(resultaat, {
    gegenereerdOp: verzoek.gegenereerdOp,
    readSource,
    extraBronnen: [...gebruikteBronnen].sort(),
  });

  return {
    taak,
    klasse,
    budget: plafond,
    gebruikt: budget.totaal,
    termen,
    items: budget.items,
    weggelaten: budget.weggelaten,
    manifest,
    signalen: signalen.sort(),
  };
}

/** Het contextpakket als leesbaar markdowndocument voor de agent. */
export function rendereerPakket(pakket: ContextPakket): string {
  const uit: string[] = [
    `# Contextpakket`,
    ``,
    `**Taak:** ${pakket.taak}`,
    `**Klasse:** ${pakket.klasse} · **Budget:** ${pakket.gebruikt}/${pakket.budget} tokens (schatting)`,
    `**Manifesthash:** \`${pakket.manifest.manifestHash}\``,
    `**Gegenereerd op:** ${pakket.manifest.gegenereerdOp}`,
    ``,
    `> Dit pakket is deterministisch samengesteld uit de kennisbasis en de repository.`,
    `> Wat hier niet in staat, staat onderaan bij "Weggelaten" — vraag dat gericht op`,
    `> in plaats van er omheen te redeneren.`,
    ``,
  ];

  if (pakket.signalen.length > 0) {
    uit.push(`## Signalen over de kennisbasis`, ``);
    for (const s of pakket.signalen) uit.push(`- ${s}`);
    uit.push(``);
  }

  const koppen: Record<ItemSoort, string> = {
    kern: "Kern",
    randvoorwaarde: "Harde randvoorwaarden (altijd van toepassing)",
    record: "Relevante kennis",
    bestand: "Geraakte bestanden",
    precedent: "Eerdere vergelijkbare taken",
  };
  for (const soort of ["kern", "randvoorwaarde", "record", "bestand", "precedent"] as const) {
    const items = pakket.items.filter((i) => i.soort === soort);
    if (items.length === 0) continue;
    uit.push(`## ${koppen[soort]}`, ``);
    for (const item of items) {
      uit.push(`<!-- ${item.id} · ${item.reden} · ~${item.tokens} tokens -->`);
      if (soort === "bestand" || soort === "kern") {
        uit.push(`### ${item.id}${item.bestandsKlasse ? ` (${item.bestandsKlasse})` : ""}`, ``);
        uit.push("```", item.tekst, "```", ``);
      } else {
        uit.push(item.tekst, ``);
      }
    }
  }

  uit.push(`## Weggelaten`, ``);
  if (pakket.weggelaten.length === 0) {
    uit.push(`Niets. Alles wat geselecteerd werd paste binnen het budget.`, ``);
  } else {
    for (const w of pakket.weggelaten) uit.push(`- \`${w.id}\` (${w.soort}) — ${w.reden}`);
    uit.push(``);
  }
  return uit.join("\n");
}
