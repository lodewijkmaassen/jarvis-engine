// De eigen database van Jarvis: schema `jarvis` (antwoorden, berichten,
// documenten, gebeurtenissen). Dit is de gebeurtenisbron van de interface en
// het werkgeheugen van elke uitvoerder, op de laptop en in de cloud
// (DEC-0042 in het eerste project).
//
// De verbinding loopt als de rol `jarvis_werker`, die uitsluitend dit schema
// ziet. De verbindingsreeks komt uit JARVIS_DB_URL of uit een bestand
// buiten elke repository; ze wordt nooit getoond.
//
// Alles wat SQL bouwt is hier puur en getest; de verbinding zelf zit in
// opdrachten.ts.

export type NieuwAntwoord = {
  readonly id: string;
  readonly item_id: string;
  readonly project: string | null;
  readonly soort: string | null;
  readonly titel: string | null;
  readonly bron: string | null;
  readonly keuze: string;
  readonly keuze_label: string | null;
  readonly notitie: string;
  readonly op: string;
  readonly status: string;
};

export type NieuwBericht = {
  readonly id: string;
  readonly van: string;
  readonly tekst: string;
  readonly op: string;
  readonly status: string;
  readonly context: Record<string, unknown>;
};

export const TABELLEN = ["antwoorden", "berichten"] as const;
export type Tabel = (typeof TABELLEN)[number];

export function isTabel(naam: string): naam is Tabel {
  return (TABELLEN as readonly string[]).includes(naam);
}

/**
 * Een claim slaagt alleen op een item dat nog `nieuw` is: twee uitvoerders
 * (laptop en cloud) mogen nooit hetzelfde item verwerken. Dit is de enige
 * plek waar die regel staat; beide uitvoerders roepen hem aan.
 */
export function claimSql(tabel: Tabel): string {
  return (
    `update jarvis.${tabel} set status = 'in behandeling', behandeld_door = $2, behandeld_sinds = now() ` +
    `where id = $1 and status = 'nieuw' returning id`
  );
}

export function verwerktSql(tabel: Tabel): string {
  return `update jarvis.${tabel} set status = 'verwerkt', verwerkt_op = now(), verwerking = $2 where id = $1 returning id`;
}

export const NIEUWE_ANTWOORDEN_SQL =
  "select id, item_id, project, soort, titel, bron, keuze, keuze_label, notitie, op, status " +
  "from jarvis.antwoorden where status = 'nieuw' order by op";

export const NIEUWE_BERICHTEN_SQL =
  "select id, van, tekst, op, status, context from jarvis.berichten where van = 'eigenaar' and status = 'nieuw' order by op";

export const BERICHT_VAN_JARVIS_SQL =
  "insert into jarvis.berichten (id, van, tekst, status, context, verwerkt_op) " +
  "values ($1, 'jarvis', $2, 'verwerkt', $3::jsonb, now()) returning id";

export const DOCUMENT_SQL =
  "insert into jarvis.documenten (id, inhoud, bijgewerkt) values ($1, $2::jsonb, now()) " +
  "on conflict (id) do update set inhoud = excluded.inhoud, bijgewerkt = now() returning id";

/** Een bericht-id dat leesbaar is en niet botst: prefix, tijd, korte willekeur. */
export function berichtId(nu: Date, willekeur: string): string {
  const t = nu.toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `j-${t}-${willekeur.slice(0, 6)}`;
}

/** Waar de verbindingsreeks vandaan komt, in volgorde; nooit de reeks zelf. */
export function verbindingsBron(omgeving: string | undefined, bestandGevonden: boolean): "omgeving" | "bestand" | null {
  if (omgeving && omgeving.trim().length > 0) return "omgeving";
  if (bestandGevonden) return "bestand";
  return null;
}

// --- Autorisaties en toetsingen (DEC-0043) --------------------------------
//
// `autorisaties` schrijft alleen de eigenaar, via de interface; de rol
// jarvis_werker leest ze. `toetsingen` schrijft jarvis_werker na een
// onafhankelijke QA-ronde. Beide tabellen zijn onveranderbaar: geen update,
// geen delete, ook niet voor de rol.

export const AUTORISATIE_KOLOMMEN = "id, soort, project, taak, scope_hash, pr_repo, pr_nummer, commit_sha, op";
export const TOETSING_KOLOMMEN = "id, pr_repo, pr_nummer, commit_sha, oordeel, rapport, door, op";

/** De laatste taakautorisatie voor een taak. */
export const AUTORISATIE_TAAK_SQL =
  `select ${AUTORISATIE_KOLOMMEN} from jarvis.autorisaties where soort = 'taak' and taak = $1 order by op desc limit 1`;

/** Een PR-autorisatie (harde uitzondering) op precies deze kop. */
export const AUTORISATIE_PR_SQL =
  `select ${AUTORISATIE_KOLOMMEN} from jarvis.autorisaties ` +
  "where soort = 'pr' and pr_repo = $1 and pr_nummer = $2 and commit_sha = $3 order by op desc limit 1";

export const AUTORISATIE_ID_SQL = `select ${AUTORISATIE_KOLOMMEN} from jarvis.autorisaties where id = $1`;
export const AUTORISATIES_SQL = `select ${AUTORISATIE_KOLOMMEN} from jarvis.autorisaties order by op desc limit 200`;

export const OORDELEN = ["GO", "NO-GO"] as const;
export type Oordeel = (typeof OORDELEN)[number];
export function isOordeel(waarde: string): waarde is Oordeel {
  return (OORDELEN as readonly string[]).includes(waarde);
}

export const TOETSING_SQL =
  "insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel, rapport, door) " +
  "values ($1, $2, $3, $4, $5, $6) returning id";

/** De laatste GO op precies deze kop. */
export const TOETSING_KOP_SQL =
  `select ${TOETSING_KOLOMMEN} from jarvis.toetsingen ` +
  "where pr_repo = $1 and pr_nummer = $2 and commit_sha = $3 and oordeel = 'GO' order by op desc limit 1";

export const TOETSING_ID_SQL = `select ${TOETSING_KOLOMMEN} from jarvis.toetsingen where id = $1`;

/** Akkoorden sinds een tijdstip: waar `jarvis db wachten` op reageert. */
export const AUTORISATIES_SINDS_SQL = `select ${AUTORISATIE_KOLOMMEN} from jarvis.autorisaties where op > $1 order by op`;

/**
 * Dezelfde lezingen via de REST-API van PostgREST, voor de attestatieworkflow
 * die geen databaserol heeft: alleen de publieke sleutel en de leesbeelden
 * `autorisaties_open` en `toetsingen_open` (zonder eigenaarsgegevens).
 */
export function restPadAutorisatieTaak(taak: string): string {
  return `autorisaties_open?soort=eq.taak&taak=eq.${encodeURIComponent(taak)}&order=op.desc&limit=1`;
}
export function restPadAutorisatiePr(repo: string, nummer: number, kop: string): string {
  return (
    `autorisaties_open?soort=eq.pr&pr_repo=eq.${encodeURIComponent(repo)}&pr_nummer=eq.${nummer}` +
    `&commit_sha=eq.${encodeURIComponent(kop)}&order=op.desc&limit=1`
  );
}
export function restPadToetsingKop(repo: string, nummer: number, kop: string): string {
  return (
    `toetsingen_open?pr_repo=eq.${encodeURIComponent(repo)}&pr_nummer=eq.${nummer}` +
    `&commit_sha=eq.${encodeURIComponent(kop)}&oordeel=eq.GO&order=op.desc&limit=1`
  );
}

/** Wat de verbinding meldt bij `jarvis db wie`; ook een toegestaan statement. */
export const WIE_SQL = "select current_user as gebruiker, current_setting('server_version') as versie";

/**
 * Alle statements die de engine op de eigen database uitvoert, letterlijk.
 * De Edge Function `jarvis-db` (voor de cloud, die geen Postgres kan
 * bereiken) voert uitsluitend deze teksten uit; zie jarvis/edge/jarvis-db.
 */
export function toegestaneSql(): readonly string[] {
  return [
    WIE_SQL,
    ...TABELLEN.map(claimSql),
    ...TABELLEN.map(verwerktSql),
    NIEUWE_ANTWOORDEN_SQL,
    NIEUWE_BERICHTEN_SQL,
    BERICHT_VAN_JARVIS_SQL,
    DOCUMENT_SQL,
    AUTORISATIE_TAAK_SQL,
    AUTORISATIE_PR_SQL,
    AUTORISATIE_ID_SQL,
    AUTORISATIES_SQL,
    TOETSING_SQL,
    TOETSING_KOP_SQL,
    TOETSING_ID_SQL,
    AUTORISATIES_SINDS_SQL,
  ];
}
