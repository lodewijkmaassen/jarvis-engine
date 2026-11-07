import { describe, expect, it } from "vitest";
import { DOELEN_LEDGER_SQL, PR_TOETSINGEN_SQL, SCHEMA_FEITEN_SQL } from "@/jarvis/src/db";
import { bewijsVoorTest } from "@/jarvis/src/doel-bewijs";
import { BEWIJS_TEKENS, bouwBeoordelingsVraag, OPDRACHT_CONTEXT_TEKENS, type AcceptatieTest } from "@/jarvis/src/acceptatie";
import type { Doel } from "@/jarvis/src/doelen";
import type { DbClient } from "@/jarvis/src/opdrachten";

/**
 * Een meting mag haar eigen vorige oordeel niet als bewijs terugkrijgen, en een
 * test die naar de opdracht verwijst moet die opdracht kunnen lezen (RSK-0043).
 *
 * Beide gemeten op 2026-11-07 aan D-20261021-161119608, met dezelfde
 * beoordelaar en hetzelfde bewijs: met het vorige oordeel erin zakte test A met
 * "de eindcontrole zegt zelf dat nergens wordt aangetoond dat ..." - haar eigen
 * zin van een ronde eerder. Zonder de opdracht zakte zij ook, want daar staat
 * welke SQL "de eerder ontbrekende SQL" is. Met beide hersteld: geslaagd.
 */
const OORDEEL_VAN_VORIGE_RONDE = "acceptatietest niet geslaagd (ronde 3 van 3) - A: niet-geslaagd - nergens wordt aangetoond dat";

const DOEL: Doel = {
  id: "D-20261021-161119608",
  titel: "Doelenketen",
  opdracht: "De eerder ontbrekende SQL staat onder tasks/D-20261020-190814438.",
  acceptatie_url: null,
  status: "samengevoegd",
  pr: { repo: "org/app", nummer: 318, kop: "a".repeat(40), merge_sha: "b".repeat(40) },
  uitkomst: OORDEEL_VAN_VORIGE_RONDE,
  bijgewerkt: "2026-11-07T17:17:27Z",
} as unknown as Doel;

const TEST: AcceptatieTest = {
  id: "A",
  soort: "sql",
  tekst: "Controleer dat de eerder ontbrekende SQL is toegepast.",
  vraag: null,
  url: null,
  onderwerp: null,
  volatiel: false,
};

function nepSql(rijen: Record<string, Record<string, unknown>[]>): DbClient {
  return { unsafe: async (q: string) => rijen[q] ?? [] } as unknown as DbClient;
}

describe("het bewijs draagt het oordeel van de vorige ronde niet", () => {
  it("noemt de uitkomst van het doel niet", async () => {
    const uit = await bewijsVoorTest(nepSql({}), DOEL, TEST, null);
    expect(uit.onuitvoerbaar).toBeNull();
    expect(uit.bewijs).toContain(`doel ${DOEL.id}`);
    expect(uit.bewijs).not.toContain("nergens wordt aangetoond dat");
    expect(uit.bewijs).not.toContain("ronde 3 van 3");
  });

  it("vervangt in het doelenregister de uitkomst van dit doel, en laat die van andere doelen staan", async () => {
    const uit = await bewijsVoorTest(
      nepSql({
        [DOELEN_LEDGER_SQL]: [
          { id: DOEL.id, status: "samengevoegd", uitkomst: OORDEEL_VAN_VORIGE_RONDE },
          { id: "D-20261107-000000001", status: "gesloten", uitkomst: "acceptatietest niet geslaagd; in de herstelketen gezet" },
        ],
      }),
      DOEL,
      TEST,
      null,
    );
    expect(uit.bewijs).toContain("de lopende meting van dit doel zelf");
    expect(uit.bewijs).not.toContain("ronde 3 van 3");
    // Het oordeel over een ÁNDER doel is wel bewijs: test C leunt erop.
    expect(uit.bewijs).toContain("in de herstelketen gezet");
  });
});

describe("de beoordelaar kan lezen waar de test naar verwijst", () => {
  it("zet de opdracht als context in de vraag, met het oordeel nadrukkelijk op de test", () => {
    const vraag = bouwBeoordelingsVraag(TEST, "ledger: 1 regel toegepast", `${DOEL.titel}\n\n${DOEL.opdracht}`);
    expect(vraag).toContain("# De opdracht waar deze test bij hoort");
    expect(vraag).toContain("tasks/D-20261020-190814438");
    expect(vraag).toContain("uitsluitend de test hierboven");
    // De test en het bewijs blijven staan waar ze stonden.
    expect(vraag).toContain("# Acceptatietest A");
    expect(vraag).toContain("ledger: 1 regel toegepast");
  });

  it("laat de context weg wanneer er geen opdracht is", () => {
    expect(bouwBeoordelingsVraag(TEST, "bewijs")).not.toContain("# De opdracht waar deze test bij hoort");
    expect(bouwBeoordelingsVraag(TEST, "bewijs", "   ")).not.toContain("# De opdracht waar deze test bij hoort");
  });

  it("kapt een lange opdracht af", () => {
    const vraag = bouwBeoordelingsVraag(TEST, "bewijs", "x".repeat(OPDRACHT_CONTEXT_TEKENS + 500));
    expect(vraag).toContain("[afgekapt]");
    expect(vraag.length).toBeLessThan(OPDRACHT_CONTEXT_TEKENS + 1500);
  });
});

/**
 * Het bewijs wordt als geheel afgekapt. Staat de historie van het onderwerp
 * achteraan, dan valt juist die weg zodra de algemene lijsten groeien - gemeten
 * op 2026-11-07 om 20:06 UTC, toen de beoordelaar voor eis (c) van
 * acceptatietest A een "afgekapt overzicht van de historie van #106" meldde
 * terwijl die historie zeven regels is.
 */
describe("het onderwerp staat vooraan in het bewijs", () => {
  it("zet de historie van de pull request voor de algemene lijsten", async () => {
    const sql = {
      unsafe: async (q: string) => {
        if (q === PR_TOETSINGEN_SQL) return [{ pr_repo: "org/engine", pr_nummer: 106, commit_sha: "c".repeat(40), oordeel: "GO", door: "ci-review", op: "2026-10-21T09:22:29Z" }];
        if (q === SCHEMA_FEITEN_SQL) return [{ soort: "functie", naam: "doel_overgang" }];
        if (q === DOELEN_LEDGER_SQL) return [{ id: "D-20261107-000000001", status: "gesloten", uitkomst: "in de herstelketen gezet" }];
        return [];
      },
    } as unknown as DbClient;
    const uit = await bewijsVoorTest(sql, DOEL, { ...TEST, onderwerp: "#106" }, "#106");
    const historie = uit.bewijs.indexOf("historie van #106");
    const doelen = uit.bewijs.indexOf("doelen van de lane");
    expect(historie).toBeGreaterThan(-1);
    expect(doelen).toBeGreaterThan(historie);
  });

  it("kapt het bewijs pas af bij de ruimere grens", () => {
    const vraag = bouwBeoordelingsVraag(TEST, "x".repeat(BEWIJS_TEKENS - 10));
    expect(vraag).not.toContain("[afgekapt]");
    expect(bouwBeoordelingsVraag(TEST, "x".repeat(BEWIJS_TEKENS + 10))).toContain("[afgekapt]");
  });
});
