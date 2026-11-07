import { describe, expect, it } from "vitest";
import { DB_MIGRATIES_SQL, DOELEN_LEDGER_SQL, DOEL_BEWIJS_ACTIVITEIT_SQL, PR_ACTIVITEIT_SQL, PR_TOETSINGEN_SQL } from "@/jarvis/src/db";
import { bewijsVoorTest } from "@/jarvis/src/doel-bewijs";
import type { AcceptatieTest } from "@/jarvis/src/acceptatie";
import type { Doel } from "@/jarvis/src/doelen";
import type { DbClient } from "@/jarvis/src/opdrachten";

/**
 * Het bewijs gaat over het onderwerp, niet over de meting (RSK-0036).
 *
 * Twee fouten, beide gemeten op 2026-11-07 aan D-20261021-161119608:
 * de activiteit van "#106" werd gezocht bij een dossier met die naam — dat
 * bestaat niet, dus las de beoordelaar altijd "(geen regels)" — en de eigen
 * oordelen van de eindcontrole vulden het venster, zodat test C zijn eigen
 * vorige "niet-geslaagd" als bewijs terugkreeg.
 */
const DOEL: Doel = {
  id: "D-20261021-161119608",
  titel: "Doelenketen",
  opdracht: "x",
  acceptatie_url: null,
  status: "samengevoegd",
  pr: { repo: "lodewijkmaassen/tovas-flow", nummer: 318, kop: "a".repeat(40), merge_sha: "b".repeat(40) },
  uitkomst: null,
  bijgewerkt: "2026-11-07T12:08:27Z",
} as unknown as Doel;

const TEST: AcceptatieTest = {
  id: "A", soort: "sql", tekst: "Controleer dat de SQL is toegepast en dat de historische gegevens voor #106 er zijn.",
  vraag: null, url: null, onderwerp: "#106", volatiel: false,
};

function nepSql(rijen: Record<string, Record<string, unknown>[]>): { sql: DbClient; gezien: { q: string; p: unknown[] }[] } {
  const gezien: { q: string; p: unknown[] }[] = [];
  const sql = {
    unsafe: async (q: string, p: unknown[] = []) => {
      gezien.push({ q, p });
      return rijen[q] ?? [];
    },
  } as unknown as DbClient;
  return { sql, gezien };
}

describe("het bewijs van een acceptatietest gaat over het onderwerp", () => {
  it("leest voor een pull request de toetsingen en niet een dossier met die naam", async () => {
    const { sql, gezien } = nepSql({
      [PR_TOETSINGEN_SQL]: [{ pr_nummer: 106, oordeel: "NO-GO", op: "2026-10-20T22:51:03Z" }, { pr_nummer: 106, oordeel: "GO", op: "2026-10-21T09:22:29Z" }],
    });
    const uit = await bewijsVoorTest(sql, DOEL, TEST, "#106");
    expect(uit.onuitvoerbaar).toBeNull();
    expect(uit.bewijs).toContain("historie van #106 zoals de database haar bewaart");
    expect(uit.bewijs).toContain("NO-GO");
    const toets = gezien.find((g) => g.q === PR_TOETSINGEN_SQL);
    expect(toets?.p).toEqual([106]);
    // De activiteit wordt bij het doel gezocht, niet bij "#106".
    expect(gezien.find((g) => g.q === DOEL_BEWIJS_ACTIVITEIT_SQL)?.p).toEqual([DOEL.id]);
  });

  it("houdt voor een gewoon onderwerp de activiteit van dat onderwerp", async () => {
    const { sql, gezien } = nepSql({});
    await bewijsVoorTest(sql, DOEL, { ...TEST, onderwerp: "D-20261107-000000001" }, "D-20261107-000000001");
    expect(gezien.find((g) => g.q === DOEL_BEWIJS_ACTIVITEIT_SQL)?.p).toEqual(["D-20261107-000000001"]);
    expect(gezien.some((g) => g.q === PR_TOETSINGEN_SQL)).toBe(false);
  });

  it("laat het doelenregister zien, zodat een test over een ander doel bewijs heeft", async () => {
    const { sql } = nepSql({
      [DOELEN_LEDGER_SQL]: [{ id: "D-20261107-000000001", status: "gesloten", uitkomst: "de eindcontrole zette het doel niet op klaar" }],
    });
    const uit = await bewijsVoorTest(sql, DOEL, { ...TEST, id: "C", onderwerp: null }, null);
    expect(uit.bewijs).toContain("doelen van de lane");
    expect(uit.bewijs).toContain("D-20261107-000000001");
  });

  it("vraagt de activiteit zonder de eigen oordelen van de eindcontrole", () => {
    expect(DOEL_BEWIJS_ACTIVITEIT_SQL).toContain("test %");
    expect(DOEL_BEWIJS_ACTIVITEIT_SQL).toContain("eindoordeel:%");
    expect(DOEL_BEWIJS_ACTIVITEIT_SQL).toContain("not (uitvoerder = 'ci' and soort = 'acceptatie'");
  });

  it("leest alleen en schrijft niets", () => {
    for (const q of [DOEL_BEWIJS_ACTIVITEIT_SQL, PR_TOETSINGEN_SQL, DOELEN_LEDGER_SQL])
      expect(q.trim().toLowerCase().startsWith("select ")).toBe(true);
  });
});

describe("een leeg ledger van dit doel is geen bewijs van afwezigheid", () => {
  it("zegt erbij waar de lege lijst over gaat en waar de rest staat", async () => {
    const gezien: { q: string }[] = [];
    const sql = {
      unsafe: async (q: string) => {
        gezien.push({ q });
        return [];
      },
    } as unknown as DbClient;
    const uit = await bewijsVoorTest(sql, DOEL, TEST, "#106");
    // De SQL die dit doel moest toepassen, is onder de dossiers geschreven waarin zij
    // stond - niet onder dit doel. "(geen regels)" las daardoor als "niets toegepast".
    expect(uit.bewijs).toContain(`ONDER doel-id ${DOEL.id}`);
    expect(uit.bewijs).toContain("dat zegt niets over SQL die onder een ANDER doel-id is toegepast");
    expect(uit.bewijs).toContain("migratieledger van de hele lane");
  });
});

/**
 * De historie van een pull request staat op twee plekken (verduidelijking van
 * acceptatietest A door de eigenaar, 2026-11-07): de oordelen in de toetsingen,
 * en wat er in de activiteit aan het nummer hangt - het openen, het samenvoegen
 * en de regels die een doel over die pull request heeft teruggeschreven.
 */
describe("het bewijs van een pull request bevat ook de activiteit die eraan hangt", () => {
  it("zoekt de activiteit op de verwijzing die op dat nummer eindigt", async () => {
    const { sql, gezien } = nepSql({
      [PR_ACTIVITEIT_SQL]: [
        { op: "2026-10-20T22:51:03Z", soort: "status", tekst: "(afgeleid uit toetsingen) review NO-GO op 0538f3b", verwijzing: "org/engine#106" },
        { op: "2026-10-21T09:22:29Z", soort: "status", tekst: "(afgeleid uit toetsingen) review GO op 204a9fc", verwijzing: "org/engine#106" },
      ],
    });
    const uit = await bewijsVoorTest(sql, DOEL, TEST, "#106");
    expect(uit.onuitvoerbaar).toBeNull();
    expect(uit.bewijs).toContain("historie van #106 zoals de database haar bewaart");
    expect(uit.bewijs).toContain("afgeleid uit toetsingen");
    // "%#106" en niet "%106%": #1106 is een andere pull request.
    expect(gezien.find((g) => g.q === PR_ACTIVITEIT_SQL)?.p).toEqual(["%#106"]);
  });

  it("vraagt die activiteit niet op voor een onderwerp dat geen pull request is", async () => {
    const { gezien, sql } = nepSql({});
    await bewijsVoorTest(sql, DOEL, { ...TEST, onderwerp: "D-20261107-000000001" }, "D-20261107-000000001");
    expect(gezien.find((g) => g.q === PR_ACTIVITEIT_SQL)).toBeUndefined();
  });
});

/**
 * De migratietabel van de database is een leesrecht dat een keten kan missen.
 * Heeft zij het, dan staat erin welke objecten een migratie aanbrengt (eis (b)
 * van acceptatietest A); heeft zij het niet, dan is dat een blok minder bewijs
 * en geen onmeetbare test.
 */
describe("wat de database zelf als toegepaste migratie registreert", () => {
  it("staat in het bewijs wanneer de keten die view mag lezen", async () => {
    const { sql } = nepSql({
      [DB_MIGRATIES_SQL]: [{ version: "20261106230712", name: "doel_overgangen", sql: "create or replace function jarvis.doel_overgang() returns trigger" }],
    });
    const uit = await bewijsVoorTest(sql, DOEL, TEST, null);
    expect(uit.bewijs).toContain("view jarvis.db_migraties");
    expect(uit.bewijs).toContain("doel_overgangen");
  });

  it("laat het blok weg wanneer dat leesrecht ontbreekt, zonder de test onmeetbaar te maken", async () => {
    const sql = {
      unsafe: async (q: string) => {
        if (q === DB_MIGRATIES_SQL) throw new Error("permission denied for view db_migraties");
        return [];
      },
    } as unknown as DbClient;
    const uit = await bewijsVoorTest(sql, DOEL, TEST, null);
    expect(uit.onuitvoerbaar).toBeNull();
    expect(uit.bewijs).not.toContain("db_migraties");
    expect(uit.bewijs).toContain(`doel ${DOEL.id}`);
  });
});
