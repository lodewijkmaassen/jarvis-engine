import { describe, expect, it } from "vitest";
import { pasDoelMigratiesToe, type DoelMigratie, type MigratieLezer } from "../../jarvis/src/doel-migratie";
import { hashSql } from "../../jarvis/src/eigen-migratie";
import type { Doel } from "../../jarvis/src/doelen";

const DOEL: Doel = {
  id: "D-20261106-120000000",
  titel: "Iets met de eigen administratie",
  opdracht: "Doe iets.",
  acceptatie_url: null,
  status: "samengevoegd",
  pr: { repo: "lodewijkmaassen/jarvis-engine", nummer: 500, kop: "a".repeat(40), merge_sha: "b".repeat(40) },
  uitkomst: null,
  pogingen: 0,
  bijgewerkt: new Date().toISOString(),
};

const ADDITIEF = "create table if not exists jarvis.proef (id bigserial primary key, doel text not null);";
const DEFINER = "create or replace function jarvis.x() returns int language sql security definer as $$ select 1 $$;";

/** Een databron die alleen de twee statements kent die deze route doet, en onthoudt wat er is aangeroepen. */
function nepDb(ledger: readonly Record<string, unknown>[], opties: { readonly ledgerFaalt?: boolean; readonly deurFaalt?: string } = {}) {
  const aanroepen: { sql: string; params: readonly unknown[] }[] = [];
  const sql = {
    async unsafe(tekst: string, params: readonly unknown[] = []) {
      aanroepen.push({ sql: tekst, params });
      if (tekst.includes("from jarvis.migraties")) {
        if (opties.ledgerFaalt === true) throw new Error('relation "jarvis.migraties" does not exist');
        return ledger;
      }
      if (tekst.includes("pas_migratie_toe")) {
        if (opties.deurFaalt !== undefined) throw new Error(opties.deurFaalt);
        return [{ uitkomst: "toegepast" }];
      }
      return [];
    },
    async end() {},
  };
  return { sql: sql as never, aanroepen };
}

const lezer = (bestanden: readonly DoelMigratie[] | string): MigratieLezer => async () => bestanden;

describe("de migratie van een doel toepassen na samenvoegen", () => {
  it("doet niets als het doel geen SQL meebracht", async () => {
    const { sql, aanroepen } = nepDb([]);
    expect(await pasDoelMigratiesToe(sql, "t", DOEL, lezer([]))).toEqual({ gedaan: [], open: [] });
    expect(aanroepen).toHaveLength(0);
  });

  it("past nieuwe SQL toe door de deur van de database", async () => {
    const { sql, aanroepen } = nepDb([]);
    const uit = await pasDoelMigratiesToe(sql, "t", DOEL, lezer([{ pad: `tasks/${DOEL.id}/0001_proef.sql`, bestand: "0001_proef", sql: ADDITIEF }]));
    expect(uit.open).toEqual([]);
    expect(uit.gedaan).toEqual([`${DOEL.id}__0001_proef (toegepast)`]);
    const deur = aanroepen.find((a) => a.sql.includes("pas_migratie_toe"));
    expect(deur?.params).toEqual([`${DOEL.id}__0001_proef`, ADDITIEF, DOEL.id]);
  });

  it("slaat over wat het ledger al als toegepast kent, met dezelfde inhoud", async () => {
    const { sql, aanroepen } = nepDb([{ naam: `${DOEL.id}__0001_proef`, hash: hashSql(ADDITIEF), uitkomst: "toegepast" }]);
    const uit = await pasDoelMigratiesToe(sql, "t", DOEL, lezer([{ pad: `tasks/${DOEL.id}/0001_proef.sql`, bestand: "0001_proef", sql: ADDITIEF }]));
    expect(uit).toEqual({ gedaan: [`${DOEL.id}__0001_proef`], open: [] });
    expect(aanroepen.some((a) => a.sql.includes("pas_migratie_toe"))).toBe(false);
  });

  it("houdt het doel tegen als dezelfde naam andere inhoud heeft gekregen", async () => {
    const { sql } = nepDb([{ naam: `${DOEL.id}__0001_proef`, hash: hashSql("iets anders"), uitkomst: "toegepast" }]);
    const uit = await pasDoelMigratiesToe(sql, "t", DOEL, lezer([{ pad: `tasks/${DOEL.id}/0001_proef.sql`, bestand: "0001_proef", sql: ADDITIEF }]));
    expect(uit.gedaan).toEqual([]);
    expect(uit.open[0]!.bevoegdheid).toBe(true);
    expect(uit.open[0]!.reden).toMatch(/andere inhoud/);
  });

  it("stuurt SQL die de lane niet mag uitvoeren naar de bevoegde lane, zonder het te proberen", async () => {
    const { sql, aanroepen } = nepDb([]);
    const uit = await pasDoelMigratiesToe(sql, "t", DOEL, lezer([{ pad: `tasks/${DOEL.id}/0001_definer.sql`, bestand: "0001_definer", sql: DEFINER }]));
    expect(uit.gedaan).toEqual([]);
    expect(uit.open[0]!.bevoegdheid).toBe(true);
    expect(uit.open[0]!.reden).toMatch(/SECURITY DEFINER/);
    expect(aanroepen.some((a) => a.sql.includes("pas_migratie_toe"))).toBe(false);
  });

  it("noemt een ontbrekende lane een bevoegdheid van dit ene doel", async () => {
    const { sql } = nepDb([], { ledgerFaalt: true });
    const uit = await pasDoelMigratiesToe(sql, "t", DOEL, lezer([{ pad: `tasks/${DOEL.id}/0001_proef.sql`, bestand: "0001_proef", sql: ADDITIEF }]));
    expect(uit.open[0]!.bevoegdheid).toBe(true);
    expect(uit.open[0]!.reden).toMatch(/niet ingericht/);
  });

  it("scheidt een weigering van de database van een gewone fout in de SQL", async () => {
    const bestand = [{ pad: `tasks/${DOEL.id}/0001_proef.sql`, bestand: "0001_proef", sql: ADDITIEF }];
    const geweigerd = await pasDoelMigratiesToe(nepDb([], { deurFaalt: "migratie geweigerd: rechten uitdelen" }).sql, "t", DOEL, lezer(bestand));
    expect(geweigerd.open[0]!.bevoegdheid).toBe(true);
    const tikfout = await pasDoelMigratiesToe(nepDb([], { deurFaalt: 'column "pogingn" of relation "doelen" has no...' }).sql, "t", DOEL, lezer(bestand));
    expect(tikfout.open[0]!.bevoegdheid).toBe(false);
  });

  it("meldt het als de bestanden niet te lezen zijn, zonder iets toe te passen", async () => {
    const { sql, aanroepen } = nepDb([]);
    const uit = await pasDoelMigratiesToe(sql, "t", DOEL, lezer("pull request niet te lezen (404)"));
    expect(uit.open).toEqual([{ naam: "(lezen)", reden: "pull request niet te lezen (404)", bevoegdheid: false }]);
    expect(aanroepen).toHaveLength(0);
  });

  it("doet niets zonder vastgelegde samenvoeging", async () => {
    const zonder: Doel = { ...DOEL, pr: { repo: "a/b", nummer: 1 } };
    const { sql } = nepDb([]);
    expect(await pasDoelMigratiesToe(sql, "t", zonder, lezer([{ pad: "x", bestand: "x", sql: ADDITIEF }]))).toEqual({ gedaan: [], open: [] });
  });
});
