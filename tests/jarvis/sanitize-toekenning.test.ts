// Probeset voor het toekenningspatroon (RSK-0019).
//
// De eerdere poging aan dit risico is teruggedraaid omdat hij een nieuwe klasse
// vals-positieven gaf. Daarom staat de probeset hier als TWEE lijsten die even
// zwaar wegen: TREFFERS moeten alle vier gevonden worden, NIET_TREFFERS mogen
// geen van alle een bevinding geven. Een patroonwijziging die de eerste lijst
// haalt maar de tweede breekt, is geen verbetering.
//
// De niet-treffers zijn niet verzonnen: het zijn regels zoals ze in ToVas Flow,
// Kasboek en deze repository voorkomen — YAML-sleutels, Nederlandse proza over
// sleutels en tokens, paden, taak-ids en documentatieplaatshouders.
import { describe, expect, it } from "vitest";
import {
  LEGE_ALLOWLIST,
  VOORBEELD_MARKERING,
  isCredentialWaarde,
  scanTekst,
} from "../../jarvis/src/sanitize";

/** Alleen de bevindingen van dit patroon; de rest heeft eigen tests. */
function toekenningen(tekst: string, bestand = "docs/PROEF.md") {
  return scanTekst(tekst, LEGE_ALLOWLIST, bestand).filter(
    (b) => b.patroon === "credential_toekenning",
  );
}

// Elk van deze regels kent een credential toe met een waarde die te KORT of te
// vormloos is voor de entropie- en base64-patronen. Precies het gat van
// RSK-0019: zonder dit patroon geeft geen van deze regels een bevinding.
const TREFFERS: readonly (readonly [string, string])[] = [
  ["omgevingsvariabele", "WACHTWOORD=Zomer2026!"],
  ["dubbele punt met spatie", "PASSWORD: hunter2reeks"],
  ["toekenning met aanhalingstekens", 'const secret = "kort1234";'],
  ["liggend streepje voor het woord", "SESSION_SECRET=abcd1234efgh"],
  ["hoofdletterongevoelig", "Api_Key: qwerty987zz"],
  ["yaml zonder aanhalingstekens", "  smtp_pass: Tr0ub4dor"],
  ["export in een shellregel", "export DB_PASSWORD=p4ssw0rd!x"],
  ["bearer in een header", "Authorization: Bearer kortToken12"],
];

// Geen van deze regels mag iets opleveren. Ze bevatten allemaal een
// credentialwoord gevolgd door ":" of "=" — het patroon moet ze op de WAARDE
// afwijzen, niet doordat het de toekenning niet ziet.
const NIET_TREFFERS: readonly (readonly [string, string])[] = [
  ["plaatshouder in punthaken", "WACHTWOORD=<jouw wachtwoord>"],
  ["shell-verwijzing", "PASSWORD=${SUPABASE_PASSWORD}"],
  ["omgevingsvariabele als verwijzing", "api_key: $ANTHROPIC_API_KEY"],
  ["documentatieplaatshouder", "password: changeme"],
  ["puntjes", "SECRET: ..."],
  ["instelling in plaats van waarde", "auth: true"],
  ["vereistheid", "token: vereist"],
  ["getal", "auth_timeout: 3600"],
  ["pad naar een bestand", "secret in docs/JARVIS.md"],
  ["pad als waarde", "key: src/db/server.ts"],
  ["bestandsnaam", "sleutel: sanitize.ts"],
  ["taak-id", "token: T-20260912-sanitizer-toekenning"],
  ["besluit-id", "sleutel: DEC-0043"],
  ["gedateerde identifier", "key: 20260913120100_jarvis_leesbeelden"],
  ["datum", "token verloopt: 2026-09-15"],
  ["tijdstip", "token: 2026-09-15T13:06:45Z"],
  ["kort woord uit een zin", "sleutel: nodig"],
  ["sterretjes", "wachtwoord: ********"],
  ["streepje als leeg veld", "secret: -"],
];

describe("credential_toekenning — probeset", () => {
  describe("treffers: alle vier moeten gevonden worden", () => {
    for (const [naam, regel] of TREFFERS) {
      it(`vlagt ${naam}`, () => {
        const bevindingen = toekenningen(regel);
        expect(bevindingen).toHaveLength(1);
        expect(bevindingen[0].severity).toBe("kritiek");
      });
    }
  });

  describe("niet-treffers: geen enkele mag afgaan", () => {
    for (const [naam, regel] of NIET_TREFFERS) {
      it(`zwijgt bij ${naam}`, () => {
        expect(toekenningen(regel)).toEqual([]);
      });
    }
  });

  it("vlagt geen van de niet-treffers wanneer ze in één document staan", () => {
    const document = NIET_TREFFERS.map(([, regel]) => regel).join("\n");
    expect(toekenningen(document)).toEqual([]);
  });

  it("vindt elke treffer wanneer ze in één document staan", () => {
    const document = TREFFERS.map(([, regel]) => regel).join("\n");
    expect(toekenningen(document)).toHaveLength(TREFFERS.length);
  });
});

describe("credential_toekenning — grenzen van het patroon", () => {
  it("meldt alleen de waarde, niet de naam van de variabele", () => {
    const bevindingen = toekenningen("WACHTWOORD=Zomer2026!");
    // Gemaskeerd fragment: kop van drie tekens. Die kop komt uit de WAARDE, dus
    // begint hij met "Zom" en niet met "WAC".
    expect(bevindingen[0].fragment.startsWith("Zom")).toBe(true);
  });

  it("laat een herkenbaar leverancierssecret bij zijn eigen patroon", () => {
    const bevindingen = scanTekst(
      "SUPABASE_KEY=sb_secret_abcdefghijklmnop",
      LEGE_ALLOWLIST,
      "docs/PROEF.md",
    );
    expect(bevindingen.map((b) => b.patroon)).toContain("supabase_secret_key");
    expect(bevindingen.map((b) => b.patroon)).not.toContain("credential_toekenning");
  });

  it("zwijgt in een als voorbeeld gemarkeerd codeblok", () => {
    const document = [VOORBEELD_MARKERING, "```", "WACHTWOORD=Zomer2026!", "```"].join("\n");
    expect(toekenningen(document)).toEqual([]);
  });

  it("scant een gewoon codeblok wel", () => {
    const document = ["```", "WACHTWOORD=Zomer2026!", "```"].join("\n");
    expect(toekenningen(document)).toHaveLength(1);
  });

  it("vervangt niet automatisch — de poort dwingt een menselijke keuze af", () => {
    const bevindingen = toekenningen("WACHTWOORD=Zomer2026!");
    expect(bevindingen).toHaveLength(1);
    // vervangbaar: false betekent dat de tekst ongemoeid blijft; dat is hier de
    // gewenste uitkomst en wordt in sanitize.test.ts per patroon gecontroleerd.
  });

  it("laat een waarde toe die in de allowlist staat, per pad", () => {
    const allowlist = { ...LEGE_ALLOWLIST, tokens: ["Zomer2026! in docs/PROEF.md"] };
    const bevindingen = scanTekst("WACHTWOORD=Zomer2026!", allowlist, "docs/PROEF.md");
    expect(bevindingen.filter((b) => b.patroon === "credential_toekenning")).toEqual([]);
  });
});

describe("isCredentialWaarde", () => {
  it("wijst alles onder de minimumlengte af", () => {
    expect(isCredentialWaarde("kort")).toBe(false);
    expect(isCredentialWaarde("abcdefgh")).toBe(true);
  });

  it("negeert een afsluitend leesteken bij het oordeel", () => {
    expect(isCredentialWaarde("abcdefgh.")).toBe(true);
    expect(isCredentialWaarde("kort123.")).toBe(false);
  });
});
