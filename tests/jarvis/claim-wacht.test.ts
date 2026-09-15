import { describe, expect, it } from "vitest";
import { claimGeweigerdOmdat } from "@/jarvis/src/opdrachten";
import { HEARTBEAT_MINUTEN, type Activiteit } from "@/jarvis/src/regie";

const NU = new Date("2026-09-15T08:00:00Z");
const iso = (minutenGeleden: number) => new Date(NU.getTime() - minutenGeleden * 60_000).toISOString();
const act = (over: Partial<Activiteit>): Activiteit => ({ op: iso(5), uitvoerder: "cloud", rol: "developer", taak: "T-20260912-x", project: null, soort: "stap", tekst: "iets", verwijzing: null, ...over });

describe("jarvis werk claim — twee uitvoerders niet tegelijk op één taak", () => {
  it("laat een claim door als niemand eraan werkt", () => {
    expect(claimGeweigerdOmdat("T-20260912-x", [], NU)).toBeNull();
  });
  it("weigert zolang een andere claim leeft, ook van een gelijknamige uitvoerder", () => {
    const reden = claimGeweigerdOmdat("T-20260912-x", [act({ soort: "claim", op: iso(1) })], NU);
    expect(reden).toMatch(/al geclaimd door developer \(cloud\)/);
  });
  it("laat door zodra de vorige claim is losgelaten of uitgevallen", () => {
    expect(claimGeweigerdOmdat("T-20260912-x", [act({ soort: "claim", op: iso(30) }), act({ soort: "vrijgave", op: iso(20) })], NU)).toBeNull();
    const oud = [act({ soort: "claim", op: iso(HEARTBEAT_MINUTEN.developer + 30) }), act({ soort: "heartbeat", op: iso(HEARTBEAT_MINUTEN.developer + 5) })];
    expect(claimGeweigerdOmdat("T-20260912-x", oud, NU)).toBeNull();
  });
  it("weigert vlak na een klaar: dat is bijna zeker dubbel werk uit een verouderde checkout", () => {
    const rijen = [act({ soort: "claim", op: iso(40) }), act({ soort: "klaar", op: iso(3), tekst: "PR #24 samengevoegd" })];
    expect(claimGeweigerdOmdat("T-20260912-x", rijen, NU)).toMatch(/3 min geleden afgerond/);
    const later = [act({ soort: "claim", op: iso(60) }), act({ soort: "klaar", op: iso(25) })];
    expect(claimGeweigerdOmdat("T-20260912-x", later, NU)).toBeNull();
  });
  it("kijkt alleen naar de eigen taak", () => {
    expect(claimGeweigerdOmdat("T-20260912-x", [act({ soort: "claim", op: iso(1), taak: "T-20260912-y" })], NU)).toBeNull();
  });
});
