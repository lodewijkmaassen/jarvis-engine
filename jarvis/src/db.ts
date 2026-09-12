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
