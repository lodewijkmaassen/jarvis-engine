// Jarvis V3 — de pure kant: het mandaat tegen een pull request, de
// migratieroute en de dispatcher. Geen I/O; de CLI (v3-cli.ts) leest en schrijft.
//
// Eén beginsel: wat Jarvis binnen een door de eigenaar getekend mandaat doet,
// vraagt geen nieuwe toestemming; wat erbuiten valt, komt er niet door. De
// grens is machinaal en staat hier, in code die op `main` van de engine
// staat en door een pull request niet zelf aan te passen is (de poort draait
// altijd de versie van `main`).
import { HARDE_UITZONDERINGEN } from "./attestatie";
import { beoordeelSql, lexSql as lexSqlIntern, normaliseerMigratie as normaliseerIntern } from "./v3-sql";

export type Meting =
  | { readonly soort: "http"; readonly url: string; readonly bevat?: string; readonly bouwmerk?: boolean }
  | { readonly soort: "ci"; readonly check: string }
  | { readonly soort: "sql"; readonly vraag: string; readonly verwacht: unknown };

export type Criterium = { readonly id: string; readonly omschrijving: string; readonly meting: Meting };

export type Mandaat = {
  readonly taak_id?: string;
  readonly doel: string;
  readonly acceptatie: readonly Criterium[];
  readonly repos: readonly string[];
  readonly paden_ja: readonly string[];
  readonly paden_nee: readonly string[];
  readonly productie: boolean;
  readonly migraties: boolean;
  readonly destructief: boolean;
  readonly kosten_max_eur: number;
};

/** Eén padsegment tegen een patroon met `*` (alles binnen het segment); lineair-kwadratisch, zonder regex. */
function segmentMatcht(patroon: string, tekst: string): boolean {
  let rij: boolean[] = new Array<boolean>(tekst.length + 1).fill(false);
  rij[0] = true;
  for (let p = 0; p < patroon.length; p += 1) {
    const volgende: boolean[] = new Array<boolean>(tekst.length + 1).fill(false);
    if (patroon[p] === "*") {
      let ooit = false;
      for (let t = 0; t <= tekst.length; t += 1) {
        ooit = ooit || rij[t]!;
        volgende[t] = ooit;
      }
    } else {
      for (let t = 1; t <= tekst.length; t += 1) volgende[t] = rij[t - 1]! && patroon[p] === tekst[t - 1];
    }
    rij = volgende;
  }
  return rij[tekst.length]!;
}

/**
 * `**` als los segment = nul of meer mappen; `*` in een segment = alles binnen dat segment.
 * Een nieuwe regel of een ander vreemd teken in een bestandsnaam is gewoon een teken.
 * Bewust géén regex: een patroon uit een mandaat mag nooit een catastrofale terugloop kunnen veroorzaken.
 */
export function padMatchtGlob(pad: string, glob: string): boolean {
  const ps = glob.split("/");
  const ts = pad.split("/");
  const memo = new Map<number, boolean>();
  const rec = (i: number, j: number): boolean => {
    const sleutel = i * (ts.length + 1) + j;
    const bekend = memo.get(sleutel);
    if (bekend !== undefined) return bekend;
    let uit: boolean;
    if (i === ps.length) uit = j === ts.length;
    else if (ps[i] === "**") uit = rec(i + 1, j) || (j < ts.length && rec(i, j + 1));
    else uit = j < ts.length && segmentMatcht(ps[i]!, ts[j]!) && rec(i + 1, j + 1);
    memo.set(sleutel, uit);
    return uit;
  };
  return rec(0, 0);
}

export function padMatcht(pad: string, globs: readonly string[]): boolean {
  const p = pad.replace(/\\/g, "/").replace(/^\.\//, "");
  return globs.some((g) => padMatchtGlob(p, g));
}

/**
 * Alle paden die een bestandswijziging van GitHub raakt: het nieuwe pad én, bij een
 * hernoeming of kopie, het oude. `/pulls/{n}/files` geeft bij `renamed` alleen het
 * nieuwe pad in `filename`; het oude staat in `previous_filename`. Wie alleen
 * `filename` toetst, laat een bestand uit een beschermd pad naar elders verplaatsen.
 */
export function geraaktePaden(bestanden: readonly { readonly filename: string; readonly previous_filename?: string | null }[]): readonly string[] {
  const alle = new Set<string>();
  for (const b of bestanden) {
    alle.add(b.filename);
    if (typeof b.previous_filename === "string" && b.previous_filename.length > 0) alle.add(b.previous_filename);
  }
  return [...alle];
}

/** Pad waarvan het patroon een migratiebestand van het product is. */
export const MIGRATIE_PAD = /(^|\/)migrations\/[^/]+\.sql$/;

/**
 * De harde uitzonderingen die ook een mandaat nooit opheft; migraties niet, die hangen aan `mandaat.migraties`.
 * Daarbovenop de code en configuratie van de poort zelf. De sweep draait de gepinde engine uit
 * `node_modules`; wie `package.json`, het lockfile of `.npmrc` kan wijzigen, kan die poortcode
 * vervangen en zou zich dus zelf kunnen goedkeuren. Een wijziging daarvan vraagt altijd de
 * eigenaar, buiten het V3-mandaat om.
 */
export const V3_ONOPHEFBAAR: readonly { readonly patroon: RegExp; readonly waarom: string }[] = [
  ...HARDE_UITZONDERINGEN.filter((h) => !/migrations/.test(h.patroon.source)),
  { patroon: /(^|\/)jarvis\.config\.yml$/i, waarom: "governanceconfiguratie, waar ook in de boom" },
  { patroon: /^jarvis\/(src|edge|migrations|canonical|roles)\//, waarom: "de poortcode, de Edge Function en de V3-database zelf" },
  { patroon: /(^|\/)package(-lock)?\.json$/, waarom: "de pin van de poortcode (jarvis-engine) en alle afhankelijkheden" },
  { patroon: /(^|\/)\.npmrc$/, waarom: "npm-configuratie (bron van pakketten)" },
  { patroon: /(^|\/)npm-shrinkwrap\.json$/, waarom: "de pin van de poortcode" },
  { patroon: /^bin\//, waarom: "de ingang van de poortcode (bin/jarvis.mjs)" },
  { patroon: /(^|\/)tsconfig[^/]*\.json$/, waarom: "de TypeScript-configuratie waarmee de poortcode wordt geladen" },
];

export type MigratieOordeel = { readonly pad: string; readonly redenen: readonly string[] };

export { beoordeelSql, destructieveSql, lexSql, normaliseerMigratie, sqlTokens } from "./v3-sql";

export function beoordeelMigraties(
  m: Mandaat,
  bestanden: readonly { readonly pad: string; readonly sql: string | null }[],
  /** Het ledger (schema.tabel): een migratie mag zijn eigen administratie niet noemen, anders kan ze een latere migratie vooraf als 'al toegepast' boeken. */
  ledger = "",
): readonly MigratieOordeel[] {
  const ledgerNaam = ledger.split(".").pop()?.toLowerCase() ?? "";
  const uit: MigratieOordeel[] = [];
  for (const b of bestanden) {
    if (!MIGRATIE_PAD.test(b.pad.replace(/\\/g, "/"))) continue;
    const redenen: string[] = [];
    if (!m.migraties) redenen.push("het mandaat staat geen migraties toe (migraties: false)");
    if (b.sql === null) redenen.push("de inhoud van de migratie is niet te lezen");
    else {
      redenen.push(...beoordeelSql(b.sql, m.destructief).map((r) => `migratie: ${r}`));
      if (ledgerNaam !== "" && new RegExp(`\\b${ledgerNaam.replace(/[^a-z0-9_]/g, "")}\\b`).test(lexSqlIntern(normaliseerIntern(b.sql)).alles.toLowerCase())) redenen.push("migratie: noemt het ledger van de migratieroute");
    }
    if (redenen.length > 0) uit.push({ pad: b.pad, redenen });
  }
  return uit;
}

export type V3PrFeiten = {
  readonly repo: string;
  readonly nummer: number;
  readonly kop: string;
  /** De basisbranch van de pull request; alleen `main` telt als samenvoegen in productie. */
  readonly basis: string;
  readonly auteur: string;
  readonly botLogin: string;
  readonly taken: readonly string[];
  readonly taakRedenen: readonly string[];
  /** Alle geraakte paden, inclusief het oude pad bij hernoemen of kopiëren (zie geraaktePaden). */
  readonly bestanden: readonly string[];
  /** Projectspecifieke harde paden uit jarvis.config.yml (attestatie.extra_paden), van main. */
  readonly extraPaden?: readonly string[];
  readonly migratieBestanden: readonly { readonly pad: string; readonly sql: string | null }[];
  readonly mandaat: Mandaat | null;
  readonly taakToestand: string | null;
  readonly toetsingGoOpKop: boolean;
  readonly poortGroen: boolean;
  readonly prTekst: string;
};

/**
 * Waarom deze PR niet door het mandaat gedekt wordt. Leeg = de poort mag
 * goedkeuren (en, bij `productie`, samenvoegen).
 */
export function beoordeelV3Pr(f: V3PrFeiten): readonly string[] {
  const r: string[] = [];
  if (f.auteur.toLowerCase() !== f.botLogin.toLowerCase()) r.push(`de auteur is ${f.auteur}, niet de bot ${f.botLogin}`);
  r.push(...f.taakRedenen);
  if (f.taken.length !== 1) r.push(`een V3-pull request dient precies één taak (gevonden: ${f.taken.length})`);
  const taak = f.taken[0];
  if (taak !== undefined && !/^V3-\d{8}-[a-z0-9-]{2,40}$/.test(taak)) r.push(`${taak} is geen V3-taak`);
  if (f.mandaat === null) {
    r.push("geen mandaat voor deze taak");
    return r;
  }
  const m = f.mandaat;
  if (f.taakToestand !== null && !["UITVOEREN", "CONTROLE"].includes(f.taakToestand)) {
    r.push(`de taak staat in ${f.taakToestand}; alleen UITVOEREN of CONTROLE dekt een pull request`);
  }
  if (!m.repos.map((x) => x.toLowerCase()).includes(f.repo.toLowerCase())) r.push(`repo ${f.repo} valt buiten het mandaat`);
  if (f.basis !== "main") r.push(`de pull request gaat naar ${f.basis || "een onbekende branch"}, niet naar main; alleen samenvoegen in main telt als uitrollen`);
  if (f.bestanden.length === 0) r.push("de pull request wijzigt geen bestanden");

  for (const b of f.bestanden) {
    const pad = b.replace(/\\/g, "/");
    // Een pad met `..`, een leeg segment of een leidend `./` is geen pad dat git kent; wie zo'n pad aanlevert, probeert iets.
    if (pad.split("/").some((seg) => seg === ".." || seg === "." || seg === "") || /[\u0000-\u001f]/.test(pad)) {
      r.push(`${JSON.stringify(pad)} is geen normaal pad; geen mandaat dekt dat`);
      continue;
    }
    const onoverkomelijk = V3_ONOPHEFBAAR.find((h) => h.patroon.test(pad));
    if (onoverkomelijk) {
      r.push(`${pad} raakt de veiligheidsgrens (${onoverkomelijk.waarom}); geen mandaat dekt dat`);
      continue;
    }
    // Projectpaden uit de configuratie van main. Een migratie valt hier buiten: die hangt aan het
    // migratievlak van het mandaat (migraties/destructief) en wordt hieronder en in beoordeelMigraties getoetst.
    if (!MIGRATIE_PAD.test(pad)) {
      const extra = (f.extraPaden ?? []).find((e) => pad === e || pad.startsWith(e.endsWith("/") ? e : `${e}/`));
      if (extra !== undefined) {
        r.push(`${pad} raakt een projectregel (${extra}); geen mandaat dekt dat`);
        continue;
      }
    }
    if (padMatcht(pad, m.paden_nee)) {
      r.push(`${pad} staat in paden_nee van het mandaat`);
      continue;
    }
    if (MIGRATIE_PAD.test(pad)) {
      // Migraties vallen onder paden_ja én onder het migratievlak van het mandaat.
      if (!padMatcht(pad, m.paden_ja)) r.push(`${pad} valt buiten paden_ja`);
      continue;
    }
    if (!padMatcht(pad, m.paden_ja)) r.push(`${pad} valt buiten paden_ja van het mandaat`);
  }
  for (const o of beoordeelMigraties(m, f.migratieBestanden)) r.push(`migratie ${o.pad}: ${o.redenen.join("; ")}`);
  if (f.bestanden.some((b) => MIGRATIE_PAD.test(b.replace(/\\/g, "/"))) && f.migratieBestanden.length === 0) {
    r.push("een migratie is gewijzigd maar de inhoud is niet aangeleverd om te toetsen");
  }
  if (!f.toetsingGoOpKop) r.push(`geen onafhankelijke toetsing GO op de kop ${f.kop.slice(0, 7)}`);
  if (!f.poortGroen) r.push('de check "poort" is niet groen op de kop');
  return r;
}

/** Mag de poort na goedkeuring ook samenvoegen en uitrollen zonder verder akkoord? */
export function magUitrollen(m: Mandaat, bestanden: readonly string[]): { readonly samenvoegen: boolean; readonly reden: string } {
  if (!m.productie) return { samenvoegen: false, reden: "het mandaat heeft productie: false; de poort keurt goed, de eigenaar voegt niet automatisch samen" };
  void bestanden;
  return { samenvoegen: true, reden: "productie: true — samenvoegen en uitrollen vallen binnen het mandaat" };
}

// --------------------------------------------------------------- dispatcher

export type WerkRij = { readonly taak_id: string; readonly toestand: string; readonly reden: string };

/**
 * Moet de routine nu gestart worden? Alleen als er uitvoerbaar werk zonder
 * levende uitvoerder is, en de vorige start langer dan `rustMinuten` geleden
 * is (anders start elke cron-tik een tweede sessie bovenop een opstartende).
 */
export function dispatchBesluit(
  werk: readonly WerkRij[],
  laatsteStartIso: string | null,
  nu: Date,
  rustMinuten = 20,
): { readonly start: boolean; readonly reden: string } {
  const wacht = werk.filter((w) => w.reden.startsWith("uitvoerbaar"));
  if (wacht.length === 0) return { start: false, reden: "geen uitvoerbaar werk zonder uitvoerder" };
  if (laatsteStartIso !== null) {
    const min = (nu.getTime() - new Date(laatsteStartIso).getTime()) / 60_000;
    if (Number.isFinite(min) && min < rustMinuten) return { start: false, reden: `vorige start was ${Math.round(min)} min geleden (rust ${rustMinuten})` };
  }
  return { start: true, reden: `${wacht.length} taak/taken zonder uitvoerder: ${wacht.map((w) => w.taak_id).join(", ")}` };
}

/** Het bouwmerk (de commit) uit een uitgerolde pagina, of null. */
export function leesBouwmerkUitPagina(tekst: string): string | null {
  const m = /<meta\b[^>]*\bname\s*=\s*["']?jarvis-bouwmerk["']?[^>]*\bcontent\s*=\s*["']?([0-9a-f]{7,40})/i.exec(tekst)
    ?? /<meta\b[^>]*\bcontent\s*=\s*["']?([0-9a-f]{7,40})["']?[^>]*\bname\s*=\s*["']?jarvis-bouwmerk/i.exec(tekst);
  return m?.[1] ?? null;
}

/**
 * Eindcontrole: de HTTP-meting van één criterium, puur beoordeeld.
 *
 * Het bouwmerk moet de samenvoegcommit zijn, of een commit die daar op volgt: zodra `main` verder is
 * (een andere taak, een V2-merge) draait productie op een nazaat van die commit, en dat is dan nog
 * steeds de uitrol van deze taak. `isNazaat` wordt door de aanroeper bepaald (GitHub compare).
 */
export function beoordeelHttpMeting(
  meting: Extract<Meting, { soort: "http" }>,
  antwoord: { readonly status: number; readonly tekst: string },
  verwachtBouwmerk: string | null,
  isNazaat: (gevonden: string) => boolean = () => false,
): { readonly geslaagd: boolean; readonly bewijs: string } {
  if (antwoord.status !== 200) return { geslaagd: false, bewijs: `HTTP ${antwoord.status}` };
  if (meting.bevat !== undefined && !antwoord.tekst.includes(meting.bevat)) return { geslaagd: false, bewijs: `HTTP 200 maar de tekst "${meting.bevat}" ontbreekt` };
  if (meting.bouwmerk) {
    const gevonden = leesBouwmerkUitPagina(antwoord.tekst);
    if (gevonden === null) return { geslaagd: false, bewijs: "HTTP 200 maar geen jarvis-bouwmerk in de pagina" };
    if (verwachtBouwmerk !== null && (verwachtBouwmerk.startsWith(gevonden) || gevonden.startsWith(verwachtBouwmerk))) {
      return { geslaagd: true, bewijs: `HTTP 200, bouwmerk ${gevonden} = uitgerolde commit` };
    }
    if (verwachtBouwmerk !== null && isNazaat(gevonden)) {
      return { geslaagd: true, bewijs: `HTTP 200, bouwmerk ${gevonden} volgt op de samenvoegcommit ${verwachtBouwmerk.slice(0, 7)}` };
    }
    return { geslaagd: false, bewijs: `bouwmerk ${gevonden} komt niet overeen met de uitgerolde commit ${verwachtBouwmerk ?? "?"} en volgt er niet op` };
  }
  return { geslaagd: true, bewijs: `HTTP 200${meting.bevat !== undefined ? `, bevat "${meting.bevat}"` : ""}` };
}
