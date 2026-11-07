import { describe, expect, it } from "vitest";
import { magVastleggen } from "@/jarvis/src/doelen";

/**
 * Welke samenvoeging van een doel telt (RSK-0036).
 *
 * Een doel dat weken loopt wordt in meer dan één samengevoegde pull request
 * genoemd. De sweep legde de eerste vast die zij tegenkwam, en dat kon er een
 * van weken geleden zijn; de eindcontrole beoordeelde daarna het verkeerde
 * werk. Gemeten op 2026-11-07 aan D-20261021-161119608: acceptatietest A zakte
 * op een leeg ledger en op een uitkomst over een commit uit oktober.
 */
const OUD = { merge_sha: "a".repeat(40), merged_at: "2026-10-20T17:00:00Z" };
const NIEUW = { merge_sha: "b".repeat(40), merged_at: "2026-11-07T10:30:00Z" };

describe("een oudere samenvoeging verdringt nooit een nieuwere", () => {
  it("legt de nieuwere vast", () => {
    const uit = magVastleggen({ huidig: OUD, kandidaat: NIEUW });
    expect(uit.mag).toBe(true);
    expect(uit.reden).toContain("nieuwste");
  });

  it("weigert de oudere", () => {
    const uit = magVastleggen({ huidig: NIEUW, kandidaat: OUD });
    expect(uit.mag).toBe(false);
    expect(uit.reden).toContain("ouder dan de vastgelegde");
  });

  it("weigert dezelfde samenvoeging, ongeacht hoofdletters in de sha", () => {
    expect(magVastleggen({ huidig: OUD, kandidaat: { ...OUD, merge_sha: OUD.merge_sha.toUpperCase() } }).mag).toBe(false);
    expect(magVastleggen({ huidig: OUD, kandidaat: OUD }).reden).toContain("dezelfde samenvoeging");
  });

  it("legt vast wanneer het doel er nog geen heeft", () => {
    expect(magVastleggen({ huidig: null, kandidaat: NIEUW }).mag).toBe(true);
    expect(magVastleggen({ huidig: {}, kandidaat: OUD }).mag).toBe(true);
  });

  it("laat een doel van vóór deze regel één keer vervangen, en daarna geldt de tijd", () => {
    // Geen merged_at bekend: de nieuwste kandidaat mag hem vervangen.
    const zonderTijd = { merge_sha: "c".repeat(40) };
    expect(magVastleggen({ huidig: zonderTijd, kandidaat: OUD }).mag).toBe(true);
    // Daarna staat de tijd er wel bij en wint de oudere niet meer.
    expect(magVastleggen({ huidig: OUD, kandidaat: { merge_sha: "d".repeat(40), merged_at: "2026-10-01T00:00:00Z" } }).mag).toBe(false);
  });

  it("weigert een kandidaat die even oud is als de vastgelegde", () => {
    expect(magVastleggen({ huidig: OUD, kandidaat: { merge_sha: "e".repeat(40), merged_at: OUD.merged_at } }).mag).toBe(false);
  });
});
