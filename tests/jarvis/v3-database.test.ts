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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BLK1_AANVALLEN } from "./fixtures/v3-aanvallen";
import { genereerTekstSoep } from "./fixtures/v3-tekstsoep";
import { beoordeelSql } from "@/jarvis/src/v3";

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
  async function als<T>(rol: "jarvis_werker" | "jarvis_ci" | "authenticated", uid: string | null, f: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return (await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${rol}`);
      await tx.unsafe(`select set_config('test.uid', '${uid ?? ""}', true)`);
      return f(tx);
    })) as T;
  }
  const werker = <T>(f: (tx: postgres.TransactionSql) => Promise<T>) => als("jarvis_werker", null, f);
  const ci = <T>(f: (tx: postgres.TransactionSql) => Promise<T>) => als("jarvis_ci", null, f);
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
      if not exists (select 1 from pg_roles where rolname='jarvis_ci') then create role jarvis_ci nologin; end if;
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
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
      grant usage on schema jarvis to jarvis_werker, jarvis_ci, authenticated;
      -- Zoals bij een Supabase-achtige inrichting: nieuwe objecten in dit schema krijgen automatisch rechten voor
      -- anon, authenticated en service_role (BLK-3). De migratie moet die weer intrekken.
      alter default privileges in schema jarvis grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema jarvis grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema jarvis grant execute on functions to anon, authenticated, service_role;
      grant select, update on jarvis.antwoorden to jarvis_werker;
      grant insert, select on jarvis.toetsingen to jarvis_werker; grant usage on sequence jarvis.toetsingen_id_seq to jarvis_werker;
    `);
    await sql.unsafe(migratie);
    await sql.unsafe(migratie); // idempotent
    // De bootstrap: zonder vastgelegde eigenaar is niemand eigenaar (B1).
    await sql`insert into jarvis.v3_instellingen (sleutel, waarde) values ('eigenaar_uid', ${EIGENAAR})`;
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

  const meet = (c: string, u: string) => ({ criterium: c, uitkomst: u, bewijs: "HTTP 200", gemeten_op: "2026-10-15T20:00:00Z" });
  const PR = { repo: "lodewijkmaassen/tovas-flow", nummer: 7, sha: "deadbeefcafe" };

  async function totEindcontrole(id: string) {
    await totUitvoeren(id);
    await werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'CONTROLE', ${JSON.stringify({ pr: PR })}::text::jsonb)`);
    await werker((tx) => tx`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values (${PR.repo}, ${PR.nummer}, ${PR.sha}, 'GO')`);
    await ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id}, ${PR.repo}, ${PR.nummer}, ${PR.sha}, 'abcdef1234567')`);
    await werker((tx) => tx`select jarvis.v3_pak(${id}, 'cloud-1', 40)`);
    await werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'EINDCONTROLE', '{"gedeployed": true}'::jsonb)`);
  }

  it("BLK-E: de sweep ziet een NO-GO op de kop als geen GO (zodat hij niet eerst samenvoegt)", async () => {
    const { V3_TOETSING_GO_SQL } = await import("@/jarvis/src/v3-cli");
    const q = async (kop: string) => (await sql.unsafe(V3_TOETSING_GO_SQL, ["o/r", 77, kop])).length;
    await sql`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values ('o/r', 77, 'aaa1111', 'GO'), ('o/r', 77, 'bbb2222', 'GO')`;
    expect(await q("aaa1111")).toBe(1);
    await sql`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values ('o/r', 77, 'bbb2222', 'NO-GO')`;
    expect(await q("bbb2222")).toBe(0);
  });

  it("BLK-E: de uitvoerder kan geen lease nemen onder de naam van de CI, de eigenaar of de dispatcher", async () => {
    const id = nieuwId();
    await totUitvoeren(id);
    for (const h of ["ci", "CI", "eigenaar", "jarvis", "dispatcher"]) {
      await expect(werker((tx) => tx`select jarvis.v3_pak(${id}, ${h}, 40)`), h).rejects.toThrow(/gereserveerd/);
    }
  });

  it("test 6/9: de volledige keten; UITROL en KLAAR alleen door de CI-identiteit, KLAAR alleen na gemeten bewijs per criterium", async () => {
    const id = nieuwId();
    await totUitvoeren(id);
    await expect(werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'CONTROLE', '{}'::jsonb)`)).rejects.toThrow(/bewijs\.pr/);
    await expect(werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'CONTROLE', ${JSON.stringify({ pr: { ...PR, repo: "andere/repo" } })}::text::jsonb)`)).rejects.toThrow(/buiten het mandaat/);
    await werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'CONTROLE', ${JSON.stringify({ pr: PR })}::text::jsonb)`);
    // zonder GO op precies deze kop geen UITROL, ook niet voor de CI
    await expect(ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id}, ${PR.repo}, ${PR.nummer}, ${PR.sha}, 'abcdef1234567')`)).rejects.toThrow(/geen toetsing GO/);
    await werker((tx) => tx`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values (${PR.repo}, ${PR.nummer}, 'andere-kop', 'GO')`);
    await expect(ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id}, ${PR.repo}, ${PR.nummer}, ${PR.sha}, 'abcdef1234567')`)).rejects.toThrow(/geen toetsing GO/);
    await werker((tx) => tx`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values (${PR.repo}, ${PR.nummer}, ${PR.sha}, 'GO')`);
    // BLK-E: een NO-GO op dezelfde kop weegt zwaarder dan de GO, ook als hij later komt
    await werker((tx) => tx`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values (${PR.repo}, ${PR.nummer}, 'nogo0000abc', 'GO')`);
    await werker((tx) => tx`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values (${PR.repo}, ${PR.nummer}, 'nogo0000abc', 'NO-GO')`);
    await expect(ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id}, ${PR.repo}, ${PR.nummer}, 'nogo0000abc', 'abcdef1234567')`)).rejects.toThrow(/NO-GO/);
    await expect(ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id}, 'andere/repo', ${PR.nummer}, ${PR.sha}, 'abcdef1234567')`)).rejects.toThrow(/buiten het mandaat/);
    await ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id}, ${PR.repo}, ${PR.nummer}, ${PR.sha}, 'abcdef1234567')`);
    expect(await toestand(id)).toBe("UITROL");
    expect((await sql`select pr from jarvis.v3_taken where id = ${id}`)[0]!.pr).toMatchObject({ merge_sha: "abcdef1234567", nummer: PR.nummer });
    // productie=true: zonder deploybewijs niet verder
    await werker((tx) => tx`select jarvis.v3_pak(${id}, 'cloud-1', 40)`);
    await expect(werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'EINDCONTROLE', '{}'::jsonb)`)).rejects.toThrow(/gedeployed/);
    await werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'EINDCONTROLE', '{"gedeployed": true}'::jsonb)`);
    // KLAAR: elk criterium door de CI gemeten geslaagd; anders terug naar UITVOEREN
    await expect(ci((tx) => tx`select jarvis.v3_ci_eindcontrole(${id}, '{}'::text::jsonb)`)).rejects.toThrow(/lijst/);
    expect(await ci((tx) => tx`select jarvis.v3_ci_eindcontrole(${id}, ${JSON.stringify([meet("A1", "geslaagd"), meet("A2", "mislukt")])}::text::jsonb) as naar`)).toEqual([{ naar: "UITVOEREN" }]);
    expect(await toestand(id)).toBe("UITVOEREN");
    await werker((tx) => tx`select jarvis.v3_pak(${id}, 'cloud-1', 40)`);
    await werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'CONTROLE', ${JSON.stringify({ pr: PR })}::text::jsonb)`);
  });

  it("B6: de uitvoerder kan UITROL en KLAAR niet zelf vastleggen, ook niet met verzonnen bewijs en een vreemde PR", async () => {
    const id = nieuwId();
    await totUitvoeren(id);
    // de aanval van de reviewer: een PR die niets met de taak te maken heeft maar wel een GO heeft
    const vreemd = { repo: "lodewijkmaassen/tovas-flow", nummer: 99, sha: "zzzz" };
    await werker((tx) => tx`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values (${vreemd.repo}, ${vreemd.nummer}, ${vreemd.sha}, 'GO')`);
    await werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'CONTROLE', ${JSON.stringify({ pr: vreemd })}::text::jsonb)`);
    await expect(werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'UITROL', '{}'::jsonb)`)).rejects.toThrow(/niet toegestaan/);
    await expect(werker((tx) => tx`select jarvis.v3_ci_samengevoegd(${id}, ${vreemd.repo}, 99, 'zzzz', 'abcdef1234567')`)).rejects.toThrow(/permission denied/);
    await expect(werker((tx) => tx`select jarvis.v3_ci_eindcontrole(${id}, '[]'::text::jsonb)`)).rejects.toThrow(/permission denied/);
    expect(await toestand(id)).toBe("CONTROLE");
    // ook uit EINDCONTROLE is KLAAR voor de uitvoerder gesloten
    const id2 = nieuwId();
    await totEindcontrole(id2);
    await expect(werker((tx) => tx`select jarvis.v3_overgang(${id2}, 'cloud-1', 'KLAAR', ${JSON.stringify({ eindcontrole: [meet("A1", "geslaagd"), meet("A2", "geslaagd")] })}::text::jsonb)`)).rejects.toThrow(/niet toegestaan/);
    expect(await toestand(id2)).toBe("EINDCONTROLE");
    // de eigenaar en anonieme rollen kunnen het ook niet
    await expect(eigenaar((tx) => tx`select jarvis.v3_ci_eindcontrole(${id2}, '[]'::text::jsonb)`)).rejects.toThrow(/permission denied/);
    // alleen de CI, met bewijs voor elk criterium
    expect(await ci((tx) => tx`select jarvis.v3_ci_eindcontrole(${id2}, ${JSON.stringify([meet("A1", "geslaagd")])}::text::jsonb) as naar`)).toEqual([{ naar: "UITVOEREN" }]);
    const id3 = nieuwId();
    await totEindcontrole(id3);
    expect(await ci((tx) => tx`select jarvis.v3_ci_eindcontrole(${id3}, ${JSON.stringify([meet("A1", "geslaagd"), meet("A2", "geslaagd")])}::text::jsonb) as naar`)).toEqual([{ naar: "KLAAR" }]);
    const rij = (await sql`select toestand, eindcontrole, afgerond_op, lease_houder from jarvis.v3_taken where id = ${id3}`)[0]!;
    expect(rij.toestand).toBe("KLAAR");
    expect(rij.eindcontrole).toHaveLength(2);
    expect(rij.afgerond_op).not.toBeNull();
    expect(rij.lease_houder).toBeNull();
    // en de CI kan alleen vanuit de juiste toestand
    await expect(ci((tx) => tx`select jarvis.v3_ci_eindcontrole(${id}, '[]'::text::jsonb)`)).rejects.toThrow(/niet in EINDCONTROLE/);
  });

  it("B1: zonder vastgelegde eigenaar is niemand eigenaar, en de views zijn leeg voor wie dat niet is", async () => {
    const vreemd = "99999999-9999-9999-9999-999999999999";
    // een vreemde gebruiker kan niets: geen opdracht, geen mandaat, geen afwijzing
    await expect(als("authenticated", vreemd, (tx) => tx`select jarvis.v3_nieuwe_opdracht('Aanval', 'x')`)).rejects.toThrow(/alleen de eigenaar/);
    const id = nieuwId();
    await totAkkoord(id);
    await expect(als("authenticated", vreemd, (tx) => tx`select jarvis.v3_geef_mandaat(${id})`)).rejects.toThrow(/alleen de eigenaar/);
    await expect(als("authenticated", vreemd, (tx) => tx`select jarvis.v3_wijs_af(${id})`)).rejects.toThrow(/alleen de eigenaar/);
    // ... en leest niets: ook niet titel, toestand of mandaatvoorstel
    expect(await als("authenticated", vreemd, (tx) => tx`select * from jarvis.v3_actueel`)).toHaveLength(0);
    expect(await als("authenticated", vreemd, (tx) => tx`select * from jarvis.v3_voor_jou`)).toHaveLength(0);
    expect((await eigenaar((tx) => tx`select * from jarvis.v3_voor_jou where taak_id = ${id}`)).length).toBe(1);
    // de uitvoerder en de CI hebben geen eigenaarsviews, maar wel de werkview
    await expect(werker((tx) => tx`select * from jarvis.v3_voor_jou`)).rejects.toThrow(/permission denied/);
    await expect(werker((tx) => tx`select * from jarvis.v3_actueel`)).rejects.toThrow(/permission denied/);
    expect((await werker((tx) => tx`select * from jarvis.v3_actueel_werk where id = ${id}`)).length).toBe(1);
    expect((await ci((tx) => tx`select * from jarvis.v3_actueel_werk where id = ${id}`)).length).toBe(1);
    // zonder eigenaar_uid (verse installatie) is niemand eigenaar, ook niet een ingelogde gebruiker
    await sql`delete from jarvis.v3_instellingen where sleutel = 'eigenaar_uid'`;
    try {
      await expect(eigenaar((tx) => tx`select jarvis.v3_nieuwe_opdracht('Aanval', 'x')`)).rejects.toThrow(/alleen de eigenaar/);
      await expect(eigenaar((tx) => tx`select jarvis.v3_geef_mandaat(${id})`)).rejects.toThrow(/alleen de eigenaar/);
      expect(await eigenaar((tx) => tx`select * from jarvis.v3_actueel`)).toHaveLength(0);
    } finally {
      await sql`insert into jarvis.v3_instellingen (sleutel, waarde) values ('eigenaar_uid', ${EIGENAAR})`;
    }
  });

  it("een beslissing met de gereserveerde mandaatsleutel, of een voorstel zonder acceptatie, laat de taak niet vastlopen", async () => {
    const id = nieuwId();
    await totUitvoeren(id);
    await expect(werker((tx) => tx`select * from jarvis.v3_vraag(${id}, 'beslissing', 'mandaat-1', 'x', null, null)`)).rejects.toThrow(/gereserveerd/);
    const id2 = nieuwId();
    await werker(async (tx) => {
      await tx`select jarvis.v3_nieuwe_taak(${id2}, 'P', 'O', null)`;
      await tx`select jarvis.v3_pak(${id2}, 'c', 40)`;
      await tx`select jarvis.v3_overgang(${id2}, 'c', 'ANALYSE', '{}'::jsonb)`;
    });
    const { acceptatie: _weg, ...zonder } = MANDAAT;
    await expect(werker((tx) => tx`select jarvis.v3_vraag_akkoord(${id2}, ${JSON.stringify(zonder)}::text::jsonb)`)).rejects.toThrow(/acceptatie ontbreekt/);
    expect(await toestand(id2)).toBe("ANALYSE");
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

  // ---------------------------------------------------------------------------
  // BLK-3: wie mag welke V3-functie uitvoeren? De volledige matrix, ook voor PUBLIC en de rollen die via
  // standaardrechten automatisch rechten krijgen (anon, authenticated, service_role).
  const VERWACHT: Record<string, string[]> = {
    jarvis_werker: ["v3_nieuwe_taak", "v3_pak", "v3_hartslag", "v3_blokkade", "v3_watchdog", "v3_dispatch_claim", "v3_vraag", "v3_vraag_akkoord", "v3_meet_verzoek", "v3_overgang"],
    jarvis_ci: ["v3_watchdog", "v3_dispatch_claim", "v3_ci_samengevoegd", "v3_ci_eindcontrole"],
    authenticated: ["v3_geef_mandaat", "v3_wijs_af", "v3_beantwoord", "v3_nieuwe_opdracht", "v3_is_eigenaar"],
  };

  async function uitvoerrechten(db: postgres.Sql): Promise<Record<string, string[]>> {
    const rijen = await db`
      select p.proname as functie, coalesce(r.rolname, 'PUBLIC') as rol
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'jarvis'
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        left join pg_roles r on r.oid = a.grantee
       where p.proname like 'v3\_%' and a.privilege_type = 'EXECUTE' and coalesce(r.rolname, 'PUBLIC') <> current_user`;
    const uit: Record<string, string[]> = {};
    for (const r of rijen) (uit[String(r.rol)] ??= []).push(String(r.functie));
    for (const k of Object.keys(uit)) uit[k]!.sort();
    return uit;
  }
  const gesorteerd = (m: Record<string, string[]>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]));

  it("BLK-3: de EXECUTE-matrix van alle v3_*-functies is exact de bedoelde, ondanks standaardrechten voor anon/authenticated/service_role", async () => {
    expect(await uitvoerrechten(sql)).toEqual(gesorteerd(VERWACHT));
    // geen enkel recht op de V3-tabellen en -views voor anon of service_role, en geen schrijfrecht voor wie dan ook
    const tabelRechten = await sql`
      select grantee, table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'jarvis' and table_name like 'v3\_%' and grantee in ('anon', 'service_role', 'PUBLIC', 'jarvis_werker', 'jarvis_ci', 'authenticated')
         and not (grantee = 'authenticated' and table_name in ('v3_voor_jou', 'v3_actueel') and privilege_type = 'SELECT')
         and not (grantee in ('jarvis_werker', 'jarvis_ci') and table_name in ('v3_actueel_werk', 'v3_werk', 'v3_verzoeken_zicht') and privilege_type = 'SELECT')`;
    expect(tabelRechten).toEqual([]);
    const reeks = await sql`select has_sequence_privilege(r, 'jarvis.v3_gebeurtenissen_id_seq', 'USAGE') as ja, r from unnest(array['anon','authenticated','service_role','jarvis_werker','jarvis_ci']) r`;
    expect(reeks.filter((x) => x.ja)).toEqual([]);
  });

  it("BLK-3: een vreemde ingelogde gebruiker en anon kunnen niets aanroepen, ook niet met standaardrechten op het schema", async () => {
    await expect(als("authenticated", "99999999-9999-9999-9999-999999999999", (tx) => tx`select jarvis.v3_nieuwe_taak('V3-20261015-vreemd', 't', 'o', null)`)).rejects.toThrow(/permission denied/);
    await expect(als("authenticated", "99999999-9999-9999-9999-999999999999", (tx) => tx`select jarvis.v3_pak('V3-20261015-x', 'x', 40)`)).rejects.toThrow(/permission denied/);
    await expect(als("authenticated", EIGENAAR, (tx) => tx`select jarvis.v3_ci_eindcontrole('V3-20261015-x', '[]'::text::jsonb)`)).rejects.toThrow(/permission denied/);
    await sql.begin(async (tx) => {
      await tx.unsafe("set local role anon");
      await expect(tx`select jarvis.v3_watchdog()`).rejects.toThrow(/permission denied/);
    }).catch((e) => { if (!/permission denied/.test(String(e))) throw e; });
  });

  it("BLK-3: dezelfde inrichting zonder de reparatie lekt wél (negatieve controle op de test zelf)", async () => {
    // Een kopie van de migratie zonder de intrekking van anon/authenticated/service_role in de functielus.
    const lek = migratie.replace("for r in select unnest(array['jarvis_werker','jarvis_ci','authenticated','anon','service_role']) loop\n      continue when not exists (select 1 from pg_roles where rolname = r);\n      execute format('revoke all on function %s from %I', f, r);", "for r in select unnest(array['jarvis_werker']) loop\n      continue when not exists (select 1 from pg_roles where rolname = r);\n      execute format('revoke all on function %s from %I', f, r);");
    expect(lek).not.toBe(migratie);
    const naam = `${dbNaam}_lek`;
    await admin.unsafe(`create database ${naam}`);
    const url = new URL(BASIS);
    url.pathname = `/${naam}`;
    const db = postgres(url.toString(), { max: 1 });
    try {
      await db.unsafe(`create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$; create schema jarvis;
        create table jarvis.toetsingen (id bigserial primary key, pr_repo text, pr_nummer int, commit_sha text, oordeel text);
        alter default privileges in schema jarvis grant execute on functions to anon, authenticated, service_role;`);
      await db.unsafe(lek);
      const m = await uitvoerrechten(db);
      expect(m["anon"] ?? []).toContain("v3_overgang");
    } finally {
      await db.end({ timeout: 2 });
      await admin.unsafe(`drop database if exists ${naam} with (force)`);
    }
  });

  it("schemagebruik: alleen de drie rollen die V3 gebruiken krijgen USAGE op schema jarvis; anon en service_role niet", async () => {
    const r = await sql`select r as rol, has_schema_privilege(r, 'jarvis', 'USAGE') as ja from unnest(array['anon','service_role','jarvis_werker','jarvis_ci','authenticated']) r`;
    expect(Object.fromEntries(r.map((x) => [x.rol, x.ja]))).toEqual({ anon: false, service_role: false, jarvis_werker: true, jarvis_ci: true, authenticated: true });
  });

  it("NB-2: bin/ valt buiten ieder mandaat, ook in de database (verboden pad én altijd in paden_nee)", async () => {
    expect((await sql`select jarvis.v3_verboden_pad('bin/jarvis.mjs') as ja, jarvis.v3_verboden_pad('bin') as ja2`)[0]).toEqual({ ja: true, ja2: true });
    const id = nieuwId();
    await werker(async (tx) => {
      await tx`select jarvis.v3_nieuwe_taak(${id}, 'P', 'O', null)`;
      await tx`select jarvis.v3_pak(${id}, 'c', 40)`;
      await tx`select jarvis.v3_overgang(${id}, 'c', 'ANALYSE', '{}'::jsonb)`;
    });
    await expect(werker((tx) => tx`select jarvis.v3_vraag_akkoord(${id}, ${JSON.stringify({ ...MANDAAT, paden_ja: ["bin/**"] })}::text::jsonb)`)).rejects.toThrow(/veiligheidsgrens/);
    const id2 = nieuwId();
    await totAkkoord(id2);
    await eigenaar((tx) => tx`select jarvis.v3_geef_mandaat(${id2})`);
    expect((await sql`select paden_nee from jarvis.v3_mandaten where taak_id = ${id2}`)[0]!.paden_nee).toContain("bin/**");
  });

  it("R-1: de guard vergelijkt de repository hoofdletterongevoelig", async () => {
    const SLUG_HL = "lodewijkmaassen/Tovas-Flow";
    const id = nieuwId();
    await totUitvoeren(id);
    // een mandaat met beide spellingen, zoals GitHub ze beide accepteert
    const id2 = nieuwId();
    await totAkkoord(id2, { ...MANDAAT, repos: ["lodewijkmaassen/tovas-flow", SLUG_HL] });
    await eigenaar((tx) => tx`select jarvis.v3_geef_mandaat(${id2})`);
    await werker(async (tx) => {
      await tx`select jarvis.v3_pak(${id2}, 'cloud-1', 40)`;
      await tx`select jarvis.v3_overgang(${id2}, 'cloud-1', 'CONTROLE', ${JSON.stringify({ pr: { repo: "lodewijkmaassen/tovas-flow", nummer: 41, sha: "abc1234" } })}::text::jsonb)`;
      await tx`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values ('lodewijkmaassen/tovas-flow', 41, 'abc1234', 'GO'), (${SLUG_HL}, 41, 'abc1234', 'GO')`;
    });
    await ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id2}, 'lodewijkmaassen/tovas-flow', 41, 'abc1234', 'abcdef1234567')`);
    await ci((tx) => tx`select jarvis.v3_ci_eindcontrole(${id2}, ${JSON.stringify([meet("A1", "mislukt")])}::text::jsonb)`).catch(() => {});
    // vanuit UITROL: eerst naar EINDCONTROLE en terug, zodat een tweede vastlegging überhaupt kan
    await werker(async (tx) => {
      await tx`select jarvis.v3_pak(${id2}, 'cloud-2', 40)`;
      await tx`select jarvis.v3_overgang(${id2}, 'cloud-2', 'EINDCONTROLE', '{"gedeployed": true}'::jsonb)`;
    });
    await ci((tx) => tx`select jarvis.v3_ci_eindcontrole(${id2}, ${JSON.stringify([meet("A1", "mislukt")])}::text::jsonb)`);
    expect(await toestand(id2)).toBe("UITVOEREN");
    await expect(ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id2}, ${SLUG_HL}, 41, 'abc1234', 'abcdef1234567')`)).rejects.toThrow(/al vastgelegd/);
    expect(await toestand(id2)).toBe("UITVOEREN");
    void id;
  });

  // ---------------------------------------------------------------------------
  // BLK-1 tegen ECHTE PostgreSQL: eerst bewijzen dat de aanval werkelijk werkt (het effect treedt op), dan dat
  // de scanner hem weigert. Elke aanval draait in een transactie die altijd wordt teruggedraaid.
  describe("BLK-1: de omzeilingen van de migratiescanner, tegen echte PostgreSQL", () => {
    class Terugdraaien extends Error {}
    async function opScratch<T>(f: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
      let uit: T | undefined;
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(`create table public.klanten (id int); insert into public.klanten values (1), (2), (3);
            create table public.klanten2 (id int); create table public.t (n name);`);
          uit = await f(tx);
          throw new Terugdraaien();
        });
      } catch (e) {
        if (!(e instanceof Terugdraaien)) throw e;
      }
      return uit as T;
    }

    const metEffect = BLK1_AANVALLEN.filter((a) => a.effect !== undefined);

    it.each(metEffect.map((a) => [a.naam, a] as const))("de aanval werkt echt, en de scanner weigert hem: %s", async (_naam, a) => {
      const gewerkt = await opScratch(async (tx) => {
        await tx.unsafe(a.sql);
        return await a.effect!(tx as unknown as { unsafe: (s: string) => Promise<readonly Record<string, unknown>[]> });
      });
      expect(gewerkt, "controle op de test zelf: de SQL doet in PostgreSQL werkelijk wat de aanvaller wil").toBe(true);
      expect(beoordeelSql(a.sql, false).length, "zonder destructief-mandaat").toBeGreaterThan(0);
      if (a.altijd) expect(beoordeelSql(a.sql, true).length, "ook met destructief-mandaat").toBeGreaterThan(0);
    });

    it("differentieel: geen enkele tekstketen die de scanner doorlaat heeft in PostgreSQL effect (24.000 gevallen)", async () => {
      let doorgelaten = 0;
      let uitgevoerd = 0;
      const missers: string[] = [];
      for (const q of [...genereerTekstSoep(11, 12000), ...genereerTekstSoep(12, 12000)]) {
        const nd = beoordeelSql(q, false).length === 0;
        const dd = beoordeelSql(q, true).length === 0;
        if (!nd && !dd) continue;
        doorgelaten += 1;
        const effect = await opScratch(async (tx) => {
          try {
            await tx.savepoint(async (sp) => {
              await sp.unsafe(q);
              uitgevoerd += 1;
              const weg = (await sp.unsafe("select to_regclass('public.klanten') is null as w"))[0]!.w === true;
              const jarvis = ((await sp.unsafe("select count(*)::int as n from jarvis.v3_instellingen where sleutel = 'qa-soep'"))[0]!.n as number) > 0;
              throw Object.assign(new Error("effect"), { weg, jarvis });
            });
          } catch (e) {
            if (e instanceof Error && e.message === "effect") return e as Error & { weg: boolean; jarvis: boolean };
            return null;
          }
          return null;
        });
        if (effect !== null && ((effect.weg && nd) || effect.jarvis)) missers.push(q);
      }
      expect(missers.slice(0, 3)).toEqual([]);
      expect(doorgelaten).toBeGreaterThan(400);
      expect(uitgevoerd, "controle op de test zelf: een deel van de doorgelaten gevallen wordt echt uitgevoerd").toBeGreaterThan(40);
    }, 600_000);

    it("dezelfde lijst is verwerpelijk voor de scanner ook zonder effectcontrole (inclusief de gevallen zonder meetbaar effect)", () => {
      for (const a of BLK1_AANVALLEN) expect(beoordeelSql(a.sql, false).length, a.naam).toBeGreaterThan(0);
    });

    it("de scanner ziet dezelfde statements als PostgreSQL: een gewone, goedaardige migratie wordt wél doorgelaten en werkt", async () => {
      const goed = "create table public.nieuw_qa (id int primary key, naam text default 'it''s -- /* niet echt'); create index nieuw_qa_idx on public.nieuw_qa (naam);";
      expect(beoordeelSql(goed, false)).toEqual([]);
      const aanwezig = await opScratch(async (tx) => {
        await tx.unsafe(goed);
        return (await tx.unsafe("select to_regclass('public.nieuw_qa') is not null as ja"))[0]?.["ja"] === true;
      });
      expect(aanwezig).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // De poort end-to-end: de echte CLI-code (`jarvis v3 beoordeel-pr`) tegen de echte
  // database, met alleen GitHub gestubd. De stub volgt de vorm van de GitHub-API
  // (inclusief `previous_filename` bij een hernoeming); echt GitHub-gedrag is hier niet gemeten.
  describe("de poort end-to-end (GitHub gestubd)", () => {
    const SLUG = "lodewijkmaassen/tovas-flow";
    const KOP = "c0ffee0123456789c0ffee0123456789c0ffee01";
    const MERGE = "feedface0123456789feedface0123456789feed";
    type Bestand = { filename: string; previous_filename?: string; status: string };
    let aanroepen: { methode: string; pad: string }[] = [];
    let oud: Record<string, string | undefined> = {};

    function stubGitHub(id: string, bestanden: Bestand[], opties: { merged?: boolean; migratieSql?: string; gesloten?: unknown[]; basis?: string; bestanden?: Record<string, string>; reviews?: unknown[]; bijVerseLeesbeurt?: () => Promise<void> } = {}) {
      aanroepen = [];
      let leesbeurten = 0;
      let gemerged = opties.merged === true;
      vi.stubGlobal("fetch", async (invoer: string | URL, init?: { method?: string; body?: string }) => {
        const url = new URL(String(invoer));
        const methode = init?.method ?? "GET";
        const pad = url.pathname;
        aanroepen.push({ methode, pad });
        const antwoord = (lading: unknown, status = 200) => new Response(JSON.stringify(lading), { status, headers: { "content-type": "application/json" } });
        if (methode === "GET" && pad === `/repos/${SLUG}/pulls`) return antwoord(url.searchParams.get("state") === "closed" ? (opties.gesloten ?? []) : []);
        if (methode === "GET" && pad === `/repos/${SLUG}/pulls/5`) {
          leesbeurten += 1;
          if (leesbeurten === 3) await opties.bijVerseLeesbeurt?.();
        }
        if (methode === "GET" && pad === `/repos/${SLUG}/pulls/5`)
          return antwoord({ user: { login: "tovas-jarvis-bot" }, head: { sha: KOP }, base: { ref: opties.basis ?? "main" }, state: gemerged ? "closed" : "open", draft: false, mergeable: true, mergeable_state: "clean", body: "Uitzonderingen: geen", merged: gemerged, merge_commit_sha: gemerged ? MERGE : null });
        if (methode === "GET" && pad === `/repos/${SLUG}/pulls/5/reviews`) return antwoord(opties.reviews ?? []);
        if (methode === "PUT" && pad.startsWith(`/repos/${SLUG}/pulls/5/reviews/`) && pad.endsWith("/dismissals")) return antwoord({});
        if (methode === "GET" && pad === `/repos/${SLUG}/commits/${KOP}/check-runs`) return antwoord({ check_runs: [{ name: "poort", status: "completed", conclusion: "success" }] });
        if (methode === "GET" && pad === `/repos/${SLUG}/pulls/5/commits`)
          return antwoord([{ sha: KOP, commit: { message: `werk\n\nJarvis-Role: developer\nJarvis-Task: ${id}` }, parents: [{}] }]);
        if (methode === "GET" && pad === `/repos/${SLUG}/pulls/5/files`) return antwoord(bestanden);
        if (methode === "GET" && pad.startsWith(`/repos/${SLUG}/contents/`)) {
          // Zoals GitHub: de URL is de waarheid. Een `?` of `#` die niet is gecodeerd, begint een query of fragment,
          // en het opgevraagde bestand is dan een ANDER bestand. Met `bestanden` staat per pad vast wat er werkelijk staat.
          if (opties.bestanden !== undefined) {
            const gevraagd = decodeURIComponent(pad.slice(`/repos/${SLUG}/contents/`.length));
            const inhoud = opties.bestanden[gevraagd];
            return inhoud === undefined ? antwoord({ message: "Not Found" }, 404) : antwoord({ encoding: "base64", content: Buffer.from(inhoud).toString("base64") });
          }
          return antwoord({ encoding: "base64", content: Buffer.from(opties.migratieSql ?? "select 1;").toString("base64") });
        }
        if (methode === "POST" && pad === `/repos/${SLUG}/pulls/5/reviews`) return antwoord({});
        if (methode === "PUT" && pad === `/repos/${SLUG}/pulls/5/merge`) {
          gemerged = true;
          return antwoord({ sha: MERGE });
        }
        return antwoord({ message: `ongestubd: ${methode} ${pad}` }, 404);
      });
    }
    const schrijfacties = () => aanroepen.filter((a) => a.methode !== "GET");

    async function taakKlaarVoorPr(mandaat: object) {
      const id = nieuwId();
      await totAkkoord(id, mandaat);
      await eigenaar((tx) => tx`select jarvis.v3_geef_mandaat(${id})`);
      await werker(async (tx) => {
        await tx`select jarvis.v3_pak(${id}, 'cloud-1', 40)`;
        await tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'CONTROLE', ${JSON.stringify({ pr: { repo: SLUG, nummer: 5, sha: KOP } })}::text::jsonb)`;
        await tx`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values (${SLUG}, 5, ${KOP}, 'GO')`;
      });
      return id;
    }
    async function beoordeel(extra: string[] = []): Promise<number> {
      const { voerV3Uit } = await import("@/jarvis/src/v3-cli");
      const stil = vi.spyOn(console, "error").mockImplementation(() => {});
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        return await voerV3Uit(["beoordeel-pr", "5", "--repo", SLUG, ...extra]);
      } finally {
        stil.mockRestore();
        log.mockRestore();
      }
    }

    beforeAll(async () => {
      await admin.unsafe("alter role jarvis_ci login");
      const url = new URL(BASIS);
      url.pathname = `/${dbNaam}`;
      url.username = "jarvis_ci";
      oud = { JARVIS_DB_URL: process.env.JARVIS_DB_URL, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
      process.env.JARVIS_DB_URL = url.toString();
      process.env.GITHUB_TOKEN = "test-token-niet-echt";
    });
    afterAll(async () => {
      for (const [k, v] of Object.entries(oud)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await admin.unsafe("alter role jarvis_ci nologin");
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("keurt werk binnen het mandaat goed, voegt samen en legt als CI UITROL vast", async () => {
      const id = await taakKlaarVoorPr(MANDAAT);
      stubGitHub(id, [{ filename: "app/v3-proef/page.tsx", status: "added" }]);
      expect(await beoordeel(["--samenvoegen"])).toBe(0);
      expect(schrijfacties().map((a) => `${a.methode} ${a.pad.split("/").slice(-1)[0]}`)).toEqual(["POST reviews", "PUT merge"]);
      expect(await toestand(id)).toBe("UITROL");
      expect((await sql`select pr from jarvis.v3_taken where id = ${id}`)[0]!.pr).toMatchObject({ merge_sha: MERGE, nummer: 5, sha: KOP });
    });

    it("BLK-F: een NO-GO die na de beoordeling maar vóór het samenvoegen komt, voorkomt de merge en trekt de goedkeuring in", async () => {
      const id = await taakKlaarVoorPr(MANDAAT);
      stubGitHub(id, [{ filename: "app/v3-proef/page.tsx", status: "added" }], {
        reviews: [{ id: 901, state: "APPROVED", commit_id: KOP, body: "Attestatie V3: x", user: { login: "github-actions[bot]" } }],
        bijVerseLeesbeurt: async () => {
          await sql`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values (${SLUG}, 5, ${KOP}, 'NO-GO')`;
        },
      });
      expect(await beoordeel(["--samenvoegen"])).toBe(3);
      expect(aanroepen.some((a) => a.methode === "PUT" && a.pad.endsWith("/merge"))).toBe(false);
      expect(aanroepen.some((a) => a.methode === "PUT" && a.pad === `/repos/${SLUG}/pulls/5/reviews/901/dismissals`)).toBe(true);
      expect(await toestand(id)).toBe("CONTROLE");
      await sql`delete from jarvis.toetsingen where oordeel = 'NO-GO' and pr_nummer = 5`;
    });

    it("BLK-F: een NO-GO op een stilstaande goedkeuring trekt die in bij elke ronde (geen merge)", async () => {
      const id = await taakKlaarVoorPr(MANDAAT);
      await sql`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values (${SLUG.toUpperCase()}, 5, ${KOP}, 'NO-GO')`; // andere hoofdletters, zelfde repo
      stubGitHub(id, [{ filename: "app/v3-proef/page.tsx", status: "added" }], {
        reviews: [{ id: 902, state: "APPROVED", commit_id: KOP, body: "Attestatie V3: x", user: { login: "github-actions[bot]" } }],
      });
      expect(await beoordeel(["--samenvoegen"])).toBe(3);
      expect(aanroepen.some((a) => a.pad === `/repos/${SLUG}/pulls/5/reviews/902/dismissals`)).toBe(true);
      expect(schrijfacties().some((a) => a.pad.endsWith("/merge"))).toBe(false);
      await sql`delete from jarvis.toetsingen where oordeel = 'NO-GO' and pr_nummer = 5`;
    });

    it("B2: een hernoeming vanuit een beschermd pad wordt geweigerd, voor elk beschermd pad", async () => {
      const beschermd = [
        ".github/workflows/jarvis-v3.yml", ".github/workflows/jarvis-lint.yml", "jarvis/canonical/jarvis-v3.yml", "CODEOWNERS",
        "jarvis.config.yml", "jarvis/src/attestatie.ts", "jarvis/src/v3.ts", ".claude/settings.json", "package.json", "package-lock.json",
      ];
      for (const oudPad of beschermd) {
        const id = await taakKlaarVoorPr(MANDAAT);
        stubGitHub(id, [{ filename: "app/v3-proef/verplaatst.txt", previous_filename: oudPad, status: "renamed" }]);
        expect(await beoordeel(["--samenvoegen"]), oudPad).toBe(3);
        expect(schrijfacties(), `${oudPad}: er mag niets geschreven zijn`).toEqual([]);
        expect(await toestand(id)).toBe("CONTROLE");
      }
    });

    it("B4: ook de poortcode, de pin van de engine en npm-configuratie zijn voor een mandaat gesloten (breed mandaat)", async () => {
      const breed = { ...MANDAAT, paden_ja: ["app/**", "jarvis/**", "package*.json", ".npmrc", "sub/**"] };
      for (const pad of ["jarvis/src/v3.ts", "jarvis/edge/jarvis-db/index.ts", "jarvis/migrations/v3/0002_x.sql", "jarvis/migrations/0002_x.sql", "package.json", "package-lock.json", ".npmrc", "sub/jarvis.config.yml", "sub/package.json"]) {
        const id = await taakKlaarVoorPr(breed);
        stubGitHub(id, [{ filename: pad, status: "modified" }]);
        expect(await beoordeel(["--samenvoegen"]), pad).toBe(3);
        expect(schrijfacties(), pad).toEqual([]);
      }
    });

    it("B5 via de poort: een migratie met omzeil-SQL wordt geweigerd, een additieve migratie met migraties: true niet", async () => {
      const m = { ...MANDAAT, paden_ja: ["app/**", "supabase/migrations/*.sql"], migraties: true };
      const aanval = "select '--'; drop table klanten;";
      const id = await taakKlaarVoorPr(m);
      stubGitHub(id, [{ filename: "supabase/migrations/0013_x.sql", status: "added" }], { migratieSql: aanval });
      expect(await beoordeel(["--samenvoegen"])).toBe(3);
      expect(schrijfacties()).toEqual([]);
      const id2 = await taakKlaarVoorPr(m);
      stubGitHub(id2, [{ filename: "supabase/migrations/0013_x.sql", status: "added" }], { migratieSql: "create table nieuw (id int);" });
      expect(await beoordeel(["--samenvoegen"])).toBe(0);
      expect(await toestand(id2)).toBe("UITROL");
    });

    it("productie: false — de poort keurt niet goed en voegt niet samen", async () => {
      const id = await taakKlaarVoorPr({ ...MANDAAT, productie: false });
      stubGitHub(id, [{ filename: "app/v3-proef/page.tsx", status: "added" }]);
      expect(await beoordeel(["--samenvoegen"])).toBe(0);
      expect(schrijfacties()).toEqual([]);
      expect(await toestand(id)).toBe("CONTROLE");
    });

    it("een al samengevoegde pull request (herstel, of door de eigenaar) wordt alleen nog vastgelegd, na dezelfde beoordeling", async () => {
      const id = await taakKlaarVoorPr({ ...MANDAAT, productie: false });
      stubGitHub(id, [{ filename: "app/v3-proef/page.tsx", status: "added" }], { merged: true });
      expect(await beoordeel()).toBe(0);
      expect(schrijfacties()).toEqual([]);
      expect(await toestand(id)).toBe("UITROL");
      const id2 = await taakKlaarVoorPr(MANDAAT);
      stubGitHub(id2, [{ filename: ".github/workflows/x.yml", status: "modified" }], { merged: true });
      expect(await beoordeel()).toBe(3); // ook een al gemerged PR die buiten het mandaat valt, wordt niet vastgelegd
      expect(await toestand(id2)).toBe("CONTROLE");
    });

    it("BLK-B: een bestandsnaam met ? # of & laat de poort niet een ander bestand toetsen dan het samengevoegde", async () => {
      const m = { ...MANDAAT, paden_ja: ["app/**", "supabase/migrations/*.sql"], migraties: true, destructief: false };
      for (const naam of ["0101_qa?ref=benign&x=.sql", "0101_qa#x.sql", "0101_qa&y=.sql"]) {
        const id = await taakKlaarVoorPr(m);
        const echt = `supabase/migrations/${naam}`;
        const afgekapt = echt.split(/[?#&]/)[0]!;
        // Het afgekapte pad is een ander, goedaardig bestand; het echte bestand bevat de aanval.
        stubGitHub(id, [{ filename: echt, status: "added" }], { bestanden: { [afgekapt]: "create table public.goedaardig (id int);", [echt]: "drop table public.klanten;" } });
        expect(await beoordeel(["--samenvoegen"]), naam).toBe(3);
        expect(schrijfacties(), naam).toEqual([]);
        expect(await toestand(id), naam).toBe("CONTROLE");
      }
    });

    it("R-2: een pull request naar een andere branch dan main wordt niet goedgekeurd en niet samengevoegd", async () => {
      const id = await taakKlaarVoorPr(MANDAAT);
      stubGitHub(id, [{ filename: "app/v3-proef/page.tsx", status: "added" }], { basis: "jarvis/andere" });
      expect(await beoordeel(["--samenvoegen"])).toBe(3);
      expect(schrijfacties()).toEqual([]);
      expect(await toestand(id)).toBe("CONTROLE");
    });

    async function totUitrol(id: string) {
      stubGitHub(id, [{ filename: "app/v3-proef/page.tsx", status: "added" }]);
      expect(await beoordeel(["--samenvoegen"])).toBe(0);
      expect(await toestand(id)).toBe("UITROL");
    }
    async function sweepRonde(id: string, extra: Parameters<typeof stubGitHub>[2] = {}): Promise<number> {
      stubGitHub(id, [{ filename: "app/v3-proef/page.tsx", status: "added" }], {
        merged: true,
        gesloten: [{ number: 5, merged_at: new Date().toISOString(), user: { login: "tovas-jarvis-bot" }, head: { ref: "jarvis/x" }, base: { ref: "main" } }],
        ...extra,
      });
      const { voerV3Uit } = await import("@/jarvis/src/v3-cli");
      const stil = vi.spyOn(console, "error").mockImplementation(() => {});
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        return await voerV3Uit(["sweep", "--repo", SLUG]);
      } finally {
        stil.mockRestore();
        log.mockRestore();
      }
    }

    it("R-1: na een mislukte eindcontrole zet het herstel van de sweep een al vastgelegde PR niet opnieuw op UITROL en wist de lease niet", async () => {
      const id = await taakKlaarVoorPr(MANDAAT);
      await totUitrol(id);
      await werker(async (tx) => {
        await tx`select jarvis.v3_pak(${id}, 'cloud-1', 40)`;
        await tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'EINDCONTROLE', '{"gedeployed": true}'::jsonb)`;
      });
      await ci((tx) => tx`select jarvis.v3_ci_eindcontrole(${id}, ${JSON.stringify([meet("A1", "mislukt")])}::text::jsonb)`);
      expect(await toestand(id)).toBe("UITVOEREN");
      await werker((tx) => tx`select jarvis.v3_pak(${id}, 'cloud-3', 40)`);
      expect(await sweepRonde(id)).toBe(0);
      expect(await toestand(id)).toBe("UITVOEREN");
      expect((await sql`select lease_houder from jarvis.v3_taken where id = ${id}`)[0]!.lease_houder).toBe("cloud-3");
    });

    it("R-1 (database): dezelfde pull request wordt voor een taak maar één keer vastgelegd, ook als de uitvoerder opnieuw naar CONTROLE gaat", async () => {
      const id = await taakKlaarVoorPr(MANDAAT);
      await totUitrol(id);
      await werker(async (tx) => {
        await tx`select jarvis.v3_pak(${id}, 'cloud-1', 40)`;
        await tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'EINDCONTROLE', '{"gedeployed": true}'::jsonb)`;
      });
      await ci((tx) => tx`select jarvis.v3_ci_eindcontrole(${id}, ${JSON.stringify([meet("A1", "mislukt")])}::text::jsonb)`);
      // de uitvoerder meldt dezelfde (al samengevoegde) PR opnieuw; dat wist merge_sha uit de taak, dus de sweep-controle ziet het niet meer
      await werker(async (tx) => {
        await tx`select jarvis.v3_pak(${id}, 'cloud-3', 40)`;
        await tx`select jarvis.v3_overgang(${id}, 'cloud-3', 'CONTROLE', ${JSON.stringify({ pr: { repo: SLUG, nummer: 5, sha: KOP } })}::text::jsonb)`;
      });
      await expect(ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id}, ${SLUG}, 5, ${KOP}, ${MERGE})`)).rejects.toThrow(/al vastgelegd/);
      expect(await sweepRonde(id)).toBe(0);
      expect(await toestand(id)).toBe("CONTROLE");
      // een ANDERE pull request voor dezelfde taak mag wel
      await werker((tx) => tx`insert into jarvis.toetsingen (pr_repo, pr_nummer, commit_sha, oordeel) values (${SLUG}, 6, ${KOP}, 'GO')`);
      await ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id}, ${SLUG}, 6, ${KOP}, ${MERGE})`);
      expect(await toestand(id)).toBe("UITROL");
    });

    describe("R-3: het bouwmerk op productie mag een nazaat van de samenvoegcommit zijn", () => {
      const PROD = "https://prod.invalid/v3-proef";
      const mandaatBouwmerk = { ...MANDAAT, acceptatie: [{ id: "A1", omschrijving: "pagina met bouwmerk", meting: { soort: "http", url: PROD, bevat: "V3 werkt", bouwmerk: true } }] };

      async function inEindcontrole() {
        const id = await taakKlaarVoorPr(mandaatBouwmerk);
        await ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id}, ${SLUG}, 5, ${KOP}, ${MERGE})`);
        await werker(async (tx) => {
          await tx`select jarvis.v3_pak(${id}, 'cloud-1', 40)`;
          await tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'EINDCONTROLE', '{"gedeployed": true}'::jsonb)`;
        });
        return id;
      }
      async function meetOp(merk: string, vergelijkStatus: string): Promise<number> {
        const aanroepen: string[] = [];
        vi.stubGlobal("fetch", async (invoer: string | URL) => {
          const url = new URL(String(invoer));
          aanroepen.push(url.pathname);
          if (url.host === "prod.invalid") return new Response(`<meta name="jarvis-bouwmerk" content="${merk}"><p>V3 werkt</p>`, { status: 200 });
          if (url.pathname.startsWith(`/repos/${SLUG}/compare/`)) return new Response(JSON.stringify({ status: vergelijkStatus }), { status: 200 });
          return new Response("{}", { status: 404 });
        });
        const { voerV3Uit } = await import("@/jarvis/src/v3-cli");
        const stil = vi.spyOn(console, "error").mockImplementation(() => {});
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
          return await voerV3Uit(["eindcontrole"]);
        } finally {
          stil.mockRestore();
          log.mockRestore();
        }
      }

      it("slaagt bij het bouwmerk van de samenvoegcommit zelf (zonder compare-aanroep)", async () => {
        const id = await inEindcontrole();
        expect(await meetOp(MERGE.slice(0, 7), "diverged")).toBe(0);
        expect(await toestand(id)).toBe("KLAAR");
      });
      it("slaagt bij een nazaat (main is intussen verder), en faalt bij een commit die er geen nazaat van is", async () => {
        const id = await inEindcontrole();
        expect(await meetOp("9999999", "ahead")).toBe(0);
        expect(await toestand(id)).toBe("KLAAR");
        const id2 = await inEindcontrole();
        expect(await meetOp("9999999", "diverged")).toBe(0);
        expect(await toestand(id2)).toBe("UITVOEREN");
        const id3 = await inEindcontrole();
        expect(await meetOp("9999999", "behind")).toBe(0);
        expect(await toestand(id3)).toBe("UITVOEREN");
      });
    });

    describe("de migratieroute end-to-end (echte PostgreSQL voor de migratie, GitHub gestubd)", () => {
      const BASIS_SHA = "a".repeat(40);
      const MIGRATIE = "supabase/migrations/0101_qa.sql";
      const MANDAAT_MIG = { ...MANDAAT, paden_ja: ["app/**", "supabase/migrations/*.sql"], migraties: true, destructief: false };
      let oudEnv: Record<string, string | undefined> = {};

      beforeAll(async () => {
        await admin.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'qa_migrator') then create role qa_migrator login; end if; end $$`);
        await sql.unsafe(`grant usage, create on schema public to qa_migrator;
          create table if not exists public.qa_ledger (version text, name text, statements text[]);
          grant all on public.qa_ledger to qa_migrator;`);
        const url = new URL(BASIS);
        url.pathname = `/${dbNaam}`;
        url.username = "qa_migrator";
        oudEnv = { JARVIS_MIGRATIE_DB_URL: process.env.JARVIS_MIGRATIE_DB_URL, JARVIS_MIGRATIE_LEDGER: process.env.JARVIS_MIGRATIE_LEDGER };
        process.env.JARVIS_MIGRATIE_DB_URL = url.toString();
        process.env.JARVIS_MIGRATIE_LEDGER = "public.qa_ledger";
      });
      afterAll(async () => {
        for (const [k, v] of Object.entries(oudEnv)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      });

      function stubMigreer(id: string, sqlTekst: string, status = "added") {
        vi.stubGlobal("fetch", async (invoer: string | URL) => {
          const url = new URL(String(invoer));
          const antwoord = (lading: unknown) => new Response(JSON.stringify(lading), { status: 200 });
          if (url.pathname === `/repos/${SLUG}/compare/${BASIS_SHA}...${KOP}`)
            return antwoord({ files: [{ filename: MIGRATIE, status }], commits: [{ commit: { message: `m\n\nJarvis-Role: developer\nJarvis-Task: ${id}` }, parents: [{}] }] });
          if (url.pathname === `/repos/${SLUG}/contents/${MIGRATIE}`) return antwoord({ encoding: "base64", content: Buffer.from(sqlTekst).toString("base64") });
          return new Response("{}", { status: 404 });
        });
      }
      async function migreer(): Promise<number> {
        const { voerV3Uit } = await import("@/jarvis/src/v3-cli");
        const stil = vi.spyOn(console, "error").mockImplementation(() => {});
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
          return await voerV3Uit(["migreer", "--repo", SLUG, "--basis", BASIS_SHA, "--kop", KOP]);
        } finally {
          stil.mockRestore();
          log.mockRestore();
        }
      }
      async function schoon() {
        // Andere taken van eerdere tests mogen deze test niet beïnvloeden (de gewone migratieweg loopt over alle taken).
        await sql.unsafe("update jarvis.v3_taken set toestand = 'MISLUKT' where toestand not in ('KLAAR', 'MISLUKT')");
        await sql.unsafe(`drop table if exists public.klanten, public.klanten2, public.t, public.nieuw_qa, public.t_trig cascade; drop function if exists public.f() cascade; delete from public.qa_ledger;
          create table public.klanten (id int); insert into public.klanten values (1), (2), (3); create table public.klanten2 (id int); create table public.t (n name);
          alter table public.klanten owner to qa_migrator; alter table public.klanten2 owner to qa_migrator; alter table public.t owner to qa_migrator;`);
      }
      const bestaat = async (t: string) => (await sql.unsafe(`select to_regclass('${t}') is not null as ja`))[0]!.ja === true;
      const ledgerRijen = async () => (await sql.unsafe("select name from public.qa_ledger"))[0] !== undefined;

      it("past een goedaardige additieve migratie toe, in één transactie met de ledgerregel", async () => {
        await schoon();
        const id = await taakKlaarVoorPr(MANDAAT_MIG);
        stubMigreer(id, "begin;\ncreate table public.nieuw_qa (id int primary key);\ncommit;");
        expect(await migreer()).toBe(0);
        expect(await bestaat("public.nieuw_qa")).toBe(true);
        expect(await ledgerRijen()).toBe(true);
        expect(await migreer()).toBe(0); // opnieuw: staat al in het ledger, niets dubbel
        expect((await sql.unsafe("select count(*)::int as n from public.qa_ledger"))[0]!.n).toBe(1);
      });

      it.each(BLK1_AANVALLEN.filter((a) => a.effect !== undefined && !a.sql.includes("jarvis")).map((a) => [a.naam, a] as const))("BLK-1: de aanval wordt geweigerd en de productiedata blijft heel: %s", async (_naam, a) => {
        await schoon();
        const id = await taakKlaarVoorPr(MANDAAT_MIG);
        stubMigreer(id, a.sql);
        expect(await migreer()).toBe(3);
        expect(await bestaat("public.klanten")).toBe(true);
        expect(await bestaat("public.klanten2")).toBe(true);
        expect((await sql.unsafe("select count(*)::int as n from public.klanten"))[0]!.n).toBe(3);
        expect(await ledgerRijen()).toBe(false);
      });

      it("weigert een migratie die het schema van Jarvis zou raken, en past niets toe als de migratierol dat schema kan gebruiken", async () => {
        await schoon();
        const id = await taakKlaarVoorPr(MANDAAT_MIG);
        stubMigreer(id, 'insert into U&"\\006Aarvis".v3_instellingen (sleutel, waarde) values (\'qa-c\', \'1\')');
        expect(await migreer()).toBe(3);
        expect((await sql.unsafe("select count(*)::int as n from jarvis.v3_instellingen where sleutel = 'qa-c'"))[0]!.n).toBe(0);
        // de rolcontrole: een goedaardige migratie wordt NIET toegepast zodra de rol het schema jarvis kan gebruiken
        const id2 = await taakKlaarVoorPr(MANDAAT_MIG);
        stubMigreer(id2, "create table public.nieuw_qa (id int);");
        await sql.unsafe("grant usage on schema jarvis to qa_migrator");
        try {
          expect(await migreer()).toBe(1);
          expect(await bestaat("public.nieuw_qa")).toBe(false);
          expect(await ledgerRijen()).toBe(false);
        } finally {
          await sql.unsafe("revoke usage on schema jarvis from qa_migrator");
        }
        expect(await migreer()).toBe(0);
        expect(await bestaat("public.nieuw_qa")).toBe(true);
      });

      // ---- De gewone weg: uit de database, zonder push-event (een merge door de sweep start er geen)
      async function migreerUitstaand(): Promise<number> {
        const { voerV3Uit } = await import("@/jarvis/src/v3-cli");
        const stil = vi.spyOn(console, "error").mockImplementation(() => {});
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
          return await voerV3Uit(["migreer", "--repo", SLUG]);
        } finally {
          stil.mockRestore();
          log.mockRestore();
        }
      }
      const MIG_PAD = "supabase/migrations/0102_auto.sql";

      it("AUTONOOM: een merge door de sweep (GITHUB_TOKEN, geen push-event) leidt tot toepassing van de migratie, zonder basis/kop of push", async () => {
        await schoon();
        const id = await taakKlaarVoorPr(MANDAAT_MIG);
        // 1. de sweep beoordeelt, voegt samen en legt UITROL vast
        stubGitHub(id, [{ filename: MIG_PAD, status: "added" }], { migratieSql: "create table public.nieuw_qa (id int primary key);" });
        expect(await beoordeel(["--samenvoegen"])).toBe(0);
        expect(schrijfacties().map((a) => `${a.methode} ${a.pad.split("/").slice(-1)[0]}`)).toEqual(["POST reviews", "PUT merge"]);
        expect(await toestand(id)).toBe("UITROL");
        expect(await bestaat("public.nieuw_qa")).toBe(false); // de merge zelf past niets toe
        // 2. de volgende stap van dezelfde workflowrun (needs: sweep): migreer zonder argumenten
        expect(await migreerUitstaand()).toBe(0);
        expect(await bestaat("public.nieuw_qa")).toBe(true);
        expect((await sql.unsafe("select name from public.qa_ledger"))[0]!.name).toBe("0102_auto");
        // 3. idempotent: een volgende ronde doet niets dubbel
        expect(await migreerUitstaand()).toBe(0);
        expect((await sql.unsafe("select count(*)::int as n from public.qa_ledger"))[0]!.n).toBe(1);
      });

      it("AUTONOOM: ook de samenvoeging die de eigenaar zelf deed (herstelpad) leidt tot toepassing", async () => {
        await schoon();
        const id = await taakKlaarVoorPr(MANDAAT_MIG);
        stubGitHub(id, [{ filename: MIG_PAD, status: "added" }], { merged: true, migratieSql: "create table public.nieuw_qa (id int);" });
        expect(await beoordeel()).toBe(0); // legt de samenvoeging vast
        expect(await toestand(id)).toBe("UITROL");
        expect(await migreerUitstaand()).toBe(0);
        expect(await bestaat("public.nieuw_qa")).toBe(true);
      });

      it("AUTONOOM: de tweede laag houdt stand — een taak die (buiten beoordeelPr om) op UITROL staat met een aanval in de PR, wordt geweigerd en de data blijft heel", async () => {
        for (const a of BLK1_AANVALLEN.filter((x) => x.effect !== undefined && !x.sql.includes("jarvis") && !x.sql.includes("anon"))) {
          await schoon();
          const id = await taakKlaarVoorPr(MANDAAT_MIG);
          await ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id}, ${SLUG}, 5, ${KOP}, ${MERGE})`);
          stubGitHub(id, [{ filename: MIG_PAD, status: "added" }], { migratieSql: a.sql, merged: true });
          expect(await migreerUitstaand(), a.naam).toBe(3);
          expect(await bestaat("public.klanten"), a.naam).toBe(true);
          expect((await sql.unsafe("select count(*)::int as n from public.klanten"))[0]!.n, a.naam).toBe(3);
          expect(await ledgerRijen(), a.naam).toBe(false);
          await sql`update jarvis.v3_taken set toestand = 'MISLUKT' where id = ${id}`;
        }
      });

      it("B-1: de uitvoerder kan merge_sha niet vervalsen; wat de database zegt wordt bij GitHub nagegaan", async () => {
        await schoon();
        // (1) via de database: merge_sha uit het bewijs van de uitvoerder wordt niet bewaard
        const id = await taakKlaarVoorPr(MANDAAT_MIG);
        await werker(async (tx) => {
          await tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'UITVOEREN', '{}'::jsonb)`;
          await tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'CONTROLE', ${JSON.stringify({ pr: { repo: SLUG, nummer: 777, sha: "abc1234", merge_sha: "deadbeef1234" } })}::text::jsonb)`;
        });
        const pr = (await sql`select pr from jarvis.v3_taken where id = ${id}`)[0]!.pr as Record<string, unknown>;
        expect(Object.keys(pr).sort()).toEqual(["nummer", "repo", "sha"]);
        await werker((tx) => tx`select jarvis.v3_overgang(${id}, 'cloud-1', 'UITVOEREN', '{}'::jsonb)`);
        stubGitHub(id, [{ filename: MIG_PAD, status: "added" }], { migratieSql: "create table public.forged_qa (id int);" });
        expect(await migreerUitstaand()).toBe(0);
        expect(await bestaat("public.forged_qa")).toBe(false);
        // (2) tweede laag: zelfs een vervalst merge_sha in de database (hier met de hand gezet) leidt tot niets,
        //     want GitHub zegt dat de pull request niet samengevoegd is of een andere samenvoegcommit heeft
        await sql`update jarvis.v3_taken set pr = ${JSON.stringify({ repo: SLUG, nummer: 5, sha: KOP, merge_sha: "deadbeef1234" })}::text::jsonb where id = ${id}`;
        stubGitHub(id, [{ filename: MIG_PAD, status: "added" }], { migratieSql: "create table public.forged_qa (id int);" }); // niet samengevoegd
        expect(await migreerUitstaand()).toBe(3);
        stubGitHub(id, [{ filename: MIG_PAD, status: "added" }], { migratieSql: "create table public.forged_qa (id int);", merged: true }); // samengevoegd, maar tot een andere commit
        expect(await migreerUitstaand()).toBe(3);
        expect(await bestaat("public.forged_qa")).toBe(false);
        expect(await ledgerRijen()).toBe(false);
        // (3) een pull request die niet bij deze taak hoort (andere Jarvis-Task-trailer)
        await sql`update jarvis.v3_taken set pr = ${JSON.stringify({ repo: SLUG, nummer: 5, sha: KOP, merge_sha: MERGE })}::text::jsonb where id = ${id}`;
        stubGitHub("V3-20261015-andere-taak", [{ filename: MIG_PAD, status: "added" }], { migratieSql: "create table public.forged_qa (id int);", merged: true });
        expect(await migreerUitstaand()).toBe(3);
        expect(await bestaat("public.forged_qa")).toBe(false);
        // en de echte samenvoeging werkt wel
        stubGitHub(id, [{ filename: MIG_PAD, status: "added" }], { migratieSql: "create table public.forged_qa (id int);", merged: true });
        expect(await migreerUitstaand()).toBe(0);
        expect(await bestaat("public.forged_qa")).toBe(true);
      });

      it("AUTONOOM: een mandaat zonder migraties of een gewijzigd bestand leidt tot niets of een weigering", async () => {
        await schoon();
        const id = await taakKlaarVoorPr(MANDAAT); // migraties: false
        await ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id}, ${SLUG}, 5, ${KOP}, ${MERGE})`);
        stubGitHub(id, [{ filename: MIG_PAD, status: "added" }], { migratieSql: "create table public.nieuw_qa (id int);", merged: true });
        expect(await migreerUitstaand()).toBe(0);
        expect(await bestaat("public.nieuw_qa")).toBe(false);
        await sql`update jarvis.v3_taken set toestand = 'MISLUKT' where id = ${id}`;
        const id2 = await taakKlaarVoorPr(MANDAAT_MIG);
        await ci((tx) => tx`select jarvis.v3_ci_samengevoegd(${id2}, ${SLUG}, 5, ${KOP}, ${MERGE})`);
        for (const status of ["modified", "renamed", "removed"]) {
          stubGitHub(id2, [{ filename: MIG_PAD, status }], { migratieSql: "create table public.nieuw_qa (id int);", merged: true });
          expect(await migreerUitstaand(), status).toBe(3);
          expect(await bestaat("public.nieuw_qa"), status).toBe(false);
        }
      });

      it("past alleen nieuwe bestanden toe: een gewijzigd of hernoemd migratiebestand wordt geweigerd", async () => {
        await schoon();
        const id = await taakKlaarVoorPr(MANDAAT_MIG);
        for (const status of ["modified", "renamed", "removed"]) {
          stubMigreer(id, "create table public.nieuw_qa (id int);", status);
          expect(await migreer(), status).toBe(3);
          expect(await bestaat("public.nieuw_qa"), status).toBe(false);
        }
      });
    });
  });
});
