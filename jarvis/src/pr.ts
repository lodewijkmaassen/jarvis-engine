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
  /**
   * Waar deze run vandaan komt: bij GitHub Actions het workflow-id, als tekst.
   * Twee runs met dezelfde naam zijn alleen herhalingen van elkaar als ook
   * hun herkomst gelijk is. Leeg of onbekend betekent: geen herhaling van
   * wat dan ook, en dan blijft elke run staan (fail closed).
   */
  readonly herkomst?: string | null;
};

/**
 * Houdt per controle alleen het resultaat over dat nog geldt.
 *
 * GitHub bewaart alle runs van een commit. Dezelfde workflow draait op deze
 * repository op `push`, op `pull_request` en op `pull_request_review`, dus op
 * één kop staan al snel meerdere runs met dezelfde jobnaam. Twee dingen
 * vallen daardoor weg:
 *
 *  - een OPGEVOLGDE, GEANNULEERDE run: de concurrency-groep brak hem af toen
 *    een tweede run startte, en hij zegt niets over de commit;
 *  - een run die door een LATERE GELDIGE run van DEZELFDE WORKFLOW is
 *    vervangen: dat is een herhaalde controle van hetzelfde type op dezelfde
 *    versie, en dan telt alleen de meest recente.
 *
 * Dat tweede is bewust smal. QA-bevinding N-1 wees erop dat een toegevoegde
 * workflow met een job `poort` een echte rode poort onzichtbaar zou kunnen
 * maken; daarom vergelijkt deze functie niet op naam alleen maar op naam
 * *en* herkomst. Een groene run uit een andere workflow overstemt een rode
 * dus nog steeds niet, en zonder bekende herkomst overstemt niets iets:
 * beide runs blijven staan en de rode blokkeert. Een geannuleerde run
 * vervangt evenmin iets — hij is geen geldig resultaat.
 *
 * Een run zonder starttijd geldt als eerder dan een run met starttijd; twee
 * zonder starttijd volgen de lijstvolgorde.
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
  const geannuleerd = (c: Check): boolean => c.status === "completed" && c.conclusie === "cancelled";
  // Alleen runs uit dezelfde workflow zijn herhalingen van elkaar. Een lege
  // of ontbrekende herkomst matcht niets, ook geen andere lege.
  const zelfdeControle = (a: Check, b: Check): boolean =>
    a !== b && a.naam === b.naam && typeof a.herkomst === "string" && a.herkomst !== "" && a.herkomst === b.herkomst;
  return checks.filter((c) => {
    if (geannuleerd(c) && checks.some((d) => d !== c && d.naam === c.naam && later(c, d))) return false;
    return !checks.some((d) => zelfdeControle(c, d) && !geannuleerd(d) && later(c, d));
  });
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

/** Het bestand van de attestatieworkflow; de terugval start dezelfde workflow. */
export const ATTESTATIE_WORKFLOW = "jarvis-attestatie.yml";

export type DispatchWeigering = {
  /**
   * `sessietype`: niet het bottoken maar de proxy van het uitvoeringsplatform
   * weigert; dezelfde workflow langs de eigen GitHub-weg van de sessie komt
   * wél op gang (LRN-0016). `recht`: het token zelf mist `actions: write`.
   * `anders`: alles wat geen van beide is, zoals een ontbrekende workflow.
   */
  readonly soort: "sessietype" | "recht" | "anders";
  /** Of een uitvoerder de attestatie nog langs een andere weg kan starten. */
  readonly terugvalMogelijk: boolean;
  /** Regels voor de uitvoerder, de eerste is de weigering zelf. */
  readonly regels: readonly string[];
};

/** Wat er van één rechtensoort bekend is, en waarom. */
export type Rechtenoordeel = {
  /** De rechtensoort zoals hij in de uitvoer heet. */
  readonly soort: "lezen" | "schrijven op inhoud" | "workflow starten";
  /** `true` gemeten, `false` gemeten, `null` niet vast te stellen zonder bijwerking. */
  readonly heeft: boolean | null;
  /** Eén regel voor de uitvoerder: wat er bekend is en waaruit. */
  readonly regel: string;
};

/**
 * Meet de drie rechten die `jarvis pr` werkelijk nodig heeft, elk apart.
 *
 * Waarom dit bestaat: tot 2026-09-15 vatte `jarvis pr wie` alles samen in één
 * uitspraak over "schrijfrecht". Die uitspraak was op de cloud onjuist en
 * stuurde elke run naar de verkeerde conclusie (RSK-0025): de bot had op de
 * repository de rol `write` en pushte, opende pull requests en voegde samen,
 * maar `wie` meldde "geen schrijfrecht" omdat de attestatie een 403 gaf. Die
 * 403 gaat over iets anders — het recht een workflow te starten — en op de
 * cloud zelfs niet over een GitHub-recht maar over het sessietype.
 *
 * De drie rechten vallen dus niet samen en worden niet samengevat. Lezen en
 * schrijven op inhoud volgen uit `permissions` van de repository; het recht een
 * workflow te starten is zonder bijwerking niet te meten — een dispatch ís de
 * handeling — en blijft daarom eerlijk `null`, met de vindplaats waar het wél
 * blijkt. Achter de proxy van de cloud zegt `permissions` niets (gemeten op
 * 2026-09-14 en 2026-09-15: veld afwezig, en `push: false` terwijl pushen
 * lukte), dus daar is elk oordeel `null` in plaats van `false`.
 */
export function duidRechten(
  leesbaar: boolean,
  permissies: { readonly push?: boolean; readonly admin?: boolean } | undefined,
  inDeCloud: boolean,
): readonly Rechtenoordeel[] {
  if (!leesbaar) {
    return [
      { soort: "lezen", heeft: false, regel: "lezen: nee — de repository is met dit token niet bereikbaar" },
      { soort: "schrijven op inhoud", heeft: null, regel: "schrijven op inhoud: niet vast te stellen zolang lezen niet lukt" },
      { soort: "workflow starten", heeft: null, regel: "workflow starten: niet vast te stellen zolang lezen niet lukt" },
    ];
  }

  const onbekendWaarom = permissies === undefined
    ? "het token meldt zijn rechten niet (app-installatie)"
    : "achter de proxy van de cloud zegt het permissions-veld niets";
  const schrijven: Rechtenoordeel = permissies === undefined || inDeCloud
    ? { soort: "schrijven op inhoud", heeft: null, regel: `schrijven op inhoud: onbekend — ${onbekendWaarom}; probeer gewoon, pushen en een pull request openen lukken hier doorgaans wel` }
    : permissies.push === true
      ? { soort: "schrijven op inhoud", heeft: true, regel: `schrijven op inhoud: ja${permissies.admin === true ? " — en admin, dat is te veel" : ""}` }
      : { soort: "schrijven op inhoud", heeft: false, regel: "schrijven op inhoud: nee — de bot is geen collaborator met schrijfrecht; nodig hem uit" };

  return [
    { soort: "lezen", heeft: true, regel: "lezen: ja" },
    schrijven,
    {
      soort: "workflow starten",
      heeft: null,
      regel: inDeCloud
        ? `workflow starten: onbekend tot je het probeert — een dispatch is zelf de handeling, dus niet vooraf te meten; op de cloud weigert het uitvoeringsplatform dit sessietype meestal (RSK-0025), en \`jarvis pr attesteren\` noemt dan de weigeraar en de terugval`
        : `workflow starten: onbekend tot je het probeert — een dispatch is zelf de handeling, dus niet vooraf te meten; \`jarvis pr attesteren\` noemt bij een weigering het ontbrekende recht (actions: write) of het sessietype`,
    },
  ];
}

/**
 * Duidt een mislukte workflow-dispatch en noemt de terugval bij naam.
 *
 * Waarom dit hier staat: een kale `403` liet de uitvoerder raden, waardoor de
 * omweg per run opnieuw moest worden gevonden (gemeten op 2026-09-15 en
 * 2026-09-16, zie T-20260914-agent-operations). De weigering van het platform
 * is géén uitspraak over de bevoegdheid van Jarvis: dezelfde workflow, gestart
 * langs de eigen GitHub-weg van de sessie, loopt tot een inhoudelijk oordeel.
 * De opdracht zegt dat nu zelf, met de invoer die ervoor nodig is.
 */
export function duidDispatchWeigering(
  status: number,
  bericht: string,
  slug: string,
  nummer: number,
): DispatchWeigering {
  const sessietype = status === 403 && /not permitted for this session type/i.test(bericht);
  const recht = status === 403 && !sessietype;
  const soort: DispatchWeigering["soort"] = sessietype ? "sessietype" : recht ? "recht" : "anders";
  const regels: string[] = [`workflow niet gestart (${status}: ${bericht})`];

  if (sessietype) {
    regels.push(
      "dit weigert het uitvoeringsplatform, niet GitHub en niet het bottoken: de attestatie zelf is toegestaan",
      `terugval: start ${ATTESTATIE_WORKFLOW} op main met invoer pr: ${nummer} in ${slug} langs de eigen GitHub-weg van de sessie`,
      "de workflow beoordeelt daarna zelf en geeft bij een schone uitkomst de review af",
    );
  } else if (recht) {
    regels.push(
      "het token mist actions: write (workflow-dispatch)",
      `terugval: start ${ATTESTATIE_WORKFLOW} op main met invoer pr: ${nummer} in ${slug} langs een weg die dat recht wél heeft`,
    );
  } else {
    regels.push(`staat ${ATTESTATIE_WORKFLOW} op main van ${slug}?`);
  }
  return { soort, terugvalMogelijk: sessietype || recht, regels };
}
