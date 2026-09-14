// Pull requests: openen, volgen en samenvoegen, als de bot.
//
// WIE DOET WAT
//
// De eigenaar beslist en autoriseert: per taak, in de Jarvis-app (DEC-0043);
// de poort zet dat akkoord om in de goedkeurende review die branch protection
// eist (attestatie.ts). Een review van de eigenaar zelf op GitHub blijft ook
// geldig. Al het andere - de PR openen, de checks volgen, de samenvoegmethode
// kiezen, samenvoegen - is techniek, en techniek is van Jarvis (CON-0015).
//
// Daarom werkt dit onder een eigen identiteit: de bot. Zou Jarvis de PR onder
// de naam van de eigenaar openen, dan kan de eigenaar hem niet goedkeuren
// (GitHub weigert een review op je eigen PR) en is de hele constructie loos.
// Het token van de bot staat in een bestand buiten elke repository; het wordt
// gelezen, als header meegestuurd en nooit getoond.
//
// WAT SAMENVOEGEN VEREIST
//
// De ruleset op de hoofdbranch eist een goedkeuring; deze module eist meer,
// en bewust: een goedkeurende review op precies de commit die nu de kop van
// de PR is, alle checks geslaagd, en een PR die GitHub zelf schoon
// samenvoegbaar noemt. Een goedkeuring van vóór een latere push telt niet:
// dan is iets anders goedgekeurd dan wat wordt samengevoegd.
//
// Twee soorten goedkeuring tellen (DEC-0043): een review van de eigenaar
// zelf, of een attestatie van de poort (github-actions[bot]) waarvan de
// aanroeper de inhoud tegen de eigen database heeft geverifieerd en de kop
// als "geattesteerd" doorgeeft. Een goedkeuring van wie dan ook anders — ook
// van de bot — is geen autorisatie.
//
// Alles hier is puur; de I/O staat in opdrachten.ts.

export type Review = {
  readonly gebruiker: string;
  readonly staat: string;
  /** De commit waarop de review is gegeven. */
  readonly commit: string;
  /** De tekst van de review; bij een attestatie de attestatietekst. */
  readonly tekst?: string;
};

export type Check = {
  readonly naam: string;
  readonly status: string;
  readonly conclusie: string | null;
  /** Wanneer de run begon (ISO); bepaalt welke run van een naam de laatste is. */
  readonly gestart?: string | null;
};

/**
 * Laat alleen een OPGEVOLGDE, GEANNULEERDE run weg. GitHub bewaart alle runs
 * van een commit: start een tweede run van dezelfde workflow (een
 * review-event tijdens een lopende run), dan annuleert de concurrency-groep
 * de eerste en blijft die als "cancelled" aan de commit hangen. Zo'n run
 * zegt niets over de commit zodra er een later gestarte run met dezelfde naam
 * is. Al het andere blijft staan en moet groen zijn: een rode run wordt
 * nooit overstemd door een latere groene met dezelfde naam (QA-bevinding
 * N-1 — anders kon een toegevoegde workflow met een job "poort" een echte
 * rode poort onzichtbaar maken). Een run zonder starttijd geldt als eerder
 * dan een run met starttijd; twee zonder starttijd volgen de lijstvolgorde.
 */
export function laatstePerNaam(checks: readonly Check[]): readonly Check[] {
  const positie = new Map<Check, number>();
  checks.forEach((c, i) => positie.set(c, i));
  const later = (a: Check, b: Check): boolean => {
    // Is b later gestart dan a?
    const ta = a.gestart ?? "";
    const tb = b.gestart ?? "";
    if (ta !== tb) return tb > ta;
    return (positie.get(b) ?? 0) > (positie.get(a) ?? 0);
  };
  return checks.filter(
    (c) => !(c.status === "completed" && c.conclusie === "cancelled" && checks.some((d) => d !== c && d.naam === c.naam && later(c, d))),
  );
}

export type PullRequestFeiten = {
  readonly nummer: number;
  readonly auteur: string;
  readonly kop: string;
  readonly basis: string;
  readonly open: boolean;
  readonly concept: boolean;
  readonly samenvoegbaar: boolean | null;
  readonly samenvoegStaat: string;
  readonly reviews: readonly Review[];
  readonly checks: readonly Check[];
};

/** De eigenaar van een repository is het deel voor de schuine streep. */
export function eigenaarVan(slug: string): string {
  return slug.split("/")[0] ?? "";
}

/**
 * Waarom de bot deze PR niet mag openen. Leeg betekent in orde.
 *
 * De bot mag nooit de eigenaar zijn (dan kan niemand goedkeuren), en een
 * tweede open PR van dezelfde branch is een vergissing die alleen verwarring
 * oplevert.
 */
export function beoordeelOpenen(
  botLogin: string,
  slug: string,
  bestaandeOpenKoppen: readonly string[],
  kop: string,
): readonly string[] {
  const redenen: string[] = [];
  if (botLogin.toLowerCase() === eigenaarVan(slug).toLowerCase()) {
    redenen.push(
      `het token hoort bij ${botLogin}, de eigenaar van ${slug}; een PR van de eigenaar kan de eigenaar niet ` +
        `goedkeuren, dus dit moet het token van de bot zijn`,
    );
  }
  if (bestaandeOpenKoppen.includes(kop)) {
    redenen.push(`er staat al een open pull request van ${kop} naar ${slug}`);
  }
  return redenen;
}

const GOEDE_CONCLUSIES = new Set(["success", "skipped", "neutral"]);

/**
 * De check die de poort draagt: de job `poort` uit de canonieke workflow.
 * Die moet er zijn én geslaagd zijn — niet overgeslagen, niet neutraal. Een
 * PR zonder deze check (workflow niet gedraaid, actor-filter, verkeerde
 * naam) wordt niet samengevoegd (QA-bevinding H-2).
 */
export const VERPLICHTE_CHECK = "poort";

/** De identiteit waaronder de poort attesteert (zie attestatie.ts). */
export const ATTESTATIE_GEBRUIKER = "github-actions[bot]";

/**
 * Waarom deze PR nu niet samengevoegd mag worden. Leeg betekent: voeg samen.
 *
 * `eigenaar` is de login die de inhoudelijke autorisatie geeft: de eigenaar
 * van de repository. `geattesteerdeKoppen` zijn de commits waarop de
 * aanroeper een attestatie van de poort heeft geverifieerd tegen de eigen
 * database (DEC-0043); zo'n attestatie geldt als autorisatie. Een
 * goedkeuring van iemand anders (ook van de bot) is geen autorisatie.
 */
export function beoordeelSamenvoegen(
  pr: PullRequestFeiten,
  eigenaar: string,
  geattesteerdeKoppen: readonly string[] = [],
): readonly string[] {
  const redenen: string[] = [];
  if (!pr.open) redenen.push(`#${pr.nummer} is niet open`);
  if (pr.concept) redenen.push(`#${pr.nummer} is een concept (draft)`);

  const vanEigenaar = pr.reviews.filter(
    (r) => r.staat === "APPROVED" && r.gebruiker.toLowerCase() === eigenaar.toLowerCase(),
  );
  const attestaties = pr.reviews.filter(
    (r) =>
      r.staat === "APPROVED" &&
      r.gebruiker.toLowerCase() === ATTESTATIE_GEBRUIKER &&
      geattesteerdeKoppen.includes(r.commit),
  );
  const goedkeuringen = [...vanEigenaar, ...attestaties];
  const opKop = goedkeuringen.filter((r) => r.commit === pr.kop);
  if (goedkeuringen.length === 0) {
    redenen.push(
      `geen goedkeurende review van ${eigenaar} en geen geverifieerde attestatie van de poort; ` +
        `de autorisatie is van de eigenaar (per taak, DEC-0043)`,
    );
  } else if (opKop.length === 0) {
    redenen.push(
      `de goedkeuring is gegeven op een eerdere commit dan de huidige kop ${pr.kop.slice(0, 7)}; ` +
        `wat goedgekeurd is, is niet wat samengevoegd zou worden`,
    );
  }
  const latereWijziging = pr.reviews.some(
    (r) => r.staat === "CHANGES_REQUESTED" && r.gebruiker.toLowerCase() === eigenaar.toLowerCase() && r.commit === pr.kop,
  );
  if (latereWijziging) redenen.push(`${eigenaar} vroeg wijzigingen op de huidige kop`);

  const checks = laatstePerNaam(pr.checks);
  const poort = checks.filter((c) => c.naam === VERPLICHTE_CHECK);
  if (poort.length === 0) {
    redenen.push(`de check "${VERPLICHTE_CHECK}" ontbreekt op de huidige kop; zonder poort wordt er niet samengevoegd`);
  }
  for (const c of poort) {
    if (c.status !== "completed") redenen.push(`de poort is nog niet klaar (${c.status})`);
    else if (c.conclusie !== "success") redenen.push(`de poort is niet geslaagd (${c.conclusie ?? "onbekend"})`);
  }
  for (const c of checks) {
    if (c.naam === VERPLICHTE_CHECK) continue;
    if (c.status !== "completed") {
      redenen.push(`check ${c.naam} is nog niet klaar (${c.status})`);
    } else if (c.conclusie === null || !GOEDE_CONCLUSIES.has(c.conclusie)) {
      redenen.push(`check ${c.naam} is niet geslaagd (${c.conclusie ?? "onbekend"})`);
    }
  }

  if (pr.samenvoegbaar === false) redenen.push("GitHub meldt een conflict met de basisbranch");
  if (pr.samenvoegbaar === null) redenen.push("GitHub heeft de samenvoegbaarheid nog niet bepaald; probeer zo opnieuw");
  else if (pr.samenvoegbaar && !["clean", "has_hooks"].includes(pr.samenvoegStaat)) {
    // "unstable" betekent: een check is rood of ontbreekt. Ook als de checks
    // hierboven allemaal groen lijken, is dat een reden om te wachten.
    redenen.push(`GitHub noemt de staat "${pr.samenvoegStaat}"; alleen een schone PR wordt samengevoegd`);
  }
  return redenen;
}

/**
 * De samenvoegmethode is een technische keuze en daarom vast: een mergecommit.
 * Squashen of rebasen geeft nieuwe SHA's, en dan is een commit die elders is
 * vastgepind (de engine in een consumer) niet meer bereikbaar vanaf main.
 */
export const SAMENVOEGMETHODE = "merge" as const;
