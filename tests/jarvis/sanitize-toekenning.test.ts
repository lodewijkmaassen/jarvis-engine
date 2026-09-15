// Probeset voor T-20260912-sanitizer-toekenning: het toekenningspatroon
// (RSK-0019 — een credential korter dan tweeentwintig tekens glipt langs de
// vormpatronen), het patroon voor Nederlandse postadressen, en de gedeelde
// uitzondering voor Jarvis-ids in het entropiepatroon.
//
// De acceptatie-eis uit de opdracht is tweezijdig: alle treffers gevonden, geen
// enkele niet-treffer gevlagd. De niet-treffers zijn daarom geen bijzaak maar de
// helft van de proef — de vorige poging is juist op die helft teruggedraaid.
//
// Alle waarden hieronder zijn verzonnen; tests/ valt buiten sanitize_paden.
import { describe, expect, it } from "vitest";
import {
  LEGE_ALLOWLIST,
  VOORBEELD_MARKERING,
  isCredentialNaam,
  isEchteToekenning,
  isJarvisId,
  isVerdachteEntropie,
  scanTekst,
  type PatroonNaam,
} from "@/jarvis/src/sanitize";

function patronen(tekst: string): PatroonNaam[] {
  return scanTekst(tekst, LEGE_ALLOWLIST, "proef.md").map((t) => t.patroon);
}

function vlagtToekenning(tekst: string): boolean {
  return patronen(tekst).includes("toekenning_secret");
}

describe("isCredentialNaam", () => {
  it("herkent het sleutelwoord als heel segment", () => {
    for (const naam of [
      "PASSWORD",
      "SMTP_PASS",
      "apiKey",
      "db.password",
      "WACHTWOORD",
      "SESSION_SECRET",
      "GITHUB_TOKEN",
      "authToken",
      "X_API_KEY",
      "credentials",
    ]) {
      expect(isCredentialNaam(naam), naam).toBe(true);
    }
  });

  it("slaat niet aan op een woord dat het sleutelwoord alleen bevat", () => {
    for (const naam of ["bypass", "monkey", "keyboard", "passage", "tokenizer", "authors", "passief"]) {
      expect(isCredentialNaam(naam), naam).toBe(false);
    }
  });
});

describe("toekenningspatroon — treffers", () => {
  // Stuk voor stuk korter dan de tweeentwintig tekens van base64_geheim en de
  // tweeendertig van hoge_entropie: precies het gat dat RSK-0019 beschrijft.
  const treffers = [
    "WACHTWOORD=hunter2!",
    "PASSWORD: s3cr3tje",
    'secret = "abc123xyz"',
    "SMTP_PASS=Zomer2026",
    "api_key: k9f2m4qp",
    "db.password='Tr0ub4dour'",
    "SESSION_SECRET=q8w7e6r5t4",
    "AUTH_TOKEN: bx91kd02",
    'apiKey: "aZ4tR7nQ"',
    "GEHEIM=paardenbloem9",
  ];

  for (const regel of treffers) {
    it(`vlagt ${regel.split(/[:=]/)[0]}`, () => {
      expect(vlagtToekenning(regel), regel).toBe(true);
    });
  }

  it("vlagt een korte waarde die geen enkel vormpatroon haalt", () => {
    const regel = "SMTP_PASS=Zomer2026";
    const gevonden = patronen(regel);
    expect(gevonden).toContain("toekenning_secret");
    expect(gevonden).not.toContain("hoge_entropie");
    expect(gevonden).not.toContain("base64_geheim");
  });
});

describe("toekenningspatroon — niet-treffers", () => {
  const nietTreffers = [
    // Plaatshouders en verwijzingen naar een andere bewaarplaats.
    "PASSWORD=<jouw wachtwoord>",
    "SMTP_PASS=${SMTP_PASS}",
    "password: $DB_PASSWORD",
    "API_KEY=%API_KEY%",
    "secret: changeme",
    "password = your_password",
    "TOKEN=xxxxxxxx",
    "wachtwoord: ........",
    "GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    "password = process.env.DB_PASSWORD",
    "apiKey: config.apiKey",
    'secret = getSecret("smtp")',
    // Typeaanduidingen uit schema's en code.
    "password: string",
    "api_key: null",
    "authToken?: string",
    "secret: boolean",
    "credentials: required",
    // Namen die een sleutelwoord alleen bevatten.
    "bypass=true12345",
    "monkey = bananen42",
    "tokenizer: wordpiece",
    // Een Jarvis-id rechts van de dubbele punt.
    "secret: T-20260912-sanitizer-toekenning",
    "token: DEC-0043",
    // Te kort om ooit een credential te zijn.
    "PASSWORD=ab",
    "secret: 123",
  ];

  for (const regel of nietTreffers) {
    it(`laat ${regel} met rust`, () => {
      expect(vlagtToekenning(regel), regel).toBe(false);
    });
  }

  // De drie klassen die de eerste versie van dit patroon in de eigen
  // repositories opleverde. Ze staan hier apart omdat elk een eigen regel in
  // isEchteToekenning afdwingt; verdwijnt die regel, dan valt hier één test om
  // en niet de hele scan.
  describe("de klassen die de eerste versie wél vlagde", () => {
    it("laat een HTTP-header in vercel.json met rust (waarde is een configuratiewoord)", () => {
      const json = [
        '{ "key": "X-Frame-Options", "value": "DENY" },',
        '{ "key": "Referrer-Policy", "value": "no-referrer" },',
        '{ "key": "X-Content-Type-Options", "value": "nosniff" },',
        '{ "key": "Cache-Control", "value": "no-store" }',
      ].join("\n");
      expect(patronen(json)).not.toContain("toekenning_secret");
    });

    it("laat een afgekapte waarde uit documentatie met rust", () => {
      expect(vlagtToekenning("  sleutel: sb_publishable_…              # publieke sleutel")).toBe(false);
      expect(vlagtToekenning('window.JARVIS = { key: "sb_publishable_…" };')).toBe(false);
      expect(vlagtToekenning("api_key: sk-ant-...")).toBe(false);
    });

    it("laat lopende tekst met rust waar een woord aan de naam voorafgaat", () => {
      expect(vlagtToekenning("- Geen nieuw account, geen nieuw token: `GITHUB_TOKEN` bestaat alleen")).toBe(false);
      expect(vlagtToekenning("Het wachtwoord: bewaar het in de kluis.")).toBe(false);
    });

    it("ziet een declaratie in code nog steeds wél", () => {
      expect(vlagtToekenning('export const apiKey = "aZ4tR7nQ";')).toBe(true);
      expect(vlagtToekenning("  SMTP_PASS=Zomer2026")).toBe(true);
      expect(vlagtToekenning("- SESSION_SECRET=q8w7e6r5t4")).toBe(true);
    });

    it("laat een waarde met rust die zelf een credentialnaam is", () => {
      expect(vlagtToekenning("PASSWORD=SMTP_PASSWORD")).toBe(false);
    });
  });

  it("meldt een leverancierssleutel onder zijn eigen naam, niet als toekenning", () => {
    const gevonden = patronen("ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnop12345");
    expect(gevonden).toContain("anthropic_api_key");
    expect(gevonden).not.toContain("toekenning_secret");
  });

  it("scant ook binnen een voorbeeldblok: een sleutel is nooit een legitiem voorbeeld", () => {
    const tekst = [VOORBEELD_MARKERING, "```", "SMTP_PASS=Zomer2026", "```"].join("\n");
    expect(vlagtToekenning(tekst)).toBe(true);
  });
});

describe("isEchteToekenning", () => {
  it("weigert een fragment dat geen toekenning is", () => {
    expect(isEchteToekenning("gewoon wat tekst")).toBe(false);
  });
});

describe("postadres_nl", () => {
  const adressen = [
    "Kerkstraat 12, 1234 AB",
    "Lange Voorhout 5a 2514EA",
    "Prins Hendrikkade 104, 1011 AJ",
    "Van der Helstplein 3, 1072 PH",
  ];

  for (const adres of adressen) {
    it(`vlagt ${adres}`, () => {
      expect(patronen(`Bezoekadres: ${adres} Amsterdam`), adres).toContain("postadres_nl");
    });
  }

  const geenAdres = [
    // Een losse postcode is geen woonadres.
    "De postcode 1234 AB valt binnen het verzorgingsgebied.",
    // Een jaartal met twee hoofdletters erachter.
    "In 2026 AB Testing afgerond.",
    // Een huisnummer zonder postcode.
    "Kerkstraat 12 in Utrecht",
    // Een versienummer.
    "Release 3.2 1024 KB groot",
  ];

  for (const regel of geenAdres) {
    it(`laat "${regel}" met rust`, () => {
      expect(patronen(regel), regel).not.toContain("postadres_nl");
    });
  }

  it("zwijgt over een adres in een gemarkeerd voorbeeldblok", () => {
    const tekst = [VOORBEELD_MARKERING, "```", "Kerkstraat 12, 1234 AB Utrecht", "```"].join("\n");
    expect(patronen(tekst)).not.toContain("postadres_nl");
  });
});

describe("Jarvis-id in het entropiepatroon", () => {
  it("herkent de vorm", () => {
    for (const id of ["T-20260911-engine-repository", "DEC-0038", "RSK-0019-2fa-token", "LRN-0014"]) {
      expect(isJarvisId(id), id).toBe(true);
    }
  });

  it("stelt een taak-id met een cijfer-lettersegment vrij", () => {
    // `2fa` is geen louter-cijfer- en geen louter-lettersegment, dus
    // isIdentifierVorm liet dit id door; isJarvisId vangt het nu wel.
    expect(isVerdachteEntropie("RSK-0019-2fa-token-rotatie-2026")).toBe(false);
  });

  it("vlagt het id niet op een regel die over een credential gaat", () => {
    const regel = "De taak RSK-0019-2fa-token-rotatie-2026 gaat over het roteren van de secret key.";
    expect(patronen(regel)).not.toContain("hoge_entropie");
  });

  it("stelt een gewone lange sleutel niet vrij", () => {
    expect(isJarvisId("A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6")).toBe(false);
  });
});
