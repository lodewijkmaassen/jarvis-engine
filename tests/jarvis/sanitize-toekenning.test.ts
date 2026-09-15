// Probeset voor het toekenningspatroon en het postadrespatroon (RSK-0019).
//
// De vorige poging is teruggedraaid omdat hij een nieuwe klasse vals-positieven
// gaf. Daarom staat hier niet alleen wat gevonden MOET worden, maar in gelijke
// omvang wat stil MOET blijven: de niet-treffers zijn het eigenlijke
// acceptatiecriterium van deze taak.
import { describe, expect, it } from "vitest";
import {
  LEGE_ALLOWLIST,
  isVerdachteToekenningWaarde,
  ontleedToekenning,
  scanTekst,
} from "../../jarvis/src/sanitize";

function patronenVan(tekst: string): string[] {
  return scanTekst(tekst, LEGE_ALLOWLIST).map((b) => b.patroon);
}

function vlagt(tekst: string, patroon: string): boolean {
  return patronenVan(tekst).includes(patroon);
}

// ---------------------------------------------------------------------------
// Toekenningspatroon — treffers
// ---------------------------------------------------------------------------

const TREFFERS: readonly (readonly [string, string])[] = [
  ["omgevingsvariabele", "WACHTWOORD=hunter2secret"],
  ["hoofdletterloos", "wachtwoord=hunter2secret"],
  ["dubbele punt met spatie", "PASSWORD: Zx9kqLmT"],
  ["toekenning met aanhalingstekens", 'const secret = "abc"'],
  ["enkele aanhalingstekens", "password = 'kort'"],
  ["korter dan de entropiedrempel", "SMTP_PASS=Aa1bbbbb"],
  ["samengestelde sleutel", "SUPABASE_DB_PASSWORD=Xq7wertyu"],
  ["yaml-stijl", "  api_key: Kq81mzTvbn"],
  ["autorisatieheader met Bearer", "Authorization: Bearer Zk91mQvbTr"],
  ["pijltoekenning", "secret => Pw93mzQlvk"],
  ["dubbelepunt-is", "credential := Lm82ntQkzv"],
  ["leestekens in plaats van cijfers", "wachtwoord: p@ssw!rd"],
];

describe("credential_toekenning — treffers", () => {
  for (const [naam, regel] of TREFFERS) {
    it(`vlagt ${naam}`, () => {
      expect(vlagt(regel, "credential_toekenning")).toBe(true);
    });
  }

  it("meldt de waarde en niet de sleutel", () => {
    const [bevinding] = scanTekst("WACHTWOORD=hunter2secret", LEGE_ALLOWLIST);
    // Het fragment is gemaskeerd; de LENGTE ervan verraadt of de sleutel is
    // meegenomen. "hunter2secret" is dertien tekens, de hele regel vierentwintig.
    expect(bevinding.fragment).toBe("hun********et");
  });

  it("is kritiek, want een credential is een secret", () => {
    expect(scanTekst("PASSWORD: Zx9kqLmT", LEGE_ALLOWLIST)[0].severity).toBe("kritiek");
  });
});

// ---------------------------------------------------------------------------
// Toekenningspatroon — niet-treffers
// ---------------------------------------------------------------------------

const NIET_TREFFERS: readonly (readonly [string, string])[] = [
  ["Nederlandse verwijzing", "Wachtwoord: staat in de kluis"],
  ["verwijzing naar een document", "token: zie het dashboard"],
  ["plaatshouder in punthaken", "PASSWORD=<jouw-wachtwoord>"],
  ["plaatshouder als variabele", "SMTP_PASS=${SMTP_PASS}"],
  ["plaatshouder als shell-variabele", "api_key=$API_KEY"],
  ["plaatshouder met sterretjes", "wachtwoord: ********"],
  ["het woord zelf als waarde", "password: password"],
  ["changeme", "SECRET=changeme"],
  ["lege waarde", "WACHTWOORD="],
  ["taak-id achter een credentialsleutel", "secret: T-20260912-sanitizer-toekenning"],
  ["besluit-id achter een credentialsleutel", "token: DEC-0043"],
  ["migratienaam achter een credentialsleutel", "key: 20260913120100_jarvis_leesbeelden"],
  ["pad naar de plek van het secret", "wachtwoord: docs/SECRETS.md"],
  ["verwijzing naar een url", "token: https://dashboard.example.com"],
  ["één Nederlands woord", "sleutel: onbekend"],
  ["reeds geredigeerd", "PASSWORD=[[GEREDIGEERD:credential_toekenning:1]]"],
  ["woord zonder credentialsleutel", "opmerking: dit is een gewone zin"],
  ["sleutel zonder toekenning", "Het wachtwoord is inmiddels geroteerd"],
];

describe("credential_toekenning — niet-treffers", () => {
  for (const [naam, regel] of NIET_TREFFERS) {
    it(`zwijgt bij ${naam}`, () => {
      expect(vlagt(regel, "credential_toekenning")).toBe(false);
    });
  }

  it("zwijgt in een gemarkeerd voorbeeldblok", () => {
    const tekst = [
      "<!-- jarvis:example -->",
      "```",
      "SMTP_PASS=Aa1bbbbbbb",
      "```",
    ].join("\n");
    expect(vlagt(tekst, "credential_toekenning")).toBe(false);
  });

  it("vlagt wél in een gewoon codeblok zonder markering", () => {
    const tekst = ["```", "SMTP_PASS=Aa1bbbbbbb", "```"].join("\n");
    expect(vlagt(tekst, "credential_toekenning")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// De waardetoets afzonderlijk
// ---------------------------------------------------------------------------

describe("isVerdachteToekenningWaarde", () => {
  it("laat een aangehaalde korte waarde door als verdacht", () => {
    expect(isVerdachteToekenningWaarde("abc", true)).toBe(true);
  });

  it("eist bij een kale waarde lengte én twee tekenklassen", () => {
    expect(isVerdachteToekenningWaarde("abc", false)).toBe(false);
    expect(isVerdachteToekenningWaarde("dashboard", false)).toBe(false);
    expect(isVerdachteToekenningWaarde("dashboard1", false)).toBe(true);
  });

  it("weigert een plaatshouder ook tussen aanhalingstekens", () => {
    expect(isVerdachteToekenningWaarde("changeme", true)).toBe(false);
  });
});

describe("ontleedToekenning", () => {
  it("haalt aanhalingstekens weg en meldt dat ze er stonden", () => {
    expect(ontleedToekenning('"abc"')).toEqual({ waarde: "abc", aangehaald: true });
  });

  it("strookt het schema-voorvoegsel van een autorisatieheader", () => {
    expect(ontleedToekenning("Bearer Zk91mQvbTr")).toEqual({
      waarde: "Zk91mQvbTr",
      aangehaald: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Postadres
// ---------------------------------------------------------------------------

describe("postadres_nl", () => {
  const adressen = [
    "Dorpsstraat 12, 1234 AB Amsterdam",
    "Kerkweg 3a 1011 AB",
    "Prins Hendrikkade 104, 1011 AE Amsterdam",
    "Van der Helstplein 7-2, 1072 PH Amsterdam",
    "Stationsweg 15 3811 MH",
  ];

  for (const adres of adressen) {
    it(`vlagt ${adres}`, () => {
      expect(vlagt(adres, "postadres_nl")).toBe(true);
    });
  }

  it("is een persoonsgegeven en dus hoog, niet kritiek", () => {
    expect(scanTekst(adressen[0], LEGE_ALLOWLIST)[0].severity).toBe("hoog");
  });

  const geenAdres = [
    ["losse postcode", "De postcode is 1234 AB"],
    ["straat zonder postcode", "Dorpsstraat 12 in Amsterdam"],
    ["getal met afkorting", "Regel 12 CI"],
    ["versieaanduiding", "Versie 3 van 2026 NL"],
  ] as const;

  for (const [naam, regel] of geenAdres) {
    it(`zwijgt bij ${naam}`, () => {
      expect(vlagt(regel, "postadres_nl")).toBe(false);
    });
  }
});
