// Afhankelijkheidsanalyse: van een lijst subtaken naar kritiek pad en waves.
//
// Waarom dit in de engine zit en niet in iemands hoofd: het verschil tussen
// "88 uur werk" en "88 uur wachten" is precies de vraag welk deel echt
// achter elkaar MOET. Zonder die analyse wordt elk plan stilzwijgend
// sequentieel gepland, ook waar dat nergens voor nodig is.
//
// Bewust GEEN scheduler: dit rekent en toont. Het starten van sessies blijft
// een menselijke of orkestratiebeslissing. Een automatische spawner zou een
// merge-queue en cross-sessie-conflictafhandeling vereisen die we niet hebben.

export const TAAK_TYPES = ["sequentieel", "parallel", "mens"] as const;
export type TaakType = (typeof TAAK_TYPES)[number];

export type PlanTaak = {
  readonly id: string;
  readonly naam: string;
  readonly uren: number;
  readonly afhankelijkVan: readonly string[];
  readonly type: TaakType;
  readonly track: string;
};

export type PlanFout = { readonly onderwerp: string; readonly boodschap: string };

export type WaveTaak = { readonly id: string; readonly track: string; readonly uren: number };
export type Wave = {
  readonly nummer: number;
  readonly taken: readonly WaveTaak[];
  /** De langste taak bepaalt hoe lang deze wave duurt bij volledige parallellie. */
  readonly wallclock: number;
  readonly urenTotaal: number;
};

export type PlanAnalyse = {
  readonly ok: boolean;
  readonly fouten: readonly PlanFout[];
  readonly totaalUren: number;
  readonly kritiekPad: readonly string[];
  readonly kritiekPadUren: number;
  readonly waves: readonly Wave[];
  /** Breedste wave = hoeveel sessies er op de piek zinvol tegelijk werken. */
  readonly maxBreedte: number;
  readonly aanbevolenConcurrency: number;
  /** Wall-clock bij de aanbevolen concurrency, dus de te verwachten duur. */
  readonly wallclockUren: number;
  readonly mensGates: readonly string[];
};

/**
 * Boven dit aantal gelijktijdige sessies wegen merge-, context- en
 * reviewkosten zwaarder dan de gewonnen tijd. Geen technische limiet maar een
 * ervaringsgrens; hij staat hier expliciet zodat hij bespreekbaar is.
 */
export const CONCURRENCY_PLAFOND = 5;

const KOLOMMEN = ["id", "naam", "uren", "afhankelijk_van", "type", "track"] as const;

/** Splitst een markdown-tabelrij op `|`, zonder de lege buitenranden. */
function cellen(regel: string): readonly string[] {
  return regel
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * Leest het plan uit een markdown-tabel.
 *
 * Markdown omdat een plan in een pull request beoordeeld moet kunnen worden.
 * Een tabel die een mens kan lezen en corrigeren is hier meer waard dan een
 * compact machineformaat.
 */
export function parseerPlanTabel(markdown: string): {
  readonly taken: readonly PlanTaak[];
  readonly fouten: readonly PlanFout[];
} {
  const fouten: PlanFout[] = [];
  const regels = markdown.replace(/\r\n/g, "\n").split("\n");
  const start = regels.findIndex((r) => {
    if (!r.trim().startsWith("|")) return false;
    const kop = cellen(r).map((c) => c.toLowerCase());
    return KOLOMMEN.every((k) => kop.includes(k));
  });
  if (start === -1) {
    return {
      taken: [],
      fouten: [{ onderwerp: "(tabel)", boodschap: `geen plantabel gevonden met kolommen ${KOLOMMEN.join(", ")}` }],
    };
  }

  const kop = cellen(regels[start]).map((c) => c.toLowerCase());
  const index = Object.fromEntries(KOLOMMEN.map((k) => [k, kop.indexOf(k)])) as Record<
    (typeof KOLOMMEN)[number],
    number
  >;

  const taken: PlanTaak[] = [];
  for (let i = start + 2; i < regels.length; i += 1) {
    const regel = regels[i];
    if (!regel.trim().startsWith("|")) break;
    const rij = cellen(regel);
    if (rij.every((c) => c.length === 0)) continue;

    const id = rij[index.id] ?? "";
    if (id.length === 0) {
      fouten.push({ onderwerp: `regel ${i + 1}`, boodschap: "rij zonder id" });
      continue;
    }
    const urenRuw = rij[index.uren] ?? "";
    const uren = Number.parseFloat(urenRuw.replace(",", "."));
    if (!Number.isFinite(uren) || uren < 0) {
      fouten.push({ onderwerp: id, boodschap: `ongeldige urenwaarde "${urenRuw}"` });
      continue;
    }
    const typeRuw = (rij[index.type] ?? "").toLowerCase();
    if (!(TAAK_TYPES as readonly string[]).includes(typeRuw)) {
      fouten.push({ onderwerp: id, boodschap: `type moet een van ${TAAK_TYPES.join(", ")} zijn, kreeg "${typeRuw}"` });
      continue;
    }
    const depsRuw = (rij[index.afhankelijk_van] ?? "").trim();
    const afhankelijkVan =
      depsRuw === "" || depsRuw === "-"
        ? []
        : depsRuw
            .split(/[,\s]+/)
            .map((d) => d.trim())
            .filter((d) => d.length > 0);

    taken.push({
      id,
      naam: rij[index.naam] ?? "",
      uren,
      afhankelijkVan,
      type: typeRuw as TaakType,
      track: rij[index.track] ?? "",
    });
  }

  return { taken, fouten };
}

/**
 * Analyseert het plan.
 *
 * Kritiek pad = het langste pad door de graaf, gemeten in uren. Waves =
 * topologische niveaus: alles in dezelfde wave heeft geen onderlinge
 * afhankelijkheid en kan dus tegelijk. Menselijke poorten tellen mee in de
 * volgorde maar niet in de uren — die tijd is niet van een agent.
 */
export function analyseerPlan(taken: readonly PlanTaak[]): PlanAnalyse {
  const fouten: PlanFout[] = [];
  const perId = new Map<string, PlanTaak>();
  for (const taak of taken) {
    if (perId.has(taak.id)) {
      fouten.push({ onderwerp: taak.id, boodschap: "id komt meer dan één keer voor" });
      continue;
    }
    perId.set(taak.id, taak);
  }
  for (const taak of perId.values()) {
    for (const dep of taak.afhankelijkVan) {
      if (dep === taak.id) fouten.push({ onderwerp: taak.id, boodschap: "taak hangt van zichzelf af" });
      else if (!perId.has(dep)) fouten.push({ onderwerp: taak.id, boodschap: `onbekende afhankelijkheid ${dep}` });
    }
  }

  // Topologische sortering met cyclusdetectie (Kahn). Een cyclus is een
  // planningsfout, geen randgeval: hij maakt elke doorlooptijd oneindig.
  const inkomend = new Map<string, number>();
  const uitgaand = new Map<string, string[]>();
  for (const taak of perId.values()) {
    inkomend.set(taak.id, 0);
    uitgaand.set(taak.id, []);
  }
  for (const taak of perId.values()) {
    for (const dep of taak.afhankelijkVan) {
      if (!perId.has(dep)) continue;
      inkomend.set(taak.id, (inkomend.get(taak.id) ?? 0) + 1);
      uitgaand.get(dep)?.push(taak.id);
    }
  }

  const wachtrij = [...perId.keys()].filter((id) => (inkomend.get(id) ?? 0) === 0).sort();
  const volgorde: string[] = [];
  const resterend = new Map(inkomend);
  const rij = [...wachtrij];
  while (rij.length > 0) {
    const id = rij.shift() as string;
    volgorde.push(id);
    for (const volgend of (uitgaand.get(id) ?? []).sort()) {
      const nieuw = (resterend.get(volgend) ?? 0) - 1;
      resterend.set(volgend, nieuw);
      if (nieuw === 0) rij.push(volgend);
    }
    rij.sort();
  }
  if (volgorde.length !== perId.size) {
    const inCyclus = [...perId.keys()].filter((id) => !volgorde.includes(id)).sort();
    fouten.push({ onderwerp: inCyclus.join(", "), boodschap: "cyclische afhankelijkheid" });
  }

  // Vroegste start + langste pad in één doorloop over de topologische volgorde.
  const eindTijd = new Map<string, number>();
  const startTijd = new Map<string, number>();
  const voorganger = new Map<string, string | null>();
  for (const id of volgorde) {
    const taak = perId.get(id) as PlanTaak;
    let start = 0;
    let beste: string | null = null;
    for (const dep of taak.afhankelijkVan) {
      const eind = eindTijd.get(dep);
      if (eind === undefined) continue;
      if (eind > start) {
        start = eind;
        beste = dep;
      }
    }
    startTijd.set(id, start);
    eindTijd.set(id, start + taak.uren);
    voorganger.set(id, beste);
  }

  let laatste: string | null = null;
  let langste = 0;
  for (const [id, eind] of [...eindTijd.entries()].sort()) {
    if (eind > langste) {
      langste = eind;
      laatste = id;
    }
  }
  const kritiekPad: string[] = [];
  let loper = laatste;
  while (loper) {
    kritiekPad.unshift(loper);
    loper = voorganger.get(loper) ?? null;
  }

  // Waves op basis van vroegste start: alles met dezelfde diepte kan tegelijk.
  const diepte = new Map<string, number>();
  for (const id of volgorde) {
    const taak = perId.get(id) as PlanTaak;
    const d = taak.afhankelijkVan.reduce((max, dep) => Math.max(max, (diepte.get(dep) ?? -1) + 1), 0);
    diepte.set(id, d);
  }
  const perDiepte = new Map<number, WaveTaak[]>();
  for (const [id, d] of [...diepte.entries()].sort()) {
    const taak = perId.get(id) as PlanTaak;
    const lijst = perDiepte.get(d) ?? [];
    lijst.push({ id, track: taak.track, uren: taak.uren });
    perDiepte.set(d, lijst);
  }
  const waves: Wave[] = [...perDiepte.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([d, lijst], i) => {
      const gesorteerd = [...lijst].sort((a, b) => (a.id < b.id ? -1 : 1));
      return {
        nummer: i + 1,
        taken: gesorteerd,
        wallclock: gesorteerd.reduce((max, t) => Math.max(max, t.uren), 0),
        urenTotaal: gesorteerd.reduce((som, t) => som + t.uren, 0),
      } satisfies Wave;
    });

  const maxBreedte = waves.reduce((max, w) => Math.max(max, w.taken.length), 0);
  const aanbevolenConcurrency = Math.max(1, Math.min(maxBreedte, CONCURRENCY_PLAFOND));

  // Wall-clock bij begrensde concurrency: per wave het werk verdelen over de
  // beschikbare sessies, maar nooit sneller dan de langste enkele taak.
  const wallclockUren = waves.reduce((som, w) => {
    const verdeeld = w.urenTotaal / aanbevolenConcurrency;
    return som + Math.max(w.wallclock, verdeeld);
  }, 0);

  return {
    ok: fouten.length === 0,
    fouten,
    totaalUren: [...perId.values()].reduce((som, t) => som + t.uren, 0),
    kritiekPad,
    kritiekPadUren: Math.round(langste * 100) / 100,
    waves,
    maxBreedte,
    aanbevolenConcurrency,
    wallclockUren: Math.round(wallclockUren * 100) / 100,
    mensGates: [...perId.values()]
      .filter((t) => t.type === "mens")
      .map((t) => t.id)
      .sort(),
  };
}

/** Rapport in markdown, inclusief een mermaid-graaf. */
export function rendereerPlan(taken: readonly PlanTaak[], analyse: PlanAnalyse): string {
  const perId = new Map(taken.map((t) => [t.id, t] as const));
  const uit: string[] = ["# Uitvoeringsplan", ""];

  if (!analyse.ok) {
    uit.push("## Fouten in het plan", "");
    for (const f of analyse.fouten) uit.push(`- **${f.onderwerp}** — ${f.boodschap}`);
    uit.push("");
  }

  uit.push(
    "| Grootheid | Waarde |",
    "|---|---|",
    `| Totaal werk | ${analyse.totaalUren} uur |`,
    `| Kritiek pad | ${analyse.kritiekPadUren} uur |`,
    `| Maximale versnelling | ${analyse.kritiekPadUren > 0 ? (analyse.totaalUren / analyse.kritiekPadUren).toFixed(1) : "-"}x |`,
    `| Breedste wave | ${analyse.maxBreedte} taken |`,
    `| Aanbevolen concurrency | ${analyse.aanbevolenConcurrency} sessies |`,
    `| Verwachte wall-clock | ${analyse.wallclockUren} uur |`,
    `| Menselijke poorten | ${analyse.mensGates.join(", ") || "geen"} |`,
    "",
    `**Kritiek pad:** ${analyse.kritiekPad.join(" → ") || "(leeg)"}`,
    "",
    "## Execution waves",
    "",
  );

  for (const wave of analyse.waves) {
    uit.push(
      `### Wave ${wave.nummer} — ${wave.taken.length} taken, ${wave.urenTotaal} uur werk, ${wave.wallclock} uur wall-clock`,
      "",
      "| Taak | Track | Uren | Type |",
      "|---|---|---:|---|",
    );
    for (const t of wave.taken) {
      const taak = perId.get(t.id);
      uit.push(`| ${t.id} ${taak?.naam ?? ""} | ${t.track} | ${t.uren} | ${taak?.type ?? "-"} |`);
    }
    uit.push("");
  }

  uit.push("## Afhankelijkheidsgraaf", "", "```mermaid", "flowchart LR");
  const kritiek = new Set(analyse.kritiekPad);
  for (const taak of taken) {
    const vorm = taak.type === "mens" ? `{{"${taak.id} ${taak.naam}"}}` : `["${taak.id} ${taak.naam}"]`;
    uit.push(`  ${taak.id}${vorm}`);
  }
  for (const taak of taken) {
    for (const dep of taak.afhankelijkVan) {
      if (!perId.has(dep)) continue;
      uit.push(`  ${dep} --> ${taak.id}`);
    }
  }
  for (const id of kritiek) uit.push(`  style ${id} stroke-width:3px`);
  uit.push("```", "");
  return uit.join("\n");
}
