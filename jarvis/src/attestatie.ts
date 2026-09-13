// Attestatie: de poort geeft de goedkeurende review af namens de eigenaar.
//
// WAAROM
//
// De eigenaar autoriseert per taak, niet per pull request (DEC-0043). Zijn
// akkoord staat in de eigen database van Jarvis (schema jarvis, tabel
// autorisaties): alleen zijn ingelogde account kan daar een rij schrijven,
// niemand kan er een wijzigen of verwijderen. De ruleset op GitHub eist
// daarnaast een goedkeurende review van iemand anders dan de auteur. Die
// review is techniek: een attestatie dat het akkoord bestaat en dat deze PR
// erbinnen valt. Hij wordt afgegeven door de workflow `jarvis-attestatie.yml`
// met het kortlevende GITHUB_TOKEN van de run (identiteit github-actions[bot]).
//
// WAT ER GECONTROLEERD WORDT
//
// 1. De auteur is de bot en elke commit draagt dezelfde Jarvis-Task.
// 2. Er is een autorisatie van soort "taak" voor die taak, en de scope
//    (tasks/<T>/opdracht.md) is sinds dat akkoord niet veranderd: de hash op
//    de kop is gelijk aan de hash in de autorisatie.
// 3. Er is een toetsing met oordeel GO op precies de kop van de PR.
// 4. Geen harde uitzondering (DEC-0043 §2): de gewijzigde bestanden raken
//    geen workflows, CODEOWNERS, migraties, omgevingsbestanden, deployment-
//    of governanceconfiguratie of rolcontracten, en de PR-tekst verklaart
//    "Uitzonderingen: geen". Raakt de PR wél zoiets, dan is een autorisatie
//    van soort "pr" op precies deze kop vereist.
// 5. De poort is groen op de kop.
//
// Alles hier is puur; de I/O (GitHub, database) staat in opdrachten.ts.

import { createHash } from "node:crypto";
import { ATTESTATIE_GEBRUIKER, laatstePerNaam, type Check } from "./pr";

/** De identiteit waaronder de workflow de review afgeeft. */
export const ATTESTATIE_LOGIN = ATTESTATIE_GEBRUIKER;

/** Het vaste voorvoegsel van een attestatietekst; de rest wordt geparseerd. */
export const ATTESTATIE_VOORVOEGSEL = "Attestatie (DEC-0043):";

export type Autorisatie = {
  readonly id: string;
  readonly soort: "taak" | "pr";
  readonly project: string | null;
  readonly taak: string | null;
  readonly scope_hash: string | null;
  readonly pr_repo: string | null;
  readonly pr_nummer: number | null;
  readonly commit_sha: string | null;
  readonly op: string;
};

export type Toetsing = {
  readonly id: string;
  readonly pr_repo: string;
  readonly pr_nummer: number;
  readonly commit_sha: string;
  readonly oordeel: string;
  readonly rapport: string | null;
  readonly door: string;
  readonly op: string;
};

/**
 * De hash van de scope van een taak: SHA-256 over `tasks/<T>/opdracht.md`
 * met regeleindes genormaliseerd naar LF, zodat een checkout op Windows en
 * op Linux dezelfde hash geven. Wijzigt het bestand, dan wijzigt de hash en
 * vervalt het akkoord van de eigenaar op de oude scope.
 */
export function scopeHash(inhoud: string): string {
  return createHash("sha256").update(inhoud.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/**
 * Paden waarvan een wijziging altijd een aparte autorisatie vraagt
 * (DEC-0043 §2: productie, secrets, externe accounts, beveiliging,
 * governance). Bewust een korte, harde lijst en geen oordeel per geval.
 */
export const HARDE_UITZONDERINGEN: readonly { readonly patroon: RegExp; readonly waarom: string }[] = [
  { patroon: /^\.github\//, waarom: "workflows en repository-automatisering" },
  { patroon: /(^|\/)CODEOWNERS$/, waarom: "wie wat mag beoordelen" },
  { patroon: /(^|\/)migrations\//, waarom: "databasemigraties (productiedata)" },
  { patroon: /(^|\/)\.env(\.|$)/, waarom: "omgevingsbestanden" },
  { patroon: /^jarvis\.config\.yml$/, waarom: "governanceconfiguratie" },
  { patroon: /^jarvis\/allowlist\.yml$/, waarom: "de allowlist van de sanitizer" },
  { patroon: /^knowledge\/CONSTRAINTS\//, waarom: "harde randvoorwaarden" },
  { patroon: /^jarvis\/roles\//, waarom: "rolcontracten (mandaat)" },
  { patroon: /^jarvis\/canonical\//, waarom: "de canonieke poort- en attestatieworkflow" },
  { patroon: /^\.claude\//, waarom: "agentconfiguratie" },
];

/**
 * Welke gewijzigde bestanden onder een harde uitzondering vallen, met reden.
 * `extraPaden` komt uit jarvis.config.yml (attestatie.extra_paden): paden of
 * mapvoorvoegsels die in dít project productie, deployment of secrets raken
 * (de engine kent geen leveranciers, het project wel).
 */
export function raaktHardeUitzondering(bestanden: readonly string[], extraPaden: readonly string[] = []): readonly string[] {
  const treffers: string[] = [];
  for (const bestand of bestanden) {
    const pad = bestand.replace(/\\/g, "/");
    const regel = HARDE_UITZONDERINGEN.find((h) => h.patroon.test(pad));
    if (regel) {
      treffers.push(`${pad} (${regel.waarom})`);
      continue;
    }
    const extra = extraPaden.find((e) => pad === e || pad.startsWith(e.endsWith("/") ? e : `${e}/`));
    if (extra !== undefined) treffers.push(`${pad} (projectregel: ${extra})`);
  }
  return treffers;
}

/**
 * De verklaring van de orchestrator in de PR-tekst: een regel
 * `Uitzonderingen: geen` of `Uitzonderingen: <welke>`. Ontbreekt de regel,
 * dan is er niets verklaard en wordt er niet geattesteerd.
 */
export function leesUitzonderingenRegel(prTekst: string): "geen" | string | null {
  const m = /^\s*Uitzonderingen:\s*(.+?)\s*$/im.exec(prTekst.replace(/\r\n/g, "\n"));
  if (!m) return null;
  const waarde = (m[1] ?? "").trim();
  return waarde.toLowerCase() === "geen" ? "geen" : waarde;
}

/**
 * De Jarvis-Task-trailer van één commitboodschap: precies één. Geen trailer
 * of twee trailers geeft null — een commit die twee taken noemt, hoort bij
 * geen van beide.
 */
export function taakUitBoodschap(boodschap: string): string | null {
  const alle = [...boodschap.replace(/\r\n/g, "\n").matchAll(/^Jarvis-Task:\s*(\S+)\s*$/gm)].map((m) => m[1] ?? "");
  return alle.length === 1 ? alle[0]! : null;
}

/**
 * Eén taak voor de hele PR. Elke commit moet dezelfde Jarvis-Task dragen;
 * een PR die twee taken mengt is niet aan één akkoord te koppelen.
 */
export function taakUitCommits(
  commits: readonly { readonly sha: string; readonly boodschap: string }[],
): { readonly taak: string | null; readonly redenen: readonly string[] } {
  const redenen: string[] = [];
  const taken = new Set<string>();
  if (commits.length === 0) redenen.push("de pull request heeft geen commits");
  for (const c of commits) {
    const taak = taakUitBoodschap(c.boodschap);
    if (taak === null) redenen.push(`commit ${c.sha.slice(0, 7)} draagt geen of meer dan één Jarvis-Task-trailer`);
    else taken.add(taak);
  }
  if (taken.size > 1) redenen.push(`de commits horen bij meer dan één taak: ${[...taken].sort().join(", ")}`);
  const taak = taken.size === 1 && redenen.length === 0 ? [...taken][0]! : null;
  return { taak, redenen };
}

export type AttestatieFeiten = {
  readonly nummer: number;
  readonly auteur: string;
  readonly botLogin: string;
  readonly kop: string;
  readonly repo: string;
  readonly taak: string | null;
  readonly taakRedenen: readonly string[];
  /** De laatste autorisatie van soort "taak" voor deze taak, of null. */
  readonly autorisatieTaak: Autorisatie | null;
  /** De hash van tasks/<T>/opdracht.md op de kop, of null als het bestand ontbreekt. */
  readonly scopeHashKop: string | null;
  /** De toetsing met oordeel GO op de kop, of null. */
  readonly toetsing: Toetsing | null;
  readonly gewijzigdeBestanden: readonly string[];
  /** Projectpaden uit jarvis.config.yml die ook als harde uitzondering gelden. */
  readonly extraPaden?: readonly string[];
  readonly prTekst: string;
  /** Een autorisatie van soort "pr" op precies deze kop, of null. */
  readonly autorisatiePr: Autorisatie | null;
  readonly checks: readonly Check[];
  readonly verplichteCheck: string;
};

/** Waarom er nu niet geattesteerd wordt. Leeg betekent: attesteer. */
export function beoordeelAttestatie(f: AttestatieFeiten): readonly string[] {
  const redenen: string[] = [];

  if (f.auteur.toLowerCase() !== f.botLogin.toLowerCase()) {
    redenen.push(`de auteur is ${f.auteur}, niet de bot ${f.botLogin}; alleen werk van Jarvis wordt geattesteerd`);
  }
  redenen.push(...f.taakRedenen);
  if (f.taak === null && f.taakRedenen.length === 0) redenen.push("geen taak bekend voor deze pull request");
  if (f.gewijzigdeBestanden.length === 0) redenen.push("de pull request wijzigt geen bestanden; er is niets te attesteren");

  if (f.taak !== null) {
    if (f.autorisatieTaak === null) {
      redenen.push(`geen akkoord van de eigenaar op taak ${f.taak} in de database`);
    } else if (f.autorisatieTaak.soort !== "taak" || f.autorisatieTaak.taak !== f.taak) {
      redenen.push(`de gevonden autorisatie ${f.autorisatieTaak.id} is geen taakakkoord voor ${f.taak}`);
    } else if (f.scopeHashKop === null) {
      redenen.push(`tasks/${f.taak}/opdracht.md ontbreekt op de kop; zonder scope geen akkoord`);
    } else if (f.autorisatieTaak.scope_hash !== f.scopeHashKop) {
      redenen.push(
        `de scope van ${f.taak} is veranderd sinds het akkoord van ${f.autorisatieTaak.op} ` +
          `(akkoord op ${(f.autorisatieTaak.scope_hash ?? "?").slice(0, 12)}, kop ${f.scopeHashKop.slice(0, 12)}); opnieuw autoriseren`,
      );
    }
  }

  if (f.toetsing === null) {
    redenen.push(`geen toetsing met oordeel GO op de kop ${f.kop.slice(0, 7)}`);
  } else if (
    f.toetsing.oordeel !== "GO" ||
    f.toetsing.commit_sha !== f.kop ||
    f.toetsing.pr_repo.toLowerCase() !== f.repo.toLowerCase() ||
    f.toetsing.pr_nummer !== f.nummer
  ) {
    redenen.push(`de toetsing ${f.toetsing.id} hoort niet bij deze pull request op deze kop, of is geen GO`);
  }

  const treffers = raaktHardeUitzondering(f.gewijzigdeBestanden, f.extraPaden ?? []);
  const verklaring = leesUitzonderingenRegel(f.prTekst);
  const uitzondering = treffers.length > 0 || (verklaring !== null && verklaring !== "geen");
  if (verklaring === null) {
    redenen.push('de PR-tekst verklaart niets over uitzonderingen; zet er een regel "Uitzonderingen: geen" of "Uitzonderingen: <welke>" in');
  }
  if (uitzondering) {
    const ok =
      f.autorisatiePr !== null &&
      f.autorisatiePr.soort === "pr" &&
      (f.autorisatiePr.pr_repo ?? "").toLowerCase() === f.repo.toLowerCase() &&
      f.autorisatiePr.pr_nummer === f.nummer &&
      f.autorisatiePr.commit_sha === f.kop;
    if (!ok) {
      const wat = [...treffers, ...(verklaring !== null && verklaring !== "geen" ? [`verklaard: ${verklaring}`] : [])];
      redenen.push(`harde uitzondering (DEC-0043 §2) zonder apart akkoord van de eigenaar op deze kop: ${wat.join("; ")}`);
    }
  }

  const poort = laatstePerNaam(f.checks).filter((c) => c.naam === f.verplichteCheck);
  if (poort.length === 0) redenen.push(`de check "${f.verplichteCheck}" ontbreekt op de kop`);
  for (const c of poort) {
    if (c.status !== "completed") redenen.push(`de poort is nog niet klaar (${c.status})`);
    else if (c.conclusie !== "success") redenen.push(`de poort is niet geslaagd (${c.conclusie ?? "onbekend"})`);
  }

  return redenen;
}

export type AttestatieInhoud = {
  readonly autorisatie: string;
  readonly taak: string;
  readonly scope: string;
  readonly toetsing: string;
  readonly kop: string;
  readonly uitzonderingen: string;
};

/** De reviewtekst: één regel, machinaal te lezen en voor mensen leesbaar. */
export function attestatieTekst(i: AttestatieInhoud): string {
  return (
    `${ATTESTATIE_VOORVOEGSEL} autorisatie ${i.autorisatie} · taak ${i.taak} · scope ${i.scope} · ` +
    `toetsing ${i.toetsing} GO op ${i.kop} · uitzonderingen: ${i.uitzonderingen} · poort groen`
  );
}

/** Leest een attestatietekst terug. Null als het geen attestatie is. */
export function leesAttestatie(tekst: string): AttestatieInhoud | null {
  const eerste = tekst.replace(/\r\n/g, "\n").split("\n")[0] ?? "";
  if (!eerste.startsWith(ATTESTATIE_VOORVOEGSEL)) return null;
  const m =
    /^Attestatie \(DEC-0043\): autorisatie (\S+) · taak (\S+) · scope ([0-9a-f]{64}) · toetsing (\S+) GO op ([0-9a-f]{40}) · uitzonderingen: (.+?) · poort groen$/.exec(
      eerste,
    );
  if (!m) return null;
  return { autorisatie: m[1]!, taak: m[2]!, scope: m[3]!, toetsing: m[4]!, kop: m[5]!, uitzonderingen: m[6]! };
}

/**
 * Klopt een attestatie met wat de database zegt? Dit is de tweede,
 * onafhankelijke verificatie vóór het samenvoegen: de workflow schreef de
 * tekst, `jarvis pr mergen` leest de rijen zelf terug via jarvis_werker.
 */
export function verifieerAttestatie(
  inhoud: AttestatieInhoud,
  kop: string,
  autorisatie: Autorisatie | null,
  toetsing: Toetsing | null,
): readonly string[] {
  const redenen: string[] = [];
  if (inhoud.kop !== kop) redenen.push(`de attestatie hoort bij ${inhoud.kop.slice(0, 7)}, de kop is ${kop.slice(0, 7)}`);
  if (autorisatie === null) redenen.push(`autorisatie ${inhoud.autorisatie} bestaat niet in de database`);
  else if (autorisatie.soort !== "taak" || autorisatie.taak !== inhoud.taak) {
    redenen.push(`autorisatie ${inhoud.autorisatie} is geen taakakkoord voor ${inhoud.taak}`);
  } else if ((autorisatie.scope_hash ?? "") !== inhoud.scope) {
    redenen.push(`de scope in de attestatie wijkt af van de autorisatie`);
  }
  if (toetsing === null) redenen.push(`toetsing ${inhoud.toetsing} bestaat niet in de database`);
  else if (toetsing.oordeel !== "GO" || toetsing.commit_sha !== kop) {
    redenen.push(`toetsing ${inhoud.toetsing} is geen GO op de kop`);
  }
  return redenen;
}
