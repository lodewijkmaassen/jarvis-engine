// De onafhankelijke review door een tweede model (DEC-0045).
//
// Claude bouwt; een ander model leest het resultaat met alleen de relevante
// context (de pull request, het taakdossier, het contextpakket van de
// kennislaag) en zegt of het klopt: aannames, risico's, samenhang met eerdere
// besluiten, tegenstrijdigheden. Daarna hoogstens één gerichte
// correctieronde, nooit een gesprek tussen twee modellen.
//
// Dit bestand is de pure kant: de vragen opstellen, het antwoord lezen, de
// eigenaarstaal bewaken. Netwerk en database zitten in opdrachten.ts; het
// geheim (de API-sleutel van de leverancier) zit in de database (Vault) en
// komt de engine nooit in.
//
// Leverancier: elke dienst die het gangbare "chat completions"-formaat
// spreekt (de meeste modelleveranciers bieden het). De url staat als
// instelling in de database, het model is een vlag; de engine kent geen
// leveranciersnaam.

/** Wat de reviewer te lezen krijgt. Alleen wat voor het oordeel nodig is. */
export type ReviewInvoer = {
  readonly repo: string;
  readonly nummer: number;
  readonly kop: string;
  readonly titel: string;
  readonly beschrijving: string;
  /** De diff, bestand voor bestand (patch-tekst van de pull request). */
  readonly diff: readonly { readonly bestand: string; readonly status: string; readonly patch: string }[];
  /** De opdracht en acceptatiecriteria uit het taakdossier, als die er zijn. */
  readonly dossier: string | null;
  /** Het contextpakket uit de kennislaag (besluiten, randvoorwaarden, stand). */
  readonly context: string;
};

export type ReviewPunt = {
  readonly ernst: "hoog" | "midden" | "laag";
  readonly tekst: string;
  readonly bestand: string | null;
};

/** Het oordeel van de reviewer, zoals de engine het vastlegt. */
export type Review = {
  /** akkoord: zo kan het door; correctie: eerst de punten met ernst hoog herstellen. */
  readonly oordeel: "akkoord" | "correctie";
  readonly samenvatting: string;
  readonly punten: readonly ReviewPunt[];
  /** Twee zinnen voor de eigenaar, in gewone taal. */
  readonly conclusie_eigenaar: string;
};

/** Grenzen op wat er naar de reviewer gaat; een review is geen tweede bouwronde. */
export const REVIEW_LIMIETEN = {
  diffTekens: 60_000,
  patchPerBestand: 12_000,
  dossierTekens: 6_000,
  contextTekens: 24_000,
  beschrijvingTekens: 4_000,
} as const;

function kort(tekst: string, max: number): string {
  return tekst.length <= max ? tekst : `${tekst.slice(0, max)}\n… [afgekapt: ${tekst.length - max} tekens weggelaten]`;
}

export const REVIEW_SYSTEEM =
  "Je bent de onafhankelijke reviewer van Jarvis, het digitale team van een klein Nederlands softwarebedrijf. " +
  "Een ander model heeft het werk gebouwd; jij beoordeelt het als tweede paar ogen. Werk in het Nederlands. " +
  "Controleer: (1) of de wijziging doet wat de opdracht en de acceptatiecriteria vragen; (2) aannames die niet " +
  "onderbouwd zijn; (3) risico's (beveiliging, geheimen, gegevens, onomkeerbaarheid, kosten); (4) samenhang met " +
  "de meegegeven besluiten (DEC), randvoorwaarden (CON) en risico's (RSK) — noem een tegenstrijdigheid altijd met " +
  "het record-id; (5) tegenstrijdigheden binnen de wijziging zelf. Beoordeel alleen wat je krijgt; verzin geen " +
  "code of feiten die je niet ziet, en vraag niet om meer context. Wees concreet en kort: elk punt één zin, met " +
  "bestand waar dat kan. Geef 'correctie' alleen als een punt met ernst 'hoog' echt hersteld moet worden vóór " +
  "samenvoegen; stijl, smaak en optioneel verbeterwerk zijn 'laag' en geen reden voor 'correctie'. " +
  "Antwoord uitsluitend met één JSON-object, zonder tekst eromheen, in precies deze vorm: " +
  '{"oordeel":"akkoord"|"correctie","samenvatting":"<één alinea voor het team>","punten":[{"ernst":"hoog"|"midden"|"laag","tekst":"<één zin>","bestand":"<pad of null>"}],' +
  '"conclusie_eigenaar":"<hoogstens twee korte zinnen voor de eigenaar, gewone taal, geen jargon, geen technische namen, geen nummers van pull requests of commits>"}';

/** De vraag aan de reviewer: eerst wat gevraagd was, dan de kennis, dan de wijziging. */
export function bouwReviewVraag(invoer: ReviewInvoer): string {
  const delen: string[] = [];
  delen.push(`# Te beoordelen wijziging\n\nRepository: ${invoer.repo}, pull request #${invoer.nummer}, kop ${invoer.kop.slice(0, 7)}.\nTitel: ${invoer.titel}\n\n${kort(invoer.beschrijving.trim() || "(geen beschrijving)", REVIEW_LIMIETEN.beschrijvingTekens)}`);
  if (invoer.dossier !== null && invoer.dossier.trim().length > 0) {
    delen.push(`# Opdracht en acceptatiecriteria (taakdossier)\n\n${kort(invoer.dossier.trim(), REVIEW_LIMIETEN.dossierTekens)}`);
  }
  delen.push(`# Relevante kennis (besluiten, randvoorwaarden, stand)\n\n${kort(invoer.context.trim(), REVIEW_LIMIETEN.contextTekens)}`);
  let diff = "";
  for (const b of invoer.diff) {
    const stuk = `\n## ${b.bestand} (${b.status})\n\n\`\`\`diff\n${kort(b.patch, REVIEW_LIMIETEN.patchPerBestand)}\n\`\`\`\n`;
    if (diff.length + stuk.length > REVIEW_LIMIETEN.diffTekens) {
      diff += `\n## ${b.bestand} (${b.status})\n\n(patch weggelaten: de diff is groter dan ${REVIEW_LIMIETEN.diffTekens} tekens)\n`;
      continue;
    }
    diff += stuk;
  }
  delen.push(`# De wijziging (${invoer.diff.length} bestand(en))\n${diff || "\n(geen bestanden)"}`);
  return delen.join("\n\n");
}

/** De aanroep in het gangbare chat-completions-formaat; leveranciersonafhankelijk in vorm. */
export function bouwAanroep(model: string, vraag: string): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: "system", content: REVIEW_SYSTEEM },
      { role: "user", content: vraag },
    ],
    response_format: { type: "json_object" },
  };
}

/** De tekst van het antwoord uit een chat-completions-lading, of null. */
export function antwoordTekst(lading: unknown): string | null {
  const l = lading as { choices?: { message?: { content?: unknown } }[]; error?: { message?: unknown } } | null;
  const inhoud = l?.choices?.[0]?.message?.content;
  return typeof inhoud === "string" && inhoud.trim().length > 0 ? inhoud : null;
}

/** De foutmelding van de leverancier, zonder iets anders uit de lading. */
export function leverancierFout(lading: unknown): string | null {
  const l = lading as { error?: { message?: unknown; code?: unknown } } | null;
  const m = l?.error?.message;
  return typeof m === "string" ? m.slice(0, 300) : null;
}

const ERNSTEN = new Set(["hoog", "midden", "laag"]);

/** Leest het oordeel; verdraagt een JSON-blok in ```-hekken. Onleesbaar → string met de reden. */
export function parseerReview(tekst: string): Review | string {
  let t = tekst.trim();
  const hek = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  if (hek) t = hek[1] ?? t;
  let ruw: unknown;
  try {
    ruw = JSON.parse(t);
  } catch {
    return "het antwoord is geen JSON";
  }
  if (ruw === null || typeof ruw !== "object" || Array.isArray(ruw)) return "het antwoord is geen JSON-object";
  const r = ruw as Record<string, unknown>;
  const oordeel = r.oordeel === "akkoord" || r.oordeel === "correctie" ? r.oordeel : null;
  if (oordeel === null) return 'het veld "oordeel" is niet "akkoord" of "correctie"';
  const conclusie = typeof r.conclusie_eigenaar === "string" ? r.conclusie_eigenaar.trim() : "";
  if (!conclusie) return 'het veld "conclusie_eigenaar" ontbreekt';
  const punten: ReviewPunt[] = [];
  for (const p of Array.isArray(r.punten) ? r.punten : []) {
    if (p === null || typeof p !== "object") continue;
    const q = p as Record<string, unknown>;
    const ernst = typeof q.ernst === "string" && ERNSTEN.has(q.ernst) ? (q.ernst as ReviewPunt["ernst"]) : "midden";
    const tekstPunt = typeof q.tekst === "string" ? q.tekst.trim() : "";
    if (!tekstPunt) continue;
    punten.push({ ernst, tekst: tekstPunt.slice(0, 600), bestand: typeof q.bestand === "string" && q.bestand.trim() ? q.bestand.trim() : null });
  }
  // Correctie zonder een enkel hoog punt is geen correctie: dan is het akkoord met opmerkingen.
  const effectief = oordeel === "correctie" && !punten.some((p) => p.ernst === "hoog") ? "akkoord" : oordeel;
  return {
    oordeel: effectief,
    samenvatting: (typeof r.samenvatting === "string" ? r.samenvatting.trim() : "").slice(0, 2_000),
    punten,
    conclusie_eigenaar: conclusie.slice(0, 400),
  };
}

/** Het document-id in de eigen database: één review per pull request, ongeacht de kop. */
export function reviewDocumentId(repo: string, nummer: number): string {
  return `review/${repo}#${nummer}`;
}

/** Leesbare weergave voor de uitvoerder die de opdracht draait. */
export function rendereerReview(review: Review, meta: { readonly repo: string; readonly nummer: number; readonly kop: string; readonly model: string }): string {
  const regels: string[] = [];
  regels.push(`jarvis review: ${meta.repo}#${meta.nummer} op ${meta.kop.slice(0, 7)} — oordeel ${review.oordeel.toUpperCase()} (${meta.model}).`);
  if (review.samenvatting) regels.push(`  ${review.samenvatting}`);
  for (const p of review.punten) regels.push(`  - [${p.ernst}] ${p.tekst}${p.bestand ? ` (${p.bestand})` : ""}`);
  regels.push(`  Voor de eigenaar: ${review.conclusie_eigenaar}`);
  if (review.oordeel === "correctie") {
    regels.push("  Volgende stap: herstel uitsluitend de punten met ernst hoog in één commit op dezelfde branch; daarna geen tweede review (hoogstens één ronde).");
  }
  return regels.join("\n");
}

// ---------------------------------------------------------------------------
// Eigenaarstaal: wat de eigenaar in de app leest is kort, Nederlands en zonder
// technische namen. De technische bron blijft bewaard voor het team en de
// audit (context.technisch van het bericht). Dit is een deterministische
// wacht, geen stijladvies: een bericht dat een technische naam draagt wordt
// geweigerd tot de tekst is herschreven en de naam naar --technisch is verhuisd.
// ---------------------------------------------------------------------------

const TECHNISCHE_PATRONEN: readonly { readonly naam: string; readonly patroon: RegExp }[] = [
  { naam: "commit-sha", patroon: /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/ },
  { naam: "pull request", patroon: /\b(pull request|pull-request|PR ?#?\d+|#\d{1,5}\b)/i },
  { naam: "git-term", patroon: /\b(HEAD|mergecommit|merge-commit|force-push|branch(?!e)\w*|commit\w*|rebase\w*|checkout|repository|repo\b)/i },
  { naam: "poort-term", patroon: /\b(attestatie\w*|attesteer\w*|workflow\w*|pipeline|linter|typecheck|sanitize\w*|feitenblok)\b/i },
  { naam: "poort-term", patroon: /\bCI\b/ },
  { naam: "code-term", patroon: /\b(exitcode|exit code|stacktrace|stack trace|null\b|undefined\b|jsonb?\b|sql\b|migratie\w*|endpoint|webhook\w*)/i },
  { naam: "bestandspad", patroon: /\b[\w-]+\/[\w./-]+\.(ts|js|mjs|sql|md|json|yml|yaml|html)\b/ },
  { naam: "opdrachtregel", patroon: /\b(npx|npm|git|node)\s+\w/ },
];

/** Welke technische markers een tekst voor de eigenaar bevat; leeg als de tekst schoon is. */
export function technischeMarkers(tekst: string): readonly string[] {
  const gevonden: string[] = [];
  for (const { naam, patroon } of TECHNISCHE_PATRONEN) {
    const m = patroon.exec(tekst);
    if (m) gevonden.push(`${naam} ("${m[0].slice(0, 40)}")`);
  }
  return gevonden;
}

/** Hoe lang een bericht voor de eigenaar hoogstens is; langer is een verslag, geen bericht. */
export const EIGENAARSTAAL_MAX_TEKENS = 1_200;

/**
 * Beoordeelt een tekst voor de eigenaar. Null als hij door mag; anders de
 * reden, geformuleerd zodat de schrijver weet wat hij moet doen.
 */
export function eigenaarstaalBezwaar(tekst: string): string | null {
  const markers = technischeMarkers(tekst);
  if (markers.length > 0) {
    return (
      `de tekst bevat technische namen (${markers.join(", ")}). Schrijf voor de eigenaar in gewone taal wat er gebeurt, ` +
      `wat het resultaat is en of er iets van hem nodig is; zet de technische bron in --technisch (die blijft bewaard voor het team en de audit).`
    );
  }
  if (tekst.length > EIGENAARSTAAL_MAX_TEKENS) {
    return `de tekst is ${tekst.length} tekens; een bericht voor de eigenaar is hoogstens ${EIGENAARSTAAL_MAX_TEKENS}. Houd de conclusie kort en zet de details in --technisch.`;
  }
  return null;
}
