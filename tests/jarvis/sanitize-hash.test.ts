// Jarvis-kern — de sanitizer moet Jarvis' eigen auditbewijs doorlaten.
//
// Een contextmanifest BESTAAT uit Git-blob-hashes en een manifesthash. Zonder
// uitzondering blokkeert de privacypoort daarmee precies het bewijsstuk dat
// duurzaam moet worden vastgelegd — de poort zou het systeem tegenhouden dat
// hij hoort te beschermen. Deze tests leggen de grens van die uitzondering
// vast: alleen echte hashvormen, niets anders.
import { describe, expect, it } from "vitest";
import { isHash, isVerdachteEntropie, LEGE_ALLOWLIST, scanTekst } from "@/jarvis/src/sanitize";

const SHA1 = "c47f3e9a1b2d4e6f8a0c2e4f6a8b0d2e4f6a8b0d";
const SHA256 = "9bb9d82b97e3f76691dd1978ae1f57ad1f94a734f3aafaf1eb4fb60803c18176";
const MD5 = "d41d8cd98f00b204e9800998ecf8427e";

describe("isHash", () => {
  it("herkent de twee hashlengtes die deze engine zelf produceert", () => {
    expect(isHash(SHA1)).toBe(true);
    expect(isHash(SHA256)).toBe(true);
  });

  it("stelt 32 hex NIET vrij: dat is de lengte van een echt auth-token", () => {
    // Dit was een gat. Het auth-token van een telefonieleverancier in deze
    // keten is precies 32 hexadecimale tekens en werd daardoor vrijgesteld.
    expect(isHash(MD5)).toBe(false);
    expect(isVerdachteEntropie("a1b2c3d4e5f60718293a4b5c6d7e8f90")).toBe(true);
  });

  it("accepteert hoofdletter-hex", () => {
    expect(isHash(SHA1.toUpperCase())).toBe(true);
  });

  it("weigert alles wat niet zuiver hexadecimaal is", () => {
    // Eén niet-hexteken en het is geen hash meer, maar een sleutel-kandidaat.
    expect(isHash(`${SHA1.slice(0, 39)}z`)).toBe(false);
    expect(isHash(`${SHA256.slice(0, 63)}_`)).toBe(false);
  });

  it("weigert hexstrings met een afwijkende lengte", () => {
    expect(isHash(SHA1.slice(0, 39))).toBe(false);
    expect(isHash(`${SHA1}ab`)).toBe(false);
  });
});

describe("isVerdachteEntropie met hashuitzondering", () => {
  it("vlagt hashes niet meer", () => {
    expect(isVerdachteEntropie(SHA1)).toBe(false);
    expect(isVerdachteEntropie(SHA256)).toBe(false);
  });

  it("vlagt een sleutelachtige string van dezelfde lengte nog steeds wel", () => {
    // 40 tekens, gemengd alfabet: precies wat een API-sleutel is.
    expect(isVerdachteEntropie("aZ9kQ2mW7pX4nB6vC1dF8gH3jK5lM0oP2rS4tU6w")).toBe(true);
  });
});

describe("scanTekst op een contextmanifest", () => {
  const manifest = [
    "{",
    '  "manifestVersie": 1,',
    `  "manifestHash": "${SHA256}",`,
    '  "records": [',
    `    { "id": "DEC-0018", "hash": "${SHA1}" }`,
    "  ],",
    '  "bronnen": [',
    `    { "pad": "docs/DECISIONS.md", "blob": "${SHA1}" }`,
    "  ]",
    "}",
  ].join("\n");

  it("laat een manifest ongemoeid", () => {
    expect(scanTekst(manifest, LEGE_ALLOWLIST)).toEqual([]);
  });

  it("vindt een echt secret dat naast de hashes staat", () => {
    const vies = `${manifest}\n// sb_secret_AbCdEfGhIjKlMnOpQrStUvWxYz012345\n`;
    const bevindingen = scanTekst(vies, LEGE_ALLOWLIST);
    expect(bevindingen.length).toBeGreaterThan(0);
    expect(bevindingen.some((b) => b.patroon === "supabase_secret_key")).toBe(true);
  });

  it("vindt een UUID dat naast de hashes staat", () => {
    const vies = `${manifest}\n"tenant": "520b540f-93cb-48a9-8f40-7ad8b5256f23"\n`;
    expect(scanTekst(vies, LEGE_ALLOWLIST).some((b) => b.patroon === "uuid")).toBe(true);
  });
});

describe("de identifier-heuristiek is verwijderd", () => {
  it("een woordgebaseerd wachtwoord wordt weer gevlagd", () => {
    // De verwijderde heuristiek stelde alles vrij wat uit drie of meer
    // gekoppelde woorden bestond. Een passphrase heeft precies die vorm.
    expect(isVerdachteEntropie("correct-horse-battery-staple-generator-7")).toBe(true);
  });

  it("een lange naam uit documentatie hoort nu in de allowlist, niet in een vormregel", () => {
    expect(isVerdachteEntropie("offerte_config_opvolg_2_positief")).toBe(true);
  });
});
