// De V3-database, echt getest op PostgreSQL (niet gemockt).
//
// Draait alleen als JARVIS_TEST_PG een verbindingsreeks naar een wegwerp-
// server bevat (zonder database-naam); anders worden deze tests overgeslagen
// en meldt de poort dat. Elke run maakt een verse database aan.
//
//   JARVIS_TEST_PG=postgres://postgres@/postgres?host=/tmp&port=5544 npm test
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BASIS = process.env.JARVIS_TEST_PG ?? "";
const migratie = readFileSync(path.join(process.cwd(), "jarvis/migrations/v3/0001_v3_fundament.sql"), "utf8");
const dbNaam = `v3test_${Date.now()}`;
const EIGENAAR = "11111111-1111-1111-1111-111111111111";

const MANDAAT = {
  doel: "pagina /v3-proef toont V3 werkt",
  acceptatie: [
    { id: "A1", omschrijving: "GET geeft 200", meting: { soort: "http", url: "https://example.invalid/v3-proef" } },
    { id: "A2", omschrijving: "bouwmerk klopt", meting: { soort: "http", url: "https://example.invalid/v3-proef" } },
  ],
  repos: ["lodewijkmaassen/tovas-flow"],
  paden_ja: ["app/v3-proef/**", "tests/v3-proef*"],
  productie: true,
  migraties: false,
  kosten_max_eur: 0,
};

const draai = BASIS ? describe : describe.skip;

draai("V3-database (PostgreSQL)", () => {
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  /** Voert uit onder een rol; auth.uid() levert de opgegeven gebruiker. */
  async function als<T>(rol: "jarvis_werker" | "authenticated", uid: string | null, f: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return (await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${rol}`);
      await tx.unsafe(`select set_config('test.uid', '${uid ?? ""}', true)`);
      return f(tx);
    })) as T;
  }
  const werker = <T>(f: (tx: postgres.TransactionSql) => Promise<T>) => als("jarvis_werker", null, f);
  const eigenaar = <T>(f: (tx: postgres.TransactionSql) => Promise<T>) => als("authenticated", EIGENAAR, f);
  let teller = 0;
  const nieuwId = () => `V3-20261015-t${String(++teller).padStart(3, "0")}`;

  async function totAkkoord(id: string, mandaat: object = MANDAAT) {
    await werker(async (tx) => {
      await tx`select jarvis.v3_nieuwe_taak(${id}, 'Proef', 'Maak /v3-proef', 'bericht-1')`;
      await tx`select jarvis.v3_pak(${id}, 'cloud-1', 40)`;
      await tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'ANALYSE', '{}'::jsonb)`;
      await tx`select jarvis.v3_vraag_akkoord(${id}, ${JSON.stringify(mandaat)}::text::jsonb)`;
    });
  }
  async function totUitvoeren(id: string) {
    await totAkkoord(id);
    await eigenaar((tx) => tx`select jarvis.v3_geef_mandaat(${id})`);
    await werker((tx) => tx`select jarvis.v3_pak(${id}, 'cloud-1', 40)`);
  }
  const toestand = async (id: string) => (await sql`select toestand from jarvis.v3_taken where id = ${id}`)[0]?.toestand as string;

  beforeAll(async () => {
    admin = postgres(BASIS, { max: 1 });
    await admin.unsafe(`create database ${dbNaam}`);
    await admin.unsafe(`do $$ begin
      if not exists (select 1 from pg_roles where rolname='jarvis_werker') then create role jarvis_werker nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$`);
    const url = new URL(BASIS);
    url.pathname = `/${dbNaam}`;
    sql = postgres(url.toString(), { max: 2 });
    await sql.unsafe(`
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create schema jarvis;
      create table jarvis.toetsingen (id bigserial primary key, pr_repo text, pr_nummer int, commit_sha text, oordeel text, rapport text, door text, op timestamptz default now());
      create table jarvis.antwoorden (id text primary key, status text);
      grant usage on schema jarvis to jarvis_werker, authenticated;
      grant select, update on jarvis.antwoorden to jarvis_werker;
      grant insert, select on jarvis.toetsingen to jarvis_werker; grant usage on sequence jarvis.toetsingen_id_seq to jarvis_werker;
    `);
    await sql.unsafe(migratie);
    await sql.unsafe(migratie); // idempotent
  });

  afterAll(async () => {
    await sql?.end({ timeout: 2 });
    await admin?.unsafe(`drop database if exists ${dbNaam} with (force)`);
    await admin?.end({ timeout: 2 });
  });

  it("raakt de rechten op V2-tabellen niet", async () => {
    const rijen = await werker((tx) => tx`select count(*)::int as n from jarvis.antwoorden`);
    expect(rijen[0]?.n).toBe(0);
    await werker((tx) => tx`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values ('x/y', 1, 'abc', 'GO')`);
  });

  it("geeft de uitvoerder geen directe schrijfrechten op de V3-tabellen", async () => {
    await expect(werker((tx) => tx`insert into jarvis.v3_taken (id, titel, opdracht) values ('V3-20261015-direct', 'x', 'y')`)).rejects.toThrow(/permission denied/);
    await expect(werker((tx) => tx`update jarvis.v3_taken set toestand = 'KLAAR'`)).rejects.toThrow(/permission denied/);
    await expect(werker((tx) => tx`select * from jarvis.v3_mandaten`)).rejects.toThrow(/permission denied/);
  });

  it("laat alleen de eigenaar een mandaat geven, nooit de uitvoerder", async () => {
    const id = nieuwId();
    await totAkkoord(id);
    await expect(werker((tx) => tx`select jarvis.v3_geef_mandaat(${id})`)).rejects.toThrow(/permission denied/);
    await expect(als("authenticated", null, (tx) => tx`select jarvis.v3_geef_mandaat(${id})`)).rejects.toThrow(/alleen de eigenaar/);
    await expect(eigenaar((tx) => tx`select jarvis.v3_overgang(${id}, 'x', 'UITVOEREN', '{}'::jsonb)`)).rejects.toThrow(/permission denied/);
    expect(await toestand(id)).toBe("AKKOORD_NODIG");
  });

  it("de eigenaar geeft een opdracht; de uitvoerder kan dat niet, en dubbele titels botsen niet", async () => {
    const a = (await eigenaar((tx) => tx`select jarvis.v3_nieuwe_opdracht('Een Proef-pagina!', 'Maak hem') as id`))[0]!.id as string;
    const b = (await eigenaar((tx) => tx`select jarvis.v3_nieuwe_opdracht('Een Proef-pagina!', 'Nog een keer') as id`))[0]!.id as string;
    expect(a).toMatch(/^V3-\d{8}-een-proef-pagina$/);
    expect(b).toMatch(/^V3-\d{8}-een-proef-pagina-2$/);
    expect(await toestand(a)).toBe("ONTVANGEN");
    await expect(werker((tx) => tx`select jarvis.v3_nieuwe_opdracht('x', 'y')`)).rejects.toThrow(/permission denied/);
    await expect(eigenaar((tx) => tx`select jarvis.v3_nieuwe_opdracht('  ', 'y')`)).rejects.toThrow(/verplicht/);
  });

  it("test 1: één akkoord, één mandaat, daarna uitvoeren", async () => {
    const id = nieuwId();
    await totAkkoord(id);
    const voorJou = await eigenaar((tx) => tx`select * from jarvis.v3_voor_jou where taak_id = ${id}`);
    expect(voorJou).toHaveLength(1);
    expect(voorJou[0]?.type).toBe("akkoord");
    await eigenaar((tx) => tx`select jarvis.v3_geef_mandaat(${id})`);
    expect(await toestand(id)).toBe("UITVOEREN");
    expect(await sql`select 1 from jarvis.v3_mandaten where taak_id = ${id}`).toHaveLength(1);
    expect(await eigenaar((tx) => tx`select * from jarvis.v3_voor_jou where taak_id = ${id}`)).toHaveLength(0);
    // een tweede keer geven kan niet
    await expect(eigenaar((tx) => tx`select jarvis.v3_geef_mandaat(${id})`)).rejects.toThrow(/geen akkoord openstaand/);
  });

  it("weigert een mandaat dat de veiligheidsgrens raakt, ook als het voorstel dat probeert", async () => {
    for (const pad of [".github/workflows/x.yml", "jarvis.config.yml", "CODEOWNERS", "jarvis/src/attestatie.ts", "**", "*.ts"]) {
      const id = nieuwId();
      await werker(async (tx) => {
        await tx`select jarvis.v3_nieuwe_taak(${id}, 'P', 'O', null)`;
        await tx`select jarvis.v3_pak(${id}, 'c', 40)`;
        await tx`select jarvis.v3_overgang(${id}, 'c', 'ANALYSE', '{}'::jsonb)`;
      });
      await expect(
        werker((tx) => tx`select jarvis.v3_vraag_akkoord(${id}, ${JSON.stringify({ ...MANDAAT, paden_ja: [pad] })}::text::jsonb)`),
      ).rejects.toThrow(/veiligheidsgrens/);
    }
  });

  it("zet de governance-paden altijd in paden_nee van het mandaat", async () => {
    const id = nieuwId();
    await totAkkoord(id);
    await eigenaar((tx) => tx`select jarvis.v3_geef_mandaat(${id})`);
    const r = await sql`select paden_nee from jarvis.v3_mandaten where taak_id = ${id}`;
    expect(r[0]?.paden_nee).toEqual(expect.arrayContaining([".github/**", "**/CODEOWNERS", "**/jarvis.config.yml", "jarvis/src/**"]));
  });

  it("test 2: taaktekst en mandaat zijn onveranderlijk; wijzigen van de status raakt het akkoord niet", async () => {
    const id = nieuwId();
    await totUitvoeren(id);
    await expect(sql`update jarvis.v3_taken set opdracht = 'iets anders' where id = ${id}`).rejects.toThrow(/onveranderlijk/);
    await expect(sql`update jarvis.v3_mandaten set productie = false where taak_id = ${id}`).rejects.toThrow(/onveranderlijk/);
    await expect(sql`delete from jarvis.v3_gebeurtenissen where taak_id = ${id}`).rejects.toThrow(/onveranderlijk/);
    // veel uitvoeringsactiviteit levert geen nieuw verzoek op
    await werker(async (tx) => {
      await tx`select jarvis.v3_blokkade(${id}, 'cloud-1', 'test faalt')`;
      await tx`select jarvis.v3_blokkade(${id}, 'cloud-1', '')`;
      await tx`select jarvis.v3_hartslag(${id}, 'cloud-1', 40)`;
    });
    expect(await eigenaar((tx) => tx`select * from jarvis.v3_voor_jou where taak_id = ${id}`)).toHaveLength(0);
    expect(await toestand(id)).toBe("UITVOEREN");
  });

  it("test 5: een handeling sluit alleen door meting en komt nooit terug", async () => {
    const id = nieuwId();
    await totUitvoeren(id);
    await expect(werker((tx) => tx`select * from jarvis.v3_vraag(${id}, 'handeling', 'marker', 'Maak een marker-branch', null, null)`)).rejects.toThrow(/check/);
    const [vraag] = await werker((tx) => tx`select * from jarvis.v3_vraag(${id}, 'handeling', 'marker', 'Maak een marker-branch', null, ${JSON.stringify({ soort: "branch", naam: "jarvis/marker" })}::text::jsonb)`);
    expect(vraag?.status).toBe("open");
    expect(await eigenaar((tx) => tx`select * from jarvis.v3_voor_jou where taak_id = ${id}`)).toHaveLength(0); // handelingen zijn geen akkoord/beslissing-kaart
    expect(await werker((tx) => tx`select jarvis.v3_meet_verzoek(${vraag!.id}, '{"geslaagd": false}'::jsonb) as s`)).toEqual([{ s: "open" }]);
    expect(await werker((tx) => tx`select jarvis.v3_meet_verzoek(${vraag!.id}, '{"geslaagd": true, "bewijs": "branch bestaat"}'::jsonb) as s`)).toEqual([{ s: "gesloten" }]);
    // opnieuw vragen met dezelfde sleutel geeft hetzelfde, gesloten, verzoek
    const [nog] = await werker((tx) => tx`select * from jarvis.v3_vraag(${id}, 'handeling', 'marker', 'Maak een marker-branch', null, ${JSON.stringify({ soort: "branch" })}::text::jsonb)`);
    expect(nog?.id).toBe(vraag?.id);
    expect(nog?.status).toBe("gesloten");
    await expect(sql`update jarvis.v3_verzoeken set status = 'open' where id = ${vraag!.id}`).rejects.toThrow(/niet heropend/);
    await expect(sql`delete from jarvis.v3_verzoeken where id = ${vraag!.id}`).rejects.toThrow(/niet verwijderd/);
  });

  it("een nieuwe beslissing legt de taak stil tot de eigenaar antwoordt, en kan het mandaat verruimen", async () => {
    const id = nieuwId();
    await totUitvoeren(id);
    const [b] = await werker((tx) => tx`select * from jarvis.v3_vraag(${id}, 'beslissing', 'kleur', 'Blauw of groen?', ${JSON.stringify(["blauw", "groen"])}::text::jsonb, null)`);
    expect(await toestand(id)).toBe("BESLISSING_NODIG");
    expect(await eigenaar((tx) => tx`select * from jarvis.v3_voor_jou where taak_id = ${id}`)).toHaveLength(1);
    await eigenaar((tx) => tx`select jarvis.v3_beantwoord(${b!.id}, 'groen', ${JSON.stringify({ ...MANDAAT, paden_ja: [...MANDAAT.paden_ja, "app/kleur/**"] })}::text::jsonb)`);
    expect(await toestand(id)).toBe("UITVOEREN");
    expect(await sql`select versie from jarvis.v3_mandaten where taak_id = ${id} order by versie`).toEqual([{ versie: 1 }, { versie: 2 }]);
  });

  it("test 6/9: de volledige keten, en KLAAR alleen na gemeten bewijs per criterium", async () => {
    const id = nieuwId();
    await totUitvoeren(id);
    const pr = { repo: "lodewijkmaassen/tovas-flow", nummer: 7, sha: "deadbeef" };
    await expect(werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'CONTROLE', '{}'::jsonb)`)).rejects.toThrow(/bewijs\.pr/);
    await expect(werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'CONTROLE', ${JSON.stringify({ pr: { ...pr, repo: "andere/repo" } })}::text::jsonb)`)).rejects.toThrow(/buiten het mandaat/);
    await werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'CONTROLE', ${JSON.stringify({ pr })}::text::jsonb)`);
    // zonder GO geen uitrol
    await expect(werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'UITROL', '{}'::jsonb)`)).rejects.toThrow(/geen toetsing GO/);
    await werker((tx) => tx`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values (${pr.repo}, ${pr.nummer}, 'andere-kop', 'GO')`);
    await expect(werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'UITROL', '{}'::jsonb)`)).rejects.toThrow(/geen toetsing GO/); // GO op een andere kop telt niet
    await werker((tx) => tx`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values (${pr.repo}, ${pr.nummer}, ${pr.sha}, 'GO')`);
    await werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'UITROL', '{}'::jsonb)`);
    // productie=true: zonder deploybewijs niet verder
    await expect(werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'EINDCONTROLE', '{}'::jsonb)`)).rejects.toThrow(/gedeployed/);
    await werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'EINDCONTROLE', '{"gedeployed": true}'::jsonb)`);
    // KLAAR: elk criterium gemeten geslaagd
    const meet = (c: string, u: string) => ({ criterium: c, uitkomst: u, bewijs: "HTTP 200", gemeten_op: "2026-10-15T20:00:00Z" });
    await expect(werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'KLAAR', ${JSON.stringify({ eindcontrole: [meet("A1", "geslaagd")] })}::text::jsonb)`)).rejects.toThrow(/A2/);
    await expect(werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'KLAAR', ${JSON.stringify({ eindcontrole: [meet("A1", "geslaagd"), meet("A2", "mislukt")] })}::text::jsonb)`)).rejects.toThrow(/A2/);
    expect(await toestand(id)).toBe("EINDCONTROLE");
    await werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'KLAAR', ${JSON.stringify({ eindcontrole: [meet("A1", "geslaagd"), meet("A2", "geslaagd")] })}::text::jsonb)`);
    expect(await toestand(id)).toBe("KLAAR");
    const rij = (await sql`select eindcontrole, afgerond_op, lease_houder from jarvis.v3_taken where id = ${id}`)[0]!;
    expect(rij.eindcontrole).toHaveLength(2);
    expect(rij.afgerond_op).not.toBeNull();
    expect(rij.lease_houder).toBeNull();
  });

  it("dwingt de state machine af: sprongen en andermans lease worden geweigerd", async () => {
    const id = nieuwId();
    await totUitvoeren(id);
    for (const naar of ["KLAAR", "UITROL", "EINDCONTROLE", "ANALYSE", "AKKOORD_NODIG"]) {
      await expect(werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', ${naar}, '{}'::jsonb)`)).rejects.toThrow(/niet toegestaan|bewijs/);
    }
    await expect(werker((tx) => tx`select jarvis.v3_overgang(${id}, 'ander', 'CONTROLE', '{}'::jsonb)`)).rejects.toThrow(/geen geldige lease/);
    expect(await toestand(id)).toBe("UITVOEREN");
  });

  it("test 7: een verlopen lease komt vrij via de watchdog en een andere uitvoerder neemt over", async () => {
    const id = nieuwId();
    await totUitvoeren(id);
    expect(await werker((tx) => tx`select jarvis.v3_pak(${id}, 'cloud-2', 40) as ok`)).toEqual([{ ok: false }]); // lease van cloud-1 is nog geldig
    await sql`update jarvis.v3_taken set lease_tot = now() - interval '1 minute' where id = ${id}`; // sessie gestorven
    const w = await werker((tx) => tx`select * from jarvis.v3_watchdog()`);
    expect(w.map((r) => r.taak_id)).toContain(id);
    expect(await werker((tx) => tx`select jarvis.v3_pak(${id}, 'cloud-2', 40) as ok`)).toEqual([{ ok: true }]);
    expect((await sql`select poging, lease_houder from jarvis.v3_taken where id = ${id}`)[0]).toMatchObject({ lease_houder: "cloud-2" });
  });

  it("de dispatcher kan de routine hoogstens één keer per rustperiode claimen", async () => {
    expect(await werker((tx) => tx`select jarvis.v3_dispatch_claim(20) as ok`)).toEqual([{ ok: true }]);
    expect(await werker((tx) => tx`select jarvis.v3_dispatch_claim(20) as ok`)).toEqual([{ ok: false }]);
  });

  it("test 8: de views tonen exact de tabellen, zonder wachten op een run", async () => {
    const id = nieuwId();
    await totAkkoord(id);
    const a = await eigenaar((tx) => tx`select toestand, open_verzoeken::int as n from jarvis.v3_actueel where id = ${id}`);
    expect(a).toEqual([{ toestand: "AKKOORD_NODIG", n: 1 }]);
    await eigenaar((tx) => tx`select jarvis.v3_geef_mandaat(${id})`);
    const b = await eigenaar((tx) => tx`select toestand, open_verzoeken::int as n from jarvis.v3_actueel where id = ${id}`);
    expect(b).toEqual([{ toestand: "UITVOEREN", n: 0 }]);
  });
});
