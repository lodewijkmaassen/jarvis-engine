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
  // De volgorde doet er niet toe: `raaktHardeUitzondering` en
  // `soortenHardeUitzondering` verzamelen *alle* patronen die een pad raakt,
  // niet de eerste. Dat was eerst wel zo, en het was een gat: `.github/`
  // matcht ook `.github/.env`, `.github/migrations/`, `.github/CON-*.md` en
  // `.github/constraints/`, dus een taak die alleen "workflows" aankondigde
  // kreeg er een staand mandaat op secrets, productiedata en
  // governance-records bij — drie van de vier soorten die DEC-0043 §2 bij
  // naam noemt. Het is één keer per patroon gerepareerd door CODEOWNERS naar
  // voren te halen; dat behandelde het symptoom. Nu telt elk patroon mee, en
  // moet een taak elke geraakte soort afzonderlijk aankondigen.
  { patroon: /(^|\/)CODEOWNERS$/, waarom: "wie wat mag beoordelen" },
  { patroon: /^\.github\//, waarom: "workflows en repository-automatisering" },
  { patroon: /(^|\/)migrations\//, waarom: "databasemigraties (productiedata)" },
  { patroon: /(^|\/)\.env(\.|$)/, waarom: "omgevingsbestanden" },
  { patroon: /^jarvis\.config\.yml$/, waarom: "governanceconfiguratie" },
  { patroon: /^jarvis\/allowlist\.yml$/, waarom: "de allowlist van de sanitizer" },
  { patroon: /(^|\/)constraints\//i, waarom: "harde randvoorwaarden" },
  { patroon: /(^|\/)CON-[^/]*\.md$/i, waarom: "een randvoorwaarde-record, waar het ook staat" },
  { patroon: /^jarvis\/roles\//, waarom: "rolcontracten (mandaat)" },
  { patroon: /^jarvis\/canonical\//, waarom: "de canonieke poort- en attestatieworkflow" },
  // De code die de autorisatie zélf beoordeelt. Zonder deze regel verdwijnt het
  // laatste moment waarop een mens die diff ziet, zodra de workflow ook mag
  // samenvoegen: een pull request die alleen deze bestanden wijzigt raakte geen
  // enkele harde uitzondering, werd dus door de poort zelf geattesteerd en
  // samengevoegd, en elke volgende levering werd daarna door de gewijzigde code
  // beoordeeld. Niet in één stap — de beslissende code draait van de
  // hoofdbranch, dus een pull request keurt zichzelf niet goed — maar wel in
  // twee. Gemeten op 2026-10-02 in deze repository: `jarvis/src/` staat niet in
  // `extra_paden`, en de beveiliging van de hoofdbranch dwingt review door de
  // code-eigenaar niet af.
  { patroon: /^jarvis\/src\/(attestatie|pr)\.ts$/, waarom: "de code die de autorisatie beoordeelt" },
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
    const regels = HARDE_UITZONDERINGEN.filter((h) => h.patroon.test(pad));
    if (regels.length > 0) {
      for (const regel of regels) treffers.push(`${pad} (${regel.waarom})`);
      continue;
    }
    const extra = extraPaden.find((e) => pad === e || pad.startsWith(e.endsWith("/") ? e : `${e}/`));
    if (extra !== undefined) treffers.push(`${pad} (projectregel: ${extra})`);
  }
  return treffers;
}

/**
 * De soorten harde uitzondering die een lijst bestanden raakt.
 *
 * `raaktHardeUitzondering` geeft leesbare treffers ("pad (waarom)"); hier
 * gaat het om de sóórt, zodat een dossier er vooraf mandaat voor kan geven.
 * De sleutels zijn de `waarom`-teksten van `HARDE_UITZONDERINGEN`, en voor
 * een projectpad `projectregel: <pad>`.
 */
export function soortenHardeUitzondering(
  bestanden: readonly string[],
  extraPaden: readonly string[] = [],
): readonly string[] {
  const soorten = new Set<string>();
  for (const bestand of bestanden) {
    const pad = bestand.replace(/\\/g, "/");
    const regels = HARDE_UITZONDERINGEN.filter((h) => h.patroon.test(pad));
    if (regels.length > 0) {
      for (const regel of regels) soorten.add(regel.waarom);
      continue;
    }
    const extra = extraPaden.find((e) => pad === e || pad.startsWith(e.endsWith("/") ? e : `${e}/`));
    if (extra !== undefined) soorten.add(`projectregel: ${extra}`);
  }
  return [...soorten];
}

/**
 * Welke soorten een taak mag raken op grond van haar eigen goedgekeurde
 * opdracht.
 *
 * Alleen taken waarvan het akkoord op deze kop geldig is tellen mee: zonder
 * autorisatie, of met een scope die sinds het akkoord is veranderd, geeft het
 * dossier geen mandaat. Daarmee kan een pull request zijn eigen mandaat niet
 * schrijven — hij zou de hash veranderen en het akkoord laten vervallen.
 */
export function gemandateerdeUitzonderingen(taken: readonly TaakFeiten[]): readonly string[] {
  // Eén taak, of geen mandaat. Bij meer taken in één pull request is niet te
  // zien welk bestand bij welke taak hoort, en dan zou de aankondiging van de
  // ene de andere dekken — een mandaat dat haar dossier nooit noemde. Liever
  // terug naar het aparte akkoord dan een dekking die niemand heeft gegeven.
  if (taken.length !== 1) return [];
  const t = taken[0]!;
  const geldig =
    t.autorisatie !== null &&
    t.autorisatie.soort === "taak" &&
    t.autorisatie.taak === t.taak &&
    t.scopeHashKop !== null &&
    t.autorisatie.scope_hash === t.scopeHashKop;
  if (!geldig) return [];
  // Alleen soorten die werkelijk bestaan. Een typefout in het dossier levert
  // dan geen stil nutteloos mandaat op maar gewoon geen dekking, en de
  // weigering noemt de soort die ontbreekt.
  const bekend = new Set<string>(HARDE_UITZONDERINGEN.map((h) => h.waarom));
  const soorten = new Set<string>();
  for (const ruw of t.aangekondigdeUitzonderingen ?? []) {
    const soort = ruw.trim();
    if (bekend.has(soort) || soort.startsWith("projectregel: ")) soorten.add(soort);
  }
  return [...soorten];
}

/**
 * De enige regel `Uitzonderingen:` die bij deze bestanden hoort.
 *
 * Waarom een vaste vorm en geen vrije tekst: de verklaring is het énige
 * kanaal voor een uitzondering zónder bestandspad — een productieactie, een
 * sleutelrotatie, een extern account. Zonder deze vergelijking lift zo'n
 * verklaring mee op een gemandateerde treffer: een pull request die een
 * aangekondigde workflow wijzigt én in zijn tekst een sleutelrotatie
 * aankondigt, zou zonder enig akkoord worden geattesteerd. Gemeten op #78.
 *
 * Met deze vorm kan het mandaat alleen dekken wat ook werkelijk uit de
 * bestanden volgt; alles wat de tekst daarbovenop beweert wijkt af en valt
 * terug op een apart akkoord.
 */
export function verwachteUitzonderingenRegel(geraakt: readonly string[]): string {
  return geraakt.length === 0 ? "geen" : [...geraakt].sort().join("; ");
}

/** Vergelijkt verklaring en verwachting zonder te struikelen over spaties of hoofdletters. */
function zelfdeVerklaring(a: string, b: string): boolean {
  const normaal = (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase().replace(/[.;]+$/, "");
  return normaal(a) === normaal(b);
}

/**
 * De verklaring van de orchestrator in de PR-tekst: een regel
 * `Uitzonderingen: geen` of `Uitzonderingen: <welke>`. Ontbreekt de regel,
 * dan is er niets verklaard en wordt er niet geattesteerd.
 */
export function leesUitzonderingenRegel(prTekst: string): "geen" | string | null {
  // Álle regels, niet de eerste. Deze regel is sinds het mandaat uit de taak
  // dragend voor de autorisatie, en met alleen de eerste treffer was zij te
  // omzeilen door de juiste verklaring vooraan te zetten en de werkelijke
  // uitzondering — een sleutelrotatie, een productieactie — verderop in de
  // tekst. De uitkomst hing dan af van de volgorde in de PR-tekst
  // (QA-bevinding op #78, tweede ronde).
  //
  // Meer dan één verschillende regel is geen keuze maar een weigering: welke
  // van de twee zou gelden? Herhalingen die alleen in kast verschillen mogen,
  // want die beweren hetzelfde. Let op: de ontdubbeling vergelijkt op kleine
  // letters en niet op de ruimere normalisatie van `zelfdeVerklaring`, dus
  // een herhaling die alleen in witruimte of een sluitende punt afwijkt telt
  // als een tweede bewering en weigert. Dat is streng maar fail-closed.
  // Alles wat géén letter is mag ervóór staan: `#`, `>`, `-`, `*`, `+`, een
  // nummer met punt of haakje, een tabelstreep, het begin van een
  // HTML-commentaar, witruimte. Een eerdere, smallere tekenklasse liet
  // `## Uitzonderingen: …` en `1. Uitzonderingen: …` onzichtbaar blijven, en
  // daarmee kwam de meelifter van hierboven gewoon terug in een andere
  // opmaak. Proza ervóór matcht niet, want dat bevat letters.
  const alle = [...prTekst.replace(/\r\n/g, "\n").matchAll(/^[^A-Za-z\n]*Uitzonderingen:[ \t]*(.+?)[ \t]*$/gim)].map((m) =>
    (m[1] ?? "").trim(),
  );
  if (alle.length === 0) return null;
  const uniek = [...new Set(alle.map((w) => w.toLowerCase()))];
  if (uniek.length > 1) return alle.join(" / ");
  const waarde = alle[0]!;
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
 * De taken van een PR: elke werkcommit draagt precies één Jarvis-Task; samen
 * mogen ze meer dan één taak noemen. Elke genoemde taak vraagt dan zijn
 * eigen akkoord (DEC-0043): een PR die twee taken dient, is pas gedekt als
 * de eigenaar op beide akkoord gaf.
 *
 * Een mergecommit (twee of meer ouders) is geen werk maar het binnenhalen
 * van al geattesteerde inhoud van de hoofdbranch; die hoeft geen trailer.
 * Wat hij eventueel aan conflictoplossing bevat, zit in de diff van de kop
 * die de toetsing beoordeelt. Zonder ouders-informatie (oude aanroeper)
 * geldt de strenge regel voor elke commit.
 */
export function takenUitCommits(
  commits: readonly { readonly sha: string; readonly boodschap: string; readonly ouders?: number }[],
): { readonly taken: readonly string[]; readonly redenen: readonly string[] } {
  const redenen: string[] = [];
  const taken = new Set<string>();
  const werk = commits.filter((c) => (c.ouders ?? 1) < 2);
  if (commits.length === 0) redenen.push("de pull request heeft geen commits");
  else if (werk.length === 0) redenen.push("de pull request bevat alleen mergecommits en geen werk");
  for (const c of werk) {
    const taak = taakUitBoodschap(c.boodschap);
    if (taak === null) redenen.push(`commit ${c.sha.slice(0, 7)} draagt geen of meer dan één Jarvis-Task-trailer`);
    else taken.add(taak);
  }
  return { taken: [...taken].sort(), redenen };
}

/**
 * Een administratieve pull request raakt uitsluitend dossiers, kennisrecords
 * (niet de randvoorwaarden), de kennisindex en het feitenblok. Dat is werk
 * van klasse A dat de poort zelf toetst (lint, index, state, sanitize); de
 * eigenaar tekent er niet voor (DEC-0044). De patronen komen van de
 * aanroeper, uit de configuratie van de repository.
 */
export function isAdministratief(bestanden: readonly string[], patronen: readonly RegExp[]): boolean {
  if (bestanden.length === 0 || patronen.length === 0) return false;
  return bestanden.every((b) => patronen.some((p) => p.test(b.replace(/\\/g, "/"))));
}

/** Per taak van de PR: het akkoord en de scope op de kop. */
export type TaakFeiten = {
  readonly taak: string;
  /** De laatste autorisatie van soort "taak" voor deze taak, of null. */
  readonly autorisatie: Autorisatie | null;
  /** De hash van tasks/<T>/opdracht.md op de kop, of null als het bestand ontbreekt. */
  readonly scopeHashKop: string | null;
  /**
   * De soorten harde uitzondering die het dossier van deze taak zélf
   * aankondigt, uit de front-matter `uitzonderingen:` van `opdracht.md`.
   *
   * Dit is het mandaat waar `DEC-0043` §2 om vraagt, maar vooraf en in één
   * keer. Een taak die in haar opdracht zegt dat zij workflows en
   * governanceconfiguratie raakt, is door de eigenaar mét die aankondiging
   * goedgekeurd; zijn akkoord dekt dan precies die soorten, en elke pull
   * request binnen die taak hoeft er niet opnieuw om te vragen.
   *
   * Waarom dat niet te misbruiken is: deze lijst staat ín `opdracht.md`, en
   * de scope-hash is SHA-256 over dat hele bestand. Wie er een soort bij zet,
   * verandert de hash en laat het akkoord vervallen. Het mandaat kan dus
   * alleen groeien doordat de eigenaar opnieuw goedkeurt — en daarmee is het
   * nog steeds hij die beslist, alleen één keer per taak in plaats van één
   * keer per pull request.
   */
  readonly aangekondigdeUitzonderingen?: readonly string[];
};

export type AttestatieFeiten = {
  readonly nummer: number;
  readonly auteur: string;
  readonly botLogin: string;
  /** Andere logins waaronder Jarvis opent (de platform-identiteit van de cloud-uitvoerder). */
  readonly uitvoerders?: readonly string[];
  readonly kop: string;
  readonly repo: string;
  readonly taken: readonly TaakFeiten[];
  readonly taakRedenen: readonly string[];
  /** De toetsing met oordeel GO op de kop, of null. */
  readonly toetsing: Toetsing | null;
  readonly gewijzigdeBestanden: readonly string[];
  /** Projectpaden uit jarvis.config.yml die ook als harde uitzondering gelden. */
  readonly extraPaden?: readonly string[];
  /** Patronen van administratieve paden (dossiers, kennis, feitenblok); leeg = geen administratieve route. */
  readonly administratiefPaden?: readonly RegExp[];
  /**
   * Patroon van het bestand waarop het akkoord van de eigenaar rust, meestal
   * `tasks/<taak>/opdracht.md`. Ontbreekt het, dan geldt de oude regel en is
   * elke wijziging eronder gewoon administratief.
   */
  readonly scopeBestandPatroon?: RegExp;
  /**
   * Per gewijzigd bestand de status die GitHub geeft (`added`, `modified`,
   * `renamed`, `removed`). Een bestand dat hier ontbreekt telt als gewijzigd:
   * onbekend mag nooit de soepelste uitkomst opleveren.
   */
  readonly bestandStatus?: Readonly<Record<string, string>>;
  /**
   * Scope-bestanden waarvan de wijziging aantoonbaar alléén de statusregel in
   * de front-matter raakt. Die telt niet als herschrijven: een taak sluiten of
   * op `review` zetten is boekhouding, geen nieuwe tekst. Zonder deze
   * uitzondering zou `administratief afsluiten` — wat de rol uitdrukkelijk
   * zelf moet kunnen — een akkoord van de eigenaar vragen.
   */
  readonly alleenStatusregel?: readonly string[];
  readonly prTekst: string;
  /** Een autorisatie van soort "pr" op precies deze kop, of null. */
  readonly autorisatiePr: Autorisatie | null;
  readonly checks: readonly Check[];
  readonly verplichteCheck: string;
};

/**
 * De bestanden in deze pull request die de tekst *herschrijven* waarop het
 * akkoord van de eigenaar rust. Een nieuw dossier telt niet mee: dat voegt een
 * tekst toe die nog niemand heeft goedgekeurd en die niets mandateert zolang
 * de eigenaar er geen akkoord op geeft. Een bestaand dossier wijzigen is iets
 * anders — dat verandert waar een gegeven akkoord over gaat.
 *
 * Waarom dit bestaat. `DEC-0044` laat een administratieve pull request door
 * zonder taakakkoord, zonder scopevergelijking én zonder onafhankelijke
 * toetsing, en `tasks/` viel daar volledig onder. Daarmee kon Jarvis de
 * opdrachttekst van een lopende taak herschrijven — de acceptatiecriteria, en
 * sinds de aankondiging van harde uitzonderingen ook de omvang van zijn eigen
 * mandaat — met een goedkeuring van de poort zelf en zonder dat er één mens of
 * één toetsing naar keek. Gemeten op 2026-10-02 in een consumentproject: een
 * pull request die precies dat deed, kreeg de review `taken administratief ·
 * autorisaties - · scope - · toetsing -`.
 *
 * Wat het *niet* was: een weg om stiekem mandaat te winnen. Zodra de tekst
 * verandert, klopt de hash in het akkoord niet meer en vervalt het akkoord —
 * dus zo'n samenvoeging kost Jarvis zijn mandaat in plaats van het te
 * verruimen, en de eigenaar ziet de nieuwe tekst voordat hij opnieuw
 * autoriseert. Het gat zit in wat eraan voorafgaat: de tekst waarop hij
 * straks tikt, is zonder toetsing en zonder zijn medeweten geschreven.
 */
export function herschrevenScope(f: AttestatieFeiten): readonly string[] {
  // Ontbreekt het patroon, dan valt deze controle terug op een eigen,
  // bewust ruime vorm — niet op "niets". Dicht falen hoort hier: wie het
  // patroon vergeet mee te geven, krijgt een strengere uitkomst en geen
  // soepelere. Een eerdere versie gaf hier een lege lijst terug, en dat was
  // in tegenspraak met de regel drie regels verderop.
  const patroon = f.scopeBestandPatroon ?? /(^|\/)opdracht\.md$/i;
  const status = f.bestandStatus ?? {};
  const alleenStatus = new Set(f.alleenStatusregel ?? []);
  return f.gewijzigdeBestanden.filter((b) => {
    const pad = b.replace(/\\/g, "/");
    if (!patroon.test(pad)) return false;
    if (alleenStatus.has(b) || alleenStatus.has(pad)) return false;
    return (status[b] ?? status[pad] ?? "modified") !== "added";
  });
}

/** De statuswoorden die de front-matter van een taakdossier kent. */
const TAAK_STATUSSEN = new Set(["nieuw", "actief", "review", "afgerond", "vervallen", "geblokkeerd"]);

/**
 * Verschilt deze versie van een taakdossier van de vorige in niets dan de
 * regel `status:` in de front-matter?
 *
 * Dit bestaat omdat de taakstatus nu eenmaal ín `opdracht.md` staat, en het
 * sluiten van een dossier daarmee een wijziging van de scope-tekst is. Dat is
 * boekhouding en geen herschrijving: de opdracht, de afbakening en de
 * acceptatiecriteria blijven woord voor woord gelijk. Zonder deze uitzondering
 * zou elke afsluiting een akkoord van de eigenaar vragen, terwijl
 * "administratief afsluiten" juist hoort bij wat Jarvis zelf doet.
 *
 * De uitzondering is *richtingloos*: `afgerond → actief` gaat er net zo goed
 * doorheen als `actief → afgerond`. Dat is bewust, want een taak heropenen is
 * even administratief als haar sluiten, maar er hangt een gevolg aan dat hier
 * hoort te staan. Omdat het akkoord aan de hash van het hele bestand hangt,
 * brengt het terugdraaien van een statusregel een hash terug die de eigenaar
 * ooit heeft getekend — en daarmee leeft dat akkoord weer. **Een
 * statuswijziging is dus geen intrekkingsmechanisme**, en wie een akkoord wil
 * intrekken moet dat langs de autorisatie doen, niet langs de status.
 *
 * Streng gelezen: evenveel regels, alle andere regels identiek, de
 * veranderende regel moet aan beide kanten een `status:` in de front-matter
 * zijn, en de nieuwe waarde moet een bekend statuswoord zijn. Alles daarbuiten
 * — een regel erbij, een andere sleutel, een status die niet bestaat — telt
 * gewoon als herschrijven.
 */
export function alleenStatusVerschil(oud: string, nieuw: string): boolean {
  const regelsOud = oud.replace(/\r\n/g, "\n").split("\n");
  const regelsNieuw = nieuw.replace(/\r\n/g, "\n").split("\n");
  if (regelsOud.length !== regelsNieuw.length) return false;
  if (regelsOud[0] !== "---" || regelsNieuw[0] !== "---") return false;
  const eind = regelsNieuw.indexOf("---", 1);
  if (eind < 1) return false;
  // Het blok tussen de strepen moet er ook werkelijk als front-matter
  // uitzien: louter sleutels en lijstitems. Alleen de twee `---` tellen was
  // niet genoeg, en dat was een lek. Een dossier met een lege regel en vrije
  // tekst tussen die strepen — dus met een front-matter die geen front-matter
  // is — liet een regel `status: actief` middenin de hoofdtekst als
  // front-matter gelden, en die mocht dan vrij veranderen. Een nieuw dossier
  // aanmaken is administratief, dus Jarvis kon zo'n bestand zelf neerzetten
  // en het later langs deze uitzondering herschrijven.
  //
  // Dat de twee versies hun streep op dezelfde regel hebben, volgt hieruit en
  // uit de regelteller: verschilt de plaats van een `---`, dan is die regel
  // zelf het verschil, en dan is zij aan één kant geen `status:`-regel.
  for (const regels of [regelsOud, regelsNieuw]) {
    for (let i = 1; i < eind; i += 1) {
      const regel = regels[i] ?? "";
      if (!/^[A-Za-z_][A-Za-z0-9_-]*:/.test(regel) && !/^\s+-\s+\S/.test(regel)) return false;
    }
  }
  let gezien = 0;
  for (let i = 0; i < regelsOud.length; i += 1) {
    if (regelsOud[i] === regelsNieuw[i]) continue;
    if (i >= eind) return false;
    const a = /^status:\s*(\S+)\s*$/.exec(regelsOud[i] ?? "");
    const b = /^status:\s*(\S+)\s*$/.exec(regelsNieuw[i] ?? "");
    if (a === null || b === null) return false;
    if (!TAAK_STATUSSEN.has(b[1]!)) return false;
    gezien += 1;
  }
  return gezien === 1;
}

/** Is deze PR administratief (DEC-0044)? Dan is er geen taakakkoord en geen toetsing nodig. */
export function isAdministratievePr(f: AttestatieFeiten): boolean {
  return (
    isAdministratief(f.gewijzigdeBestanden, f.administratiefPaden ?? []) &&
    raaktHardeUitzondering(f.gewijzigdeBestanden, f.extraPaden ?? []).length === 0 &&
    herschrevenScope(f).length === 0
  );
}

/**
 * Ligt er een apart akkoord van de eigenaar op precies deze pull request en
 * deze kop (`DEC-0043` §2)? Dit stond eerder alleen inline bij de harde
 * uitzonderingen; het staat hier omdat een herschreven opdrachttekst dezelfde
 * uitweg hoort te hebben en die anders niet bestaat.
 */
export function akkoordOpDezeKop(f: AttestatieFeiten): boolean {
  return (
    f.autorisatiePr !== null &&
    f.autorisatiePr.soort === "pr" &&
    (f.autorisatiePr.pr_repo ?? "").toLowerCase() === f.repo.toLowerCase() &&
    f.autorisatiePr.pr_nummer === f.nummer &&
    f.autorisatiePr.commit_sha === f.kop
  );
}

/** Waarom er nu niet geattesteerd wordt. Leeg betekent: attesteer. */
export function beoordeelAttestatie(f: AttestatieFeiten): readonly string[] {
  const redenen: string[] = [];

  const vanJarvis = [f.botLogin, ...(f.uitvoerders ?? [])].some((l) => l.toLowerCase() === f.auteur.toLowerCase());
  if (!vanJarvis) {
    redenen.push(`de auteur is ${f.auteur}, niet de bot ${f.botLogin}; alleen werk van Jarvis wordt geattesteerd`);
  }
  redenen.push(...f.taakRedenen);
  if (f.gewijzigdeBestanden.length === 0) redenen.push("de pull request wijzigt geen bestanden; er is niets te attesteren");

  const administratief = isAdministratievePr(f);
  const herschreven = herschrevenScope(f);
  // De uitweg moet werkelijk bestaan. Deze reden stond er onvoorwaardelijk, en
  // daarmee kon een herschreven opdrachttekst nóóit machinaal worden
  // geattesteerd — ook niet met het aparte akkoord dat de tekst eromheen
  // belooft. Veilig, maar niet wat er staat, en een belofte die de code niet
  // waarmaakt is erger dan geen belofte.
  if (herschreven.length > 0 && !akkoordOpDezeKop(f)) {
    redenen.push(
      `deze pull request herschrijft ${herschreven.join(", ")} — de tekst waarop het akkoord van de eigenaar rust; ` +
        "dat is geen administratieve wijziging en vraagt zijn akkoord op deze pull request",
    );
  }
  if (!administratief) {
    if (f.taken.length === 0 && f.taakRedenen.length === 0) {
      redenen.push("geen taak bekend voor deze pull request");
    }
    for (const t of f.taken) {
      if (t.autorisatie === null) {
        redenen.push(`geen akkoord van de eigenaar op taak ${t.taak} in de database`);
      } else if (t.autorisatie.soort !== "taak" || t.autorisatie.taak !== t.taak) {
        redenen.push(`de gevonden autorisatie ${t.autorisatie.id} is geen taakakkoord voor ${t.taak}`);
      } else if (t.scopeHashKop === null) {
        redenen.push(`tasks/${t.taak}/opdracht.md ontbreekt op de kop; zonder scope geen akkoord`);
      } else if (t.autorisatie.scope_hash !== t.scopeHashKop) {
        redenen.push(
          `de scope van ${t.taak} is veranderd sinds het akkoord van ${t.autorisatie.op} ` +
            `(akkoord op ${(t.autorisatie.scope_hash ?? "?").slice(0, 12)}, kop ${t.scopeHashKop.slice(0, 12)}); opnieuw autoriseren`,
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
  }

  const treffers = raaktHardeUitzondering(f.gewijzigdeBestanden, f.extraPaden ?? []);
  const verklaring = leesUitzonderingenRegel(f.prTekst);
  const uitzondering = treffers.length > 0 || (verklaring !== null && verklaring !== "geen");
  if (verklaring === null) {
    redenen.push('de PR-tekst verklaart niets over uitzonderingen; zet er een regel "Uitzonderingen: geen" of "Uitzonderingen: <welke>" in');
  }
  if (uitzondering) {
    // `akkoordOpDezeKop` kwam met #82 op `main` en vervangt de inline-kopie
    // die hier stond: dezelfde toets, nu op één plaats, en ook gebruikt door
    // de controle op een herschreven opdrachttekst.
    const apartAkkoord = akkoordOpDezeKop(f);

    // Het mandaat uit de taak zelf. Een taak die in haar goedgekeurde
    // opdracht aankondigt dat zij deze soorten raakt, heeft het akkoord van
    // de eigenaar mét die aankondiging gekregen; dan hoeft niet elke pull
    // request binnen die taak er opnieuw om te vragen. Alleen de soorten die
    // werkelijk worden geraakt moeten gedekt zijn — een aankondiging is geen
    // vrijbrief voor iets anders.
    const gemandateerd = administratief ? [] : gemandateerdeUitzonderingen(f.taken);
    const geraakt = soortenHardeUitzondering(f.gewijzigdeBestanden, f.extraPaden ?? []);
    const ongedekt = geraakt.filter((s) => !gemandateerd.includes(s));
    // De verklaring moet precies zijn wat de bestanden opleveren. Anders zou
    // een vrije tekst — het enige kanaal voor een uitzondering zonder
    // bestandspad — meeliften op een gemandateerde treffer.
    const verwacht = verwachteUitzonderingenRegel(geraakt);
    const verklaringKlopt = verklaring !== null && zelfdeVerklaring(verklaring, verwacht);
    const gedektDoorDeTaak = geraakt.length > 0 && ongedekt.length === 0 && verklaringKlopt;

    if (!apartAkkoord && !gedektDoorDeTaak) {
      const wat = [
        ...(ongedekt.length > 0 ? treffers.filter((t) => ongedekt.some((s) => t.endsWith(`(${s})`))) : treffers),
        ...(verklaring !== null && !verklaringKlopt ? [`verklaard: ${verklaring} (verwacht: ${verwacht})`] : []),
      ];
      redenen.push(
        `harde uitzondering (DEC-0043 §2) die de taak niet aankondigt en waarvoor geen apart akkoord van de eigenaar op deze kop bestaat: ${wat.join("; ")}`,
      );
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
  /** Taak-id's, met "+" verbonden; "administratief" voor een administratieve PR. */
  readonly taken: string;
  /** Autorisatie-id's in dezelfde volgorde, met "+" verbonden; "-" als er geen nodig waren. */
  readonly autorisaties: string;
  /** Scope-hashes in dezelfde volgorde, met "+" verbonden; "-" als er geen waren. */
  readonly scope: string;
  /** Het id van de toetsing; "-" bij een administratieve PR. */
  readonly toetsing: string;
  readonly kop: string;
  readonly uitzonderingen: string;
};

/** De inhoud van de attestatie voor een schone beoordeling. */
export function attestatieInhoud(f: AttestatieFeiten): AttestatieInhoud {
  const administratief = isAdministratievePr(f);
  return {
    taken: administratief ? "administratief" : f.taken.map((t) => t.taak).join("+"),
    autorisaties: administratief ? "-" : f.taken.map((t) => t.autorisatie?.id ?? "?").join("+"),
    scope: administratief ? "-" : f.taken.map((t) => t.scopeHashKop ?? "?").join("+"),
    toetsing: administratief ? "-" : (f.toetsing?.id ?? "?"),
    kop: f.kop,
    uitzonderingen: uitzonderingenInAttestatie(f),
  };
}

/**
 * Waar de uitzonderingen op gedekt zijn, in één woord voor de attestatietekst.
 *
 * De tekst hoort te zeggen wáárop is geattesteerd: zonder dat zou een
 * attestatie die op het mandaat van de taak steunt er hetzelfde uitzien als
 * een zonder uitzonderingen, en dan is achteraf niet te zien welke grond is
 * gebruikt. Een apart akkoord gaat voor in de melding, omdat dat de smalste
 * grond is.
 */
export function uitzonderingenInAttestatie(f: AttestatieFeiten): string {
  if (f.autorisatiePr !== null) return `apart akkoord ${f.autorisatiePr.id}`;
  const geraakt = soortenHardeUitzondering(f.gewijzigdeBestanden, f.extraPaden ?? []);
  if (geraakt.length === 0) return "geen";
  return `mandaat uit ${f.taken.map((t) => t.taak).join("+")}`;
}

/** De reviewtekst: één regel, machinaal te lezen en voor mensen leesbaar. */
export function attestatieTekst(i: AttestatieInhoud): string {
  return (
    `${ATTESTATIE_VOORVOEGSEL} taken ${i.taken} · autorisaties ${i.autorisaties} · scope ${i.scope} · ` +
    `toetsing ${i.toetsing} · kop ${i.kop} · uitzonderingen: ${i.uitzonderingen} · poort groen`
  );
}

/** Leest een attestatietekst terug. Null als het geen attestatie is. */
export function leesAttestatie(tekst: string): AttestatieInhoud | null {
  const eerste = tekst.replace(/\r\n/g, "\n").split("\n")[0] ?? "";
  if (!eerste.startsWith(ATTESTATIE_VOORVOEGSEL)) return null;
  const m =
    /^Attestatie \(DEC-0043\): taken (\S+) · autorisaties (\S+) · scope (\S+) · toetsing (\S+) · kop ([0-9a-f]{40}) · uitzonderingen: (.+?) · poort groen$/.exec(
      eerste,
    );
  if (!m) return null;
  const scope = m[3]!;
  if (scope !== "-" && !/^[0-9a-f]{64}(\+[0-9a-f]{64})*$/.test(scope)) return null;
  return { taken: m[1]!, autorisaties: m[2]!, scope, toetsing: m[4]!, kop: m[5]!, uitzonderingen: m[6]! };
}

/**
 * Klopt een attestatie met wat de database zegt? Dit is de tweede,
 * onafhankelijke verificatie vóór het samenvoegen: de workflow schreef de
 * tekst, `jarvis pr mergen` leest de rijen zelf terug via jarvis_werker.
 * `autorisaties` bevat per id de rij (of null), `toetsing` de rij (of null).
 */
export function verifieerAttestatie(
  inhoud: AttestatieInhoud,
  kop: string,
  autorisaties: ReadonlyMap<string, Autorisatie | null>,
  toetsing: Toetsing | null,
): readonly string[] {
  const redenen: string[] = [];
  if (inhoud.kop !== kop) redenen.push(`de attestatie hoort bij ${inhoud.kop.slice(0, 7)}, de kop is ${kop.slice(0, 7)}`);
  if (inhoud.taken === "administratief") {
    if (inhoud.autorisaties !== "-" || inhoud.toetsing !== "-") redenen.push("een administratieve attestatie noemt geen autorisaties of toetsing");
    return redenen;
  }
  const taken = inhoud.taken.split("+");
  const ids = inhoud.autorisaties.split("+");
  const scopes = inhoud.scope.split("+");
  if (taken.length === 0 || taken.length !== ids.length || taken.length !== scopes.length) {
    redenen.push("de attestatie noemt taken, autorisaties en scopes niet paarsgewijs");
    return redenen;
  }
  taken.forEach((taak, n) => {
    const a = autorisaties.get(ids[n]!) ?? null;
    if (a === null) redenen.push(`autorisatie ${ids[n]} bestaat niet in de database`);
    else if (a.soort !== "taak" || a.taak !== taak) redenen.push(`autorisatie ${ids[n]} is geen taakakkoord voor ${taak}`);
    else if ((a.scope_hash ?? "") !== scopes[n]) redenen.push(`de scope van ${taak} in de attestatie wijkt af van de autorisatie`);
  });
  if (toetsing === null) redenen.push(`toetsing ${inhoud.toetsing} bestaat niet in de database`);
  else if (toetsing.oordeel !== "GO" || toetsing.commit_sha !== kop) {
    redenen.push(`toetsing ${inhoud.toetsing} is geen GO op de kop`);
  }
  return redenen;
}
