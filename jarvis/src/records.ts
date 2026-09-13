// De vijf kennisrecordtypes van de Jarvis Knowledge Manager + validatie.
//
// DEC — besluit          (wat is er besloten, waarom, met welke gevolgen)
// CON — randvoorwaarde   (wat mag/moet altijd, hard of zacht, hoe gehandhaafd)
// LRN — leerpunt         (wat is er geleerd uit een concrete observatie)
// RSK — risico           (wat kan misgaan, kans/impact, mitigatie, eigenaar)
// CFL — conflict         (welke records spreken elkaar tegen, en is dat opgelost)
//
// Validatie is tweetraps, net als elders in deze codebase (schema-validatie
// los van semantische controle):
//   1. validateRecord()    — vorm van één record (Zod).
//   2. validateRecordSet() — samenhang over de hele set: unieke id's,
//      verwijzingen die bestaan én naar het juiste type wijzen, conflicten
//      die niet naar zichzelf verwijzen.
// Datafouten worden NOOIT geworpen maar teruggegeven als bevindingen, zodat
// een aanroeper een hele set kan valideren in plaats van te stoppen bij de
// eerste fout.
import { z } from "zod";

export const RECORD_TYPES = ["DEC", "CON", "LRN", "RSK", "CFL"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export function isRecordType(value: unknown): value is RecordType {
  return (
    typeof value === "string" && (RECORD_TYPES as readonly string[]).includes(value)
  );
}

// Id-vorm: <TYPE>-<vier cijfers>. Het voorvoegsel MOET overeenkomen met het
// type-veld; dat is een aparte controle (zie idPrefixMatchesType) omdat de
// foutmelding dan bruikbaar is in plaats van "voldoet niet aan patroon".
const ID_PATTERN = /^(DEC|CON|LRN|RSK|CFL)-\d{4}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const nonEmpty = z.string().trim().min(1, "mag niet leeg zijn");
const idField = z.string().regex(ID_PATTERN, "verwacht formaat <TYPE>-0000");
const dateField = z.string().regex(DATE_PATTERN, "verwacht formaat JJJJ-MM-DD");

// Bronnen zijn repo-relatieve paden. Absolute paden en `..` zijn verboden:
// een manifest moet buiten deze machine reproduceerbaar blijven.
const sourcePath = z
  .string()
  .trim()
  .min(1, "mag niet leeg zijn")
  .refine((p) => !p.startsWith("/"), "moet repo-relatief zijn (geen / aan het begin)")
  .refine((p) => !p.split("/").includes(".."), "mag geen .. bevatten");

const baseShape = {
  id: idField,
  titel: nonEmpty,
  samenvatting: nonEmpty,
  datum: dateField,
  tags: z.array(nonEmpty).default([]),
  bronnen: z.array(sourcePath).default([]),
};

// Onderwerpsleutel: twee ACTIEVE records met hetzelfde onderwerp zijn per
// definitie ofwel een duplicaat ofwel een niet-vastgelegde vervanging. Dit is
// de sleutel waarop deduplicatie en conflictdetectie draaien.
const onderwerpField = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "verwacht kebab-case, bv. berichtsjabloon-resolutie");

export const decisionSchema = z.strictObject({
  ...baseShape,
  type: z.literal("DEC"),
  status: z.enum(["voorgesteld", "besloten", "herzien", "vervallen"]),
  onderwerp: onderwerpField.optional(),
  besluit: nonEmpty,
  motivatie: nonEmpty,
  alternatieven: z.array(nonEmpty).default([]),
  gevolgen: z.array(nonEmpty).default([]),
  // Verwijst naar eerdere DEC-records die dit besluit vervangt.
  vervangt: z.array(idField).default([]),
});

// Triggers maken een randvoorwaarde deterministisch toetsbaar: raakt een
// wijziging een van deze paden, of noemt een voorstel een van deze woorden,
// dan moet de randvoorwaarde expliciet zijn afgewogen. Zonder triggers is een
// CON alleen leesbaar voor een mens; mét triggers kan CI hem handhaven.
export const triggerSchema = z.strictObject({
  woorden: z.array(nonEmpty).default([]),
  paden: z.array(nonEmpty).default([]),
});

export const constraintSchema = z.strictObject({
  ...baseShape,
  type: z.literal("CON"),
  onderwerp: onderwerpField.optional(),
  regel: nonEmpty,
  hardheid: z.enum(["hard", "zacht"]),
  handhaving: z.enum(["code", "proces", "extern"]),
  bron_besluit: idField.optional(),
  triggers: triggerSchema.optional(),
  // Afwezig = actief. Bewust optioneel (niet .default) zodat het toevoegen
  // van dit veld de canonieke JSON — en dus de recordhash — van bestaande
  // records niet verandert.
  status: z.enum(["actief", "vervallen"]).optional(),
});

export const learningSchema = z.strictObject({
  ...baseShape,
  type: z.literal("LRN"),
  observatie: nonEmpty,
  les: nonEmpty,
  bewijs: z.array(nonEmpty).default([]),
});

export const riskSchema = z.strictObject({
  ...baseShape,
  type: z.literal("RSK"),
  beschrijving: nonEmpty,
  kans: z.enum(["laag", "midden", "hoog"]),
  impact: z.enum(["laag", "midden", "hoog"]),
  mitigatie: nonEmpty,
  eigenaar: nonEmpty,
  status: z.enum(["open", "beheerst", "geaccepteerd", "vervallen"]),
  // De taak die dit risico aanpakt. Zolang die loopt is het risico open maar
  // geen beslissing meer voor de eigenaar: het werk is van Jarvis (CON-0015),
  // en de eigenaar ziet het terug in de pull request van die taak.
  aanpak: z.string().regex(/^T-\d{8}-[a-z0-9-]+$/).optional(),
  // Sectie "## Opties": per keuze wat er dan gebeurt, plus een advies. Vrij
  // van vorm hier; de interface leest er regels "- Label: gevolg" uit.
  opties: z.string().optional(),
});

export const conflictSchema = z.strictObject({
  ...baseShape,
  type: z.literal("CFL"),
  beschrijving: nonEmpty,
  // Minimaal twee records die elkaar tegenspreken.
  tussen: z.array(idField).min(2, "een conflict loopt tussen minstens 2 records"),
  status: z.enum(["open", "opgelost"]),
  // Verplicht zodra status = opgelost (zie superRefine hieronder).
  opgelost_door: idField.optional(),
  opties: z.string().optional(),
});

export const knowledgeRecordSchema = z
  .discriminatedUnion("type", [
    decisionSchema,
    constraintSchema,
    learningSchema,
    riskSchema,
    conflictSchema,
  ])
  .superRefine((record, ctx) => {
    if (record.type === "CFL" && record.status === "opgelost" && !record.opgelost_door) {
      ctx.addIssue({
        code: "custom",
        path: ["opgelost_door"],
        message: "een opgelost conflict moet verwijzen naar het besluit dat het oploste",
      });
    }
  });

export type DecisionRecord = z.infer<typeof decisionSchema>;
export type ConstraintRecord = z.infer<typeof constraintSchema>;
export type LearningRecord = z.infer<typeof learningSchema>;
export type RiskRecord = z.infer<typeof riskSchema>;
export type ConflictRecord = z.infer<typeof conflictSchema>;
export type KnowledgeRecord = z.infer<typeof knowledgeRecordSchema>;

export const ISSUE_CODES = [
  "schema_ongeldig",
  "type_voorvoegsel_mismatch",
  "dubbele_id",
  "verwijzing_onbekend",
  "verwijzing_verkeerd_type",
  "zelfverwijzing",
  "vervangen_besluit_nog_actief",
  "conflict_open",
  "dubbel_onderwerp",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

export type IssueSeverity = "fout" | "waarschuwing";

export type ValidationIssue = {
  readonly code: IssueCode;
  readonly severity: IssueSeverity;
  readonly recordId: string | null;
  readonly pad: string;
  readonly boodschap: string;
};

export type RecordValidation =
  | { readonly ok: true; readonly record: KnowledgeRecord }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export type RecordSetValidation = {
  /** true zodra er geen enkele bevinding met severity "fout" is. */
  readonly ok: boolean;
  /** Alleen de records die schema-validatie doorstonden, op id gesorteerd. */
  readonly records: readonly KnowledgeRecord[];
  readonly issues: readonly ValidationIssue[];
};

function issue(
  code: IssueCode,
  severity: IssueSeverity,
  recordId: string | null,
  pad: string,
  boodschap: string,
): ValidationIssue {
  return { code, severity, recordId, pad, boodschap };
}

function idPrefixMatchesType(id: string, type: RecordType): boolean {
  return id.startsWith(`${type}-`);
}

/** Leest het id-veld van ongevalideerde invoer, puur voor foutmeldingen. */
function peekId(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const id = (input as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/** Valideert de vorm van één record. */
export function validateRecord(input: unknown): RecordValidation {
  const parsed = knowledgeRecordSchema.safeParse(input);
  if (!parsed.success) {
    const fallbackId = peekId(input);
    return {
      ok: false,
      issues: parsed.error.issues.map((i) =>
        issue(
          "schema_ongeldig",
          "fout",
          fallbackId,
          i.path.length > 0 ? i.path.join(".") : "(record)",
          i.message,
        ),
      ),
    };
  }
  const record = parsed.data;
  if (!idPrefixMatchesType(record.id, record.type)) {
    return {
      ok: false,
      issues: [
        issue(
          "type_voorvoegsel_mismatch",
          "fout",
          record.id,
          "id",
          `id-voorvoegsel hoort ${record.type}- te zijn bij type ${record.type}`,
        ),
      ],
    };
  }
  return { ok: true, record };
}

/** Alle uitgaande verwijzingen van een record, met het veldpad erbij. */
function referencesOf(
  record: KnowledgeRecord,
): readonly { readonly pad: string; readonly doel: string; readonly verwacht: RecordType | null }[] {
  switch (record.type) {
    case "DEC":
      return record.vervangt.map((doel, i) => ({
        pad: `vervangt[${i}]`,
        doel,
        verwacht: "DEC" as const,
      }));
    case "CON":
      return record.bron_besluit
        ? [{ pad: "bron_besluit", doel: record.bron_besluit, verwacht: "DEC" as const }]
        : [];
    case "CFL": {
      const refs = record.tussen.map((doel, i) => ({
        pad: `tussen[${i}]`,
        doel,
        verwacht: null,
      }));
      return record.opgelost_door
        ? [
            ...refs,
            { pad: "opgelost_door", doel: record.opgelost_door, verwacht: "DEC" as const },
          ]
        : refs;
    }
    default:
      return [];
  }
}

/**
 * Valideert een hele set: vorm per record én samenhang over de set.
 *
 * De uitvoer is deterministisch: records op id gesorteerd, bevindingen in
 * de volgorde waarin de controles draaien (eerst per record, daarna de
 * setbrede controles), zodat tests op exacte gelijkheid kunnen toetsen.
 */
export function validateRecordSet(inputs: readonly unknown[]): RecordSetValidation {
  const issues: ValidationIssue[] = [];
  const byId = new Map<string, KnowledgeRecord>();

  for (const input of inputs) {
    const result = validateRecord(input);
    if (!result.ok) {
      issues.push(...result.issues);
      continue;
    }
    const record = result.record;
    if (byId.has(record.id)) {
      issues.push(
        issue("dubbele_id", "fout", record.id, "id", `id ${record.id} komt meer dan één keer voor`),
      );
      continue;
    }
    byId.set(record.id, record);
  }

  const records = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const record of records) {
    for (const ref of referencesOf(record)) {
      if (ref.doel === record.id) {
        issues.push(
          issue("zelfverwijzing", "fout", record.id, ref.pad, `${record.id} verwijst naar zichzelf`),
        );
        continue;
      }
      const doel = byId.get(ref.doel);
      if (!doel) {
        issues.push(
          issue(
            "verwijzing_onbekend",
            "fout",
            record.id,
            ref.pad,
            `verwijst naar onbekend record ${ref.doel}`,
          ),
        );
        continue;
      }
      if (ref.verwacht && doel.type !== ref.verwacht) {
        issues.push(
          issue(
            "verwijzing_verkeerd_type",
            "fout",
            record.id,
            ref.pad,
            `${ref.doel} is een ${doel.type}-record, hier hoort ${ref.verwacht}`,
          ),
        );
        continue;
      }
      // Een besluit dat vervangen is, hoort niet meer "besloten" te staan.
      // Geen harde fout: het is een redactionele achterstand, geen datacorruptie.
      if (record.type === "DEC" && ref.pad.startsWith("vervangt") && doel.type === "DEC") {
        if (doel.status === "besloten" || doel.status === "voorgesteld") {
          issues.push(
            issue(
              "vervangen_besluit_nog_actief",
              "waarschuwing",
              record.id,
              ref.pad,
              `${doel.id} is vervangen maar staat nog op "${doel.status}"`,
            ),
          );
        }
      }
    }

    // Een open conflict is geen datafout, maar mag nooit stil blijven:
    // wie hierop context bouwt moet weten dat de kennis elkaar tegenspreekt.
    if (record.type === "CFL" && record.status === "open") {
      issues.push(
        issue(
          "conflict_open",
          "waarschuwing",
          record.id,
          "status",
          `onopgelost conflict tussen ${record.tussen.join(", ")}`,
        ),
      );
    }
  }

  // Deduplicatie op onderwerp. Twee actieve records over hetzelfde onderwerp
  // betekenen dat de kennisbasis zichzelf tegenspreekt zonder dat iemand dat
  // heeft vastgelegd — precies wat een agent later als "waarheid" zou lezen.
  const perOnderwerp = new Map<string, string[]>();
  for (const record of records) {
    if (record.type !== "DEC" && record.type !== "CON") continue;
    if (!record.onderwerp || !isActiefRecord(record)) continue;
    const bestaand = perOnderwerp.get(record.onderwerp) ?? [];
    bestaand.push(record.id);
    perOnderwerp.set(record.onderwerp, bestaand);
  }
  for (const [onderwerp, ids] of [...perOnderwerp.entries()].sort()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      issues.push(
        issue(
          "dubbel_onderwerp",
          "fout",
          id,
          "onderwerp",
          `onderwerp "${onderwerp}" is actief in meerdere records: ${ids.join(", ")}`,
        ),
      );
    }
  }

  return { ok: !issues.some((i) => i.severity === "fout"), records, issues };
}

/**
 * Geldt dit record nu nog? Vervangen/vervallen kennis blijft bestaan (de
 * historie is de waarde) maar mag nooit als geldende waarheid worden
 * aangeboden aan een agent.
 */
export function isActiefRecord(record: KnowledgeRecord): boolean {
  switch (record.type) {
    case "DEC":
      return record.status === "besloten" || record.status === "voorgesteld";
    case "CON":
      return record.status !== "vervallen";
    case "RSK":
      return record.status === "open" || record.status === "beheerst";
    case "CFL":
      return record.status === "open";
    case "LRN":
      return true;
  }
}

/** Alle vrije tekst van een record, in vaste veldvolgorde. */
export function recordTextFields(
  record: KnowledgeRecord,
): readonly { readonly veld: string; readonly tekst: string }[] {
  const gemeenschappelijk = [
    { veld: "titel", tekst: record.titel },
    { veld: "samenvatting", tekst: record.samenvatting },
    { veld: "tags", tekst: record.tags.join(" ") },
  ];
  switch (record.type) {
    case "DEC":
      return [
        ...gemeenschappelijk,
        { veld: "besluit", tekst: record.besluit },
        { veld: "motivatie", tekst: record.motivatie },
        { veld: "alternatieven", tekst: record.alternatieven.join(" ") },
        { veld: "gevolgen", tekst: record.gevolgen.join(" ") },
      ];
    case "CON":
      return [...gemeenschappelijk, { veld: "regel", tekst: record.regel }];
    case "LRN":
      return [
        ...gemeenschappelijk,
        { veld: "observatie", tekst: record.observatie },
        { veld: "les", tekst: record.les },
        { veld: "bewijs", tekst: record.bewijs.join(" ") },
      ];
    case "RSK":
      return [
        ...gemeenschappelijk,
        { veld: "beschrijving", tekst: record.beschrijving },
        { veld: "mitigatie", tekst: record.mitigatie },
      ];
    case "CFL":
      return [...gemeenschappelijk, { veld: "beschrijving", tekst: record.beschrijving }];
  }
}
