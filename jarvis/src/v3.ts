// Jarvis V3 — de pure kant: het mandaat tegen een pull request, de
// migratieroute en de dispatcher. Geen I/O; de CLI (v3-cli.ts) leest en schrijft.
//
// Eén beginsel: wat Jarvis binnen een door de eigenaar getekend mandaat doet,
// vraagt geen nieuwe toestemming; wat erbuiten valt, komt er niet door. De
// grens is machinaal en staat hier, in code die op `main` van de engine
// staat en door een pull request niet zelf aan te passen is (de poort draait
// altijd de versie van `main`).
import { HARDE_UITZONDERINGEN } from "./attestatie";

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

/** `**` = alles, ook over mappen heen; `*` = alles binnen één padsegment. */
export function globNaarRegex(glob: string): RegExp {
  let uit = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const metSlash = glob[i + 2] === "/";
        uit += metSlash ? "(?:.*/)?" : ".*";
        i += metSlash ? 2 : 1;
      } else uit += "[^/]*";
    } else if ("\\^$+?.()|{}[]".includes(c)) uit += `\\${c}`;
    else uit += c;
  }
  return new RegExp(`^${uit}$`);
}

export function padMatcht(pad: string, globs: readonly string[]): boolean {
  const p = pad.replace(/\\/g, "/").replace(/^\.\//, "");
  return globs.some((g) => globNaarRegex(g).test(p));
}

/** Pad waarvan het patroon een migratiebestand van het product is. */
export const MIGRATIE_PAD = /(^|\/)migrations\/[^/]+\.sql$/;

/** De harde uitzonderingen die ook een mandaat nooit opheft; migraties niet, die hangen aan `mandaat.migraties`. */
const ONOPHEFBAAR = HARDE_UITZONDERINGEN.filter((h) => !/migrations/.test(h.patroon.source));

export type MigratieOordeel = { readonly pad: string; readonly redenen: readonly string[] };

/**
 * Destructieve SQL herkennen. Bewust grof en conservatief: twijfel telt als
 * destructief. Alleen een mandaat met `destructief: true` laat zulke
 * migraties door; additief werk (tabel, kolom, index, functie) niet.
 */
export function destructieveSql(sql: string): readonly string[] {
  const kaal = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").toLowerCase();
  const treffers: string[] = [];
  const regels: readonly [RegExp, string][] = [
    [/\bdrop\s+(table|schema|column|view|index|function|type|policy|trigger|extension|role|database)\b/, "drop"],
    [/\btruncate\b/, "truncate"],
    [/\bdelete\s+from\b(?![^;]*\bwhere\b)/, "delete zonder where"],
    [/\bupdate\b[^;]*\bset\b(?![^;]*\bwhere\b)/, "update zonder where"],
    [/\balter\s+table\b[^;]*\b(drop|rename|alter\s+column[^;]*type)\b/, "alter die kolommen laat vallen, hernoemt of van type verandert"],
    [/\bdisable\s+row\s+level\s+security\b/, "rls uitzetten"],
    [/\b(revoke|grant)\b[^;]*\b(all|superuser|bypassrls)\b/, "brede rechten"],
    [/\bcreate\s+role\b|\balter\s+role\b/, "rollen"],
  ];
  for (const [r, naam] of regels) if (r.test(kaal)) treffers.push(naam);
  return treffers;
}

export function beoordeelMigraties(m: Mandaat, bestanden: readonly { readonly pad: string; readonly sql: string | null }[]): readonly MigratieOordeel[] {
  const uit: MigratieOordeel[] = [];
  for (const b of bestanden) {
    if (!MIGRATIE_PAD.test(b.pad.replace(/\\/g, "/"))) continue;
    const redenen: string[] = [];
    if (!m.migraties) redenen.push("het mandaat staat geen migraties toe (migraties: false)");
    if (b.sql === null) redenen.push("de inhoud van de migratie is niet te lezen");
    else if (!m.destructief) {
      const d = destructieveSql(b.sql);
      if (d.length > 0) redenen.push(`destructieve SQL zonder destructief-mandaat: ${d.join(", ")}`);
    }
    if (redenen.length > 0) uit.push({ pad: b.pad, redenen });
  }
  return uit;
}

export type V3PrFeiten = {
  readonly repo: string;
  readonly nummer: number;
  readonly kop: string;
  readonly auteur: string;
  readonly botLogin: string;
  readonly taken: readonly string[];
  readonly taakRedenen: readonly string[];
  readonly bestanden: readonly string[];
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
  if (f.bestanden.length === 0) r.push("de pull request wijzigt geen bestanden");

  for (const b of f.bestanden) {
    const pad = b.replace(/\\/g, "/");
    const onoverkomelijk = ONOPHEFBAAR.find((h) => h.patroon.test(pad));
    if (onoverkomelijk) {
      r.push(`${pad} raakt de veiligheidsgrens (${onoverkomelijk.waarom}); geen mandaat dekt dat`);
      continue;
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

/** Eindcontrole: de HTTP-meting van één criterium, puur beoordeeld. */
export function beoordeelHttpMeting(
  meting: Extract<Meting, { soort: "http" }>,
  antwoord: { readonly status: number; readonly tekst: string },
  verwachtBouwmerk: string | null,
): { readonly geslaagd: boolean; readonly bewijs: string } {
  if (antwoord.status !== 200) return { geslaagd: false, bewijs: `HTTP ${antwoord.status}` };
  if (meting.bevat !== undefined && !antwoord.tekst.includes(meting.bevat)) return { geslaagd: false, bewijs: `HTTP 200 maar de tekst "${meting.bevat}" ontbreekt` };
  if (meting.bouwmerk) {
    const m = /<meta\b[^>]*\bname\s*=\s*["']?jarvis-bouwmerk["']?[^>]*\bcontent\s*=\s*["']?([0-9a-f]{7,40})/i.exec(antwoord.tekst)
      ?? /<meta\b[^>]*\bcontent\s*=\s*["']?([0-9a-f]{7,40})["']?[^>]*\bname\s*=\s*["']?jarvis-bouwmerk/i.exec(antwoord.tekst);
    const gevonden = m?.[1] ?? null;
    if (gevonden === null) return { geslaagd: false, bewijs: "HTTP 200 maar geen jarvis-bouwmerk in de pagina" };
    if (verwachtBouwmerk === null || !(verwachtBouwmerk.startsWith(gevonden) || gevonden.startsWith(verwachtBouwmerk))) {
      return { geslaagd: false, bewijs: `bouwmerk ${gevonden} komt niet overeen met de uitgerolde commit ${verwachtBouwmerk ?? "?"}` };
    }
    return { geslaagd: true, bewijs: `HTTP 200, bouwmerk ${gevonden} = uitgerolde commit` };
  }
  return { geslaagd: true, bewijs: `HTTP 200${meting.bevat !== undefined ? `, bevat "${meting.bevat}"` : ""}` };
}
