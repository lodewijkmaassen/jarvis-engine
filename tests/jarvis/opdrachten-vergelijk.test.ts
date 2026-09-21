// De enginestap van de poort gaat als enige het netwerk op. RSK-0024: elke
// uitkomst die geen vergelijking was, werd `null`, en `null` las als een pin
// die naast de hoofdbranch ligt. Hier staat wat er nu gebeurt: de reden gaat
// mee, en een uitkomst die vluchtig kan zijn wordt eerst opnieuw geprobeerd.
import { describe, expect, it } from "vitest";
import { VERGELIJK_UITSTEL_MS, vergelijkMetHoofdbranch } from "@/jarvis/src/opdrachten";
import { isOnbekend } from "@/jarvis/src/engine";

const SLUG = "eigenaar/jarvis-engine";
const SHA = "a89bf306d1387e9695a6801bfc0802162466f770";

function antwoord(status: number, lading: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => lading } as unknown as Response;
}

/** Een fetch die de opgegeven antwoorden op volgorde teruggeeft, en telt. */
function reeks(...uit: (Response | Error)[]) {
  const gedaan: number[] = [];
  const haal = (async () => {
    const volgende = uit[gedaan.length] ?? uit[uit.length - 1];
    gedaan.push(1);
    if (volgende instanceof Error) throw volgende;
    return volgende;
  }) as unknown as typeof fetch;
  return { haal, aantal: () => gedaan.length };
}

describe("vergelijkMetHoofdbranch", () => {
  const meteen = async () => {};

  it("geeft de status door als GitHub er een geeft", async () => {
    const { haal } = reeks(antwoord(200, { status: "behind" }));
    expect(await vergelijkMetHoofdbranch(SLUG, SHA, haal, meteen)).toBe("behind");
  });

  it("probeert een limiet opnieuw en slaagt alsnog", async () => {
    const { haal, aantal } = reeks(antwoord(403), antwoord(429), antwoord(200, { status: "identical" }));
    expect(await vergelijkMetHoofdbranch(SLUG, SHA, haal, meteen)).toBe("identical");
    expect(aantal()).toBe(3);
  });

  it("draagt na de laatste poging de reden in plaats van null", async () => {
    const { haal, aantal } = reeks(antwoord(403));
    const uit = await vergelijkMetHoofdbranch(SLUG, SHA, haal, meteen);
    expect(isOnbekend(uit)).toBe(true);
    expect(isOnbekend(uit) && uit.onbekend).toContain("403");
    expect(aantal()).toBe(VERGELIJK_UITSTEL_MS.length + 1);
  });

  it("herhaalt een 404 niet: die wordt bij een volgende poging niet anders", async () => {
    const { haal, aantal } = reeks(antwoord(404));
    const uit = await vergelijkMetHoofdbranch(SLUG, SHA, haal, meteen);
    expect(isOnbekend(uit) && uit.onbekend).toContain("404");
    expect(aantal()).toBe(1);
  });

  it("vangt een netwerkfout en herhaalt die wel", async () => {
    const { haal, aantal } = reeks(new Error("getaddrinfo ENOTFOUND"));
    const uit = await vergelijkMetHoofdbranch(SLUG, SHA, haal, meteen);
    expect(isOnbekend(uit) && uit.onbekend).toContain("ENOTFOUND");
    expect(aantal()).toBe(VERGELIJK_UITSTEL_MS.length + 1);
  });

  it("noemt een antwoord zonder bruikbare status bij naam", async () => {
    const { haal } = reeks(antwoord(200, { status: "iets anders" }));
    const uit = await vergelijkMetHoofdbranch(SLUG, SHA, haal, meteen);
    expect(isOnbekend(uit) && uit.onbekend).toContain("zonder bruikbare status");
  });
});
