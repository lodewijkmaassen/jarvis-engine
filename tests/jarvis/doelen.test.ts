import { describe, expect, it } from "vitest";
import { REVIEWER_DOOR } from "@/jarvis/src/attestatie";
import { checksGroen, dispatchNodig, doelUitPrTekst, MAX_NO_GO, reviewBesluit, STIL_MINUTEN } from "@/jarvis/src/doelen";
import { poortUitkomst } from "@/jarvis/src/opdrachten";

const KOP = "a".repeat(40);
const OUD = "b".repeat(40);

describe("doelUitPrTekst", () => {
  it("leest precies één regel Doel: D-…", () => {
    expect(doelUitPrTekst("Iets.\n\nDoel: D-20261017-120000\nUitzonderingen: geen\n")).toBe("D-20261017-120000");
    expect(doelUitPrTekst("Doel: D-20261017-120000\r\n")).toBe("D-20261017-120000");
  });
  it("leest niets uit een ander formaat of uit lopende tekst", () => {
    expect(doelUitPrTekst("geen doel")).toBeNull();
    expect(doelUitPrTekst("Doel: T-20261017-iets")).toBeNull();
    expect(doelUitPrTekst("het Doel: D-20261017-120000 staat midden in een zin")).toBeNull();
  });
});

describe("reviewBesluit", () => {
  it("wacht tot de checks groen zijn", () => {
    expect(reviewBesluit(KOP, [], false)).toBe("wacht");
    expect(reviewBesluit(KOP, [], true)).toBe("review");
  });
  it("beoordeelt een kop maar één keer", () => {
    expect(reviewBesluit(KOP, [{ kop: KOP, oordeel: "GO", door: REVIEWER_DOOR }], true)).toBe("klaar");
    expect(reviewBesluit(KOP, [{ kop: KOP, oordeel: "NO-GO", door: REVIEWER_DOOR }], true)).toBe("klaar");
    // Een nieuwe kop na een NO-GO wordt opnieuw beoordeeld.
    expect(reviewBesluit(KOP, [{ kop: OUD, oordeel: "NO-GO", door: REVIEWER_DOOR }], true)).toBe("review");
  });
  it("zet het doel vast na MAX_NO_GO keer NO-GO, zonder eindeloze rondes", () => {
    const nee = Array.from({ length: MAX_NO_GO }, (_, n) => ({ kop: String(n).repeat(40), oordeel: "NO-GO", door: REVIEWER_DOOR }));
    expect(reviewBesluit(KOP, nee, true)).toBe("vast");
  });
  it("telt oordelen van anderen dan de reviewjob niet mee", () => {
    expect(reviewBesluit(KOP, [{ kop: KOP, oordeel: "GO", door: "cloud" }], true)).toBe("review");
    const nee = Array.from({ length: MAX_NO_GO }, () => ({ kop: OUD, oordeel: "NO-GO", door: "laptop" }));
    expect(reviewBesluit(KOP, nee, true)).toBe("review");
  });
});

describe("checksGroen", () => {
  it("eist de verplichte check en dat alles afgerond en geslaagd is", () => {
    expect(checksGroen([{ naam: "poort", status: "completed", conclusie: "success" }], "poort")).toBe(true);
    expect(checksGroen([{ naam: "poort", status: "completed", conclusie: "success" }, { naam: "lint-test-build", status: "completed", conclusie: "skipped" }], "poort")).toBe(true);
    expect(checksGroen([], "poort")).toBe(false);
    expect(checksGroen([{ naam: "ci", status: "completed", conclusie: "success" }], "poort")).toBe(false);
    expect(checksGroen([{ naam: "poort", status: "in_progress", conclusie: null }], "poort")).toBe(false);
    expect(checksGroen([{ naam: "poort", status: "completed", conclusie: "success" }, { naam: "ci", status: "completed", conclusie: "failure" }], "poort")).toBe(false);
  });
});

describe("dispatchNodig", () => {
  const nu = new Date("2026-10-17T20:00:00Z");
  const geleden = (min: number) => new Date(nu.getTime() - min * 60_000).toISOString();
  it("start voor een open doel, direct", () => {
    expect(dispatchNodig([{ id: "D-1", status: "open", bijgewerkt: geleden(0) }], nu).start).toBe(true);
  });
  it("start voor een doel in uitvoering pas als het stil staat", () => {
    expect(dispatchNodig([{ id: "D-1", status: "bezig", bijgewerkt: geleden(STIL_MINUTEN - 1) }], nu).start).toBe(false);
    expect(dispatchNodig([{ id: "D-1", status: "review", bijgewerkt: geleden(STIL_MINUTEN) }], nu).start).toBe(true);
  });
  it("start niet voor afgeronde of vastgelopen doelen, en niet zonder doelen", () => {
    for (const status of ["samengevoegd", "klaar", "vast"] as const) {
      expect(dispatchNodig([{ id: "D-1", status, bijgewerkt: geleden(500) }], nu).start, status).toBe(false);
    }
    expect(dispatchNodig([], nu).start).toBe(false);
  });
});

describe("poortUitkomst: administratieve stappen zijn waarschuwingen", () => {
  it("laat een zachte stap de uitkomst niet bepalen, een harde wel", async () => {
    expect(await poortUitkomst([{ naam: "state", draai: async () => 1, hard: false }, { naam: "lint", draai: async () => 0 }])).toBe(0);
    expect(await poortUitkomst([{ naam: "state", draai: async () => 1, hard: false }, { naam: "sanitize", draai: async () => 1 }])).toBe(1);
  });
});
