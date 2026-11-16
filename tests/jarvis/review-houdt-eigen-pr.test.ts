import { describe, expect, it } from "vitest";
import { magVastleggen, wachtOpEigenSamenvoeging } from "@/jarvis/src/doelen";

/**
 * Een doel in review houdt zijn eigen pull request (RSK-0047).
 *
 * Gemeten op 2026-11-16 aan D-20261107-225515647 (WoordBattle): het doel stond
 * in review op #335 toen de attestatie anderhalve minuut te vroeg liep — de
 * review had nog geen GO en de poort draaide nog. In dezelfde ronde legde de
 * sweep de merge van #331 van 7 november vast; het doel verliet review, en de
 * attestatie van #335 kreeg geen tweede kans omdat die alleen voor doelen in
 * review wordt gestart. De eindcontrole beoordeelde daarna de oude code, zag
 * geen werkende URL en stuurde het doel terug: vijf keer dezelfde overgang,
 * daarna vast.
 */
const REVIEW_OP_335 = { repo: "lodewijkmaassen/tovas-flow", nummer: 335 };
const OUDE_MERGE = { repo: "lodewijkmaassen/tovas-flow", nummer: 331 };

describe("de foutieve overgang: een oudere samenvoeging haalt een doel uit review", () => {
  it("legt die oudere samenvoeging niet vast", () => {
    expect(wachtOpEigenSamenvoeging({ status: "review", huidig: REVIEW_OP_335, kandidaat: OUDE_MERGE })).toBe(true);
  });

  it("let niet op hoofdletters in de naam van de repository", () => {
    expect(
      wachtOpEigenSamenvoeging({
        status: "review",
        huidig: { repo: "Lodewijkmaassen/ToVas-Flow", nummer: 335 },
        kandidaat: OUDE_MERGE,
      }),
    ).toBe(true);
  });

  it("telt hetzelfde nummer in een andere repository niet als dezelfde pull request", () => {
    expect(
      wachtOpEigenSamenvoeging({
        status: "review",
        huidig: { repo: "lodewijkmaassen/kasboek", nummer: 331 },
        kandidaat: OUDE_MERGE,
      }),
    ).toBe(true);
  });
});

describe("de normale afhandeling blijft precies zoals zij was", () => {
  it("legt de samenvoeging van de eigen pull request wel vast", () => {
    expect(wachtOpEigenSamenvoeging({ status: "review", huidig: REVIEW_OP_335, kandidaat: REVIEW_OP_335 })).toBe(false);
  });

  it("houdt een doel in bezig ongemoeid: daar legt de sweep gewoon de nieuwste samenvoeging vast", () => {
    expect(wachtOpEigenSamenvoeging({ status: "bezig", huidig: REVIEW_OP_335, kandidaat: OUDE_MERGE })).toBe(false);
  });

  it("doet niets bij een doel in review zonder pull request", () => {
    expect(wachtOpEigenSamenvoeging({ status: "review", huidig: null, kandidaat: OUDE_MERGE })).toBe(false);
    expect(wachtOpEigenSamenvoeging({ status: "review", huidig: {}, kandidaat: OUDE_MERGE })).toBe(false);
    expect(wachtOpEigenSamenvoeging({ status: "review", huidig: { repo: "org/app" }, kandidaat: OUDE_MERGE })).toBe(false);
    expect(wachtOpEigenSamenvoeging({ status: "review", huidig: { nummer: 335 }, kandidaat: OUDE_MERGE })).toBe(false);
  });

  it("laat de bestaande regel over oud en nieuw ongemoeid", () => {
    // Zonder merge-sha en tijdstip zei magVastleggen ja tegen elke kandidaat; dat is nog steeds zo,
    // en juist daarom staat de nieuwe regel ervóór in de sweep.
    const open = { nummer: 335 } as { merge_sha?: string; merged_at?: string };
    expect(magVastleggen({ huidig: open, kandidaat: { merge_sha: "a".repeat(40), merged_at: "2026-11-07T23:17:08Z" } }).mag).toBe(true);
  });
});
