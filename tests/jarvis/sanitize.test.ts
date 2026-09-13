// Jarvis-kern — sanitizer: de harde poort tegen PII en secrets in persistente
// data. De monsters hieronder zijn verzonnen waarden met de juiste VORM; er
// staat geen echte sleutel in dit bestand (en tests/ valt sowieso buiten
// sanitize_paden).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEGE_ALLOWLIST,
  VOORBEELD_MARKERING,
  isIdentifierVorm,
  isVerdachteEntropie,
  laadAllowlist,
  maskeerFragment,
  normaliseerTelefoon,
  isVerdachtBase64,
  ontleedTokenRegel,
  sanitizeBestanden,
  sanitizeTekst,
  scanTekst,
  shannonEntropie,
  type Allowlist,
  type Bevinding,
  type PatroonNaam,
} from "@/jarvis/src/sanitize";

/** Bouwt een meerregelige tekst zonder template-literals vol backticks. */
function regels(...r: readonly string[]): string {
  return r.join("\n");
}

function patronen(bevindingen: readonly Bevinding[]): PatroonNaam[] {
  return bevindingen.map((b) => b.patroon);
}

const FENCE = "```";

// Verzonnen waarden met de juiste vorm.
const SECRET_MONSTERS: readonly (readonly [PatroonNaam, string])[] = [
  ["supabase_secret_key", "sb_secret_AbCdEf12345678xyzQRS"],
  ["supabase_publishable_key", "sb_publishable_AbCdEf12345678xyz"],
  ["anthropic_api_key", "sk-ant-api03-AbCdEf1234567890XyZaBcDeFgHi"],
  ["github_token", "github_pat_" + "11ABCDEFG0" + "AbCdEfGhIjKlMnOpQrStUv"],
  ["openai_api_key", "sk-AbCdEf1234567890XyZaBcDeFgHi"],
  ["sendgrid_api_key", "SG.AbCdEf1234567890Xy.ZaBcDeFgHi1234567890"],
  ["resend_api_key", "re_AbCd1234_EfGhIjKlMnOpQrStUvWx"],
  ["twilio_account_sid", "AC" + "0123456789abcdef".repeat(2)],
  ["twilio_api_key_sid", "SK" + "0123456789abcdef".repeat(2)],
  ["hoge_entropie", "Xq7mTpZ2vLd9RkWs4NbHyCj6UaFg3Emt"],
  ["base64_geheim", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"],
  ["prive_sleutel", "-----BEGIN RSA PRIVATE KEY-----"],
  ["verbindingsreeks", "postgresql://postgres:Z0mer2026Wachtwoord@db.example.supabase.co:5432/db"],
];

const PII_MONSTERS: readonly (readonly [PatroonNaam, string])[] = [
  ["email", "klant@voorbeeld.nl"],
  ["telefoon_e164", "+31612345678"],
  ["telefoon_nl", "06 12345678"],
  ["telefoon_nl", "06-12345678"],
  ["telefoon_nl", "0612345678"],
  ["uuid", "3f2504e0-4f89-11d3-9a0c-0305e82c3301"],
];

const KLANT_UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const ENTROPIE_TOKEN = "Xq7mTpZ2vLd9RkWs4NbHyCj6UaFg3Emt";

const PUBLIEKE_ALLOWLIST: Allowlist = {
  emails: ["info@tovas.nl", "flow@tovas.nl"],
  telefoonnummers: ["+31612686292"],
  tokens: [],
};

// ---------------------------------------------------------------------------
// Detectie
// ---------------------------------------------------------------------------

describe("scanTekst — secretpatronen", () => {
  for (const [patroon, monster] of SECRET_MONSTERS) {
    it(`vindt ${patroon}`, () => {
      const bevindingen = scanTekst(`sleutel: ${monster}`, LEGE_ALLOWLIST, "docs/X.md");
      expect(patronen(bevindingen)).toEqual([patroon]);
      expect(bevindingen[0].severity).toBe("kritiek");
      expect(bevindingen[0].bestand).toBe("docs/X.md");
      expect(bevindingen[0].regel).toBe(1);
    });
  }

  it("zet nooit de volledige waarde in het fragment", () => {
    for (const [, monster] of SECRET_MONSTERS) {
      const [bevinding] = scanTekst(`sleutel: ${monster}`, LEGE_ALLOWLIST);
      expect(bevinding.fragment).not.toBe(monster);
      expect(monster).not.toContain(bevinding.fragment);
      expect(bevinding.fragment).toContain("*");
    }
  });

  it("herkent sk-ant- als anthropic en niet als openai", () => {
    const bevindingen = scanTekst("sk-ant-api03-AbCdEf1234567890XyZaBcDeFgHi", LEGE_ALLOWLIST);
    expect(patronen(bevindingen)).toEqual(["anthropic_api_key"]);
  });

  it("markeert secrets ook binnen een gewoon (niet-gemarkeerd) codeblok", () => {
    const tekst = regels(FENCE + "env", "SUPABASE=sb_secret_AbCdEf12345678xyzQRS", FENCE);
    expect(patronen(scanTekst(tekst, LEGE_ALLOWLIST))).toEqual(["supabase_secret_key"]);
  });
});

describe("scanTekst — PII-patronen", () => {
  for (const [patroon, monster] of PII_MONSTERS) {
    it(`vindt ${patroon} in "${monster}"`, () => {
      const bevindingen = scanTekst(`contact: ${monster}`, LEGE_ALLOWLIST);
      expect(patronen(bevindingen)).toEqual([patroon]);
      expect(bevindingen[0].severity).toBe("hoog");
    });
  }

  it("vindt meerdere treffers op één regel in leesvolgorde", () => {
    const tekst = `mail klant@voorbeeld.nl of bel 06-12345678 over ${KLANT_UUID}`;
    expect(patronen(scanTekst(tekst, LEGE_ALLOWLIST))).toEqual([
      "email",
      "telefoon_nl",
      "uuid",
    ]);
  });
});

describe("vals-positieven", () => {
  it("laat gewone Nederlandse tekst met rust", () => {
    const tekst = regels(
      "De sanitizer draait alleen op de paden uit sanitize_paden.",
      "Zie jarvis/src/frontmatter.ts voor de YAML-subset (re_export_helper_functie).",
      "Versie 16.3.2, budget 8000 tokens, limiet 3 QA-rondes.",
    );
    expect(scanTekst(tekst, LEGE_ALLOWLIST)).toEqual([]);
  });

  it("markeert een lange identifier zonder cijfers niet als hoge entropie", () => {
    expect(isVerdachteEntropie("context_fragment_regels_en_status_paden_lijst")).toBe(false);
    // Gedateerde identifiers: datum of Jarvis-voorvoegsel plus woorden; een
    // passphrase zonder datumkop blijft verdacht (sanitize-hash.test.ts).
    expect(isVerdachteEntropie("20260913120100_jarvis_leesbeelden_alleen_lezen")).toBe(false);
    expect(isVerdachteEntropie("T-20260913-akkoord-via-interface-proef")).toBe(false);
    expect(isIdentifierVorm("20260913120100_jarvis_leesbeelden")).toBe(true);
    // Maar een segment dat cijfers en letters mengt blijft verdacht.
    expect(isIdentifierVorm("ghp_" + "x7Kq".repeat(9))).toBe(false);
    expect(isIdentifierVorm("sk-proj-" + "a1B2".repeat(8))).toBe(false);
    expect(isIdentifierVorm("a".repeat(40))).toBe(false);
    expect(isIdentifierVorm("correct-horse-battery-staple-generator-7")).toBe(false);
    expect(isIdentifierVorm("offerte_config_opvolg_2_positief")).toBe(false);
    expect(isIdentifierVorm("DEC-0043-autorisatie-per-taak-uitzonderingen")).toBe(true);
  });

  it("markeert een willekeurige sleutel van 32 tekens wél", () => {
    expect(isVerdachteEntropie(ENTROPIE_TOKEN)).toBe(true);
    expect(shannonEntropie(ENTROPIE_TOKEN)).toBeGreaterThan(4);
    expect(shannonEntropie("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(0);
  });

  it("markeert een string van minder dan 32 tekens niet", () => {
    expect(isVerdachteEntropie("Xq7mTpZ2vLd9RkWs4NbHyCj6UaFg3Em")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

describe("isVerdachtBase64 en Jarvis-ids", () => {
  it("ziet een taak- of record-id nooit als sleutel, ook niet op een credentialregel", () => {
    expect(isVerdachtBase64("T-20260911-engine-repository", 'wacht_op: "T-20260911-engine-repository: het token van de bot"')).toBe(false);
    expect(isVerdachtBase64("DEC-0038", "de secret key staat in DEC-0038")).toBe(false);
  });
});

describe("laadAllowlist", () => {
  it("leest de allowlist van een project uit een bestand", () => {
    // De allowlist is van het project, niet van de engine: de engine levert
    // de lader en de regels, het project de waarden. Daarom een fixture van
    // een fictief project; de echte allowlist test het project zelf.
    const inhoud = readFileSync(path.join(process.cwd(), "tests", "jarvis", "fixtures", "allowlist.yml"), "utf8");
    const uitkomst = laadAllowlist(inhoud);
    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.allowlist.emails).toContain("balie@bibliotheek.example");
    expect(uitkomst.allowlist.telefoonnummers).toContain("+31201234567");
    // Gereviewde uitzonderingen per waarde. Bewust een bevat-controle en geen
    // exacte lijst: een nieuwe uitzondering hoort een reviewbeslissing te zijn,
    // geen testbreuk.
    const ontleed = uitkomst.allowlist.tokens.map(ontleedTokenRegel);
    expect(ontleed.map((t) => t.waarde)).toContain("herinnering_boeken_2_positief");
    for (const { waarde } of ontleed) {
      expect(waarde).not.toMatch(/^(sb_secret_|sk-|SG\.|re_)/);
    }
    // Elke uitzondering hoort aan een pad gebonden te zijn. Een repo-brede
    // uitzondering maakt de scanner overal blind voor die string, en dat is
    // precies hoe twee demonstratiewachtwoorden uit een QA-rapport per ongeluk
    // een permanent gat werden. Deze test valt om zodra iemand er weer een
    // zonder pad toevoegt.
    for (const { waarde, pad } of ontleed) {
      expect(pad, `allowlist-token "${waarde}" heeft geen pad`).not.toBeNull();
    }
  });

  it("accepteert de afgesproken vorm en sorteert deterministisch", () => {
    const uitkomst = laadAllowlist(
      regels("emails:", "  - flow@tovas.nl", "  - Info@Tovas.nl", "telefoonnummers:", '  - "+31612686292"'),
    );
    expect(uitkomst.ok).toBe(true);
    if (!uitkomst.ok) return;
    expect(uitkomst.allowlist.emails).toEqual(["flow@tovas.nl", "info@tovas.nl"]);
    expect(uitkomst.allowlist.tokens).toEqual([]);
  });

  it("weigert een onbekende sleutel", () => {
    const uitkomst = laadAllowlist(regels("uuids:", "  - " + KLANT_UUID));
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) return;
    expect(uitkomst.fouten.join(" ")).toContain("onbekende sleutel");
  });

  it("weigert een UUID in tokens — HARDE REGEL", () => {
    const uitkomst = laadAllowlist(regels("tokens:", "  - " + KLANT_UUID));
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) return;
    expect(uitkomst.fouten).toHaveLength(1);
    expect(uitkomst.fouten[0]).toContain("UUID");
    expect(uitkomst.fouten[0]).not.toContain(KLANT_UUID);
  });

  it("weigert een UUID die als e-mail of telefoonnummer is verstopt", () => {
    const alsEmail = laadAllowlist(regels("emails:", `  - ${KLANT_UUID}@tovas.nl`));
    expect(alsEmail.ok).toBe(false);
    const alsTelefoon = laadAllowlist(regels("telefoonnummers:", `  - "${KLANT_UUID}"`));
    expect(alsTelefoon.ok).toBe(false);
  });

  it("weigert een leverancierssecret in de allowlist", () => {
    const uitkomst = laadAllowlist(regels("tokens:", "  - sb_secret_AbCdEf12345678xyzQRS"));
    expect(uitkomst.ok).toBe(false);
    if (uitkomst.ok) return;
    expect(uitkomst.fouten[0]).toContain("supabase_secret_key");
  });

  it("weigert een lijst met een niet-tekstwaarde", () => {
    const uitkomst = laadAllowlist(regels("telefoonnummers:", "  - 31612686292"));
    expect(uitkomst.ok).toBe(false);
  });
});

describe("allowlist in de scan", () => {
  it("geeft geen bevinding op een allowlisted e-mailadres", () => {
    expect(scanTekst("Mail naar info@tovas.nl", PUBLIEKE_ALLOWLIST)).toEqual([]);
    expect(scanTekst("Mail naar INFO@tovas.nl", PUBLIEKE_ALLOWLIST)).toEqual([]);
  });

  it("geeft geen bevinding op een allowlisted telefoonnummer, ook in NL-notatie", () => {
    expect(scanTekst("Bel +31612686292", PUBLIEKE_ALLOWLIST)).toEqual([]);
    expect(scanTekst("Bel 06 12686292", PUBLIEKE_ALLOWLIST)).toEqual([]);
    expect(scanTekst("Bel 06-12686292", PUBLIEKE_ALLOWLIST)).toEqual([]);
    expect(normaliseerTelefoon("06-12686292")).toBe("+31612686292");
  });

  it("geeft wél een bevinding op een niet-allowlisted adres of nummer", () => {
    expect(patronen(scanTekst("Mail naar klant@voorbeeld.nl", PUBLIEKE_ALLOWLIST))).toEqual([
      "email",
    ]);
    expect(patronen(scanTekst("Bel +31611111111", PUBLIEKE_ALLOWLIST))).toEqual([
      "telefoon_e164",
    ]);
  });

  it("laat een expliciet vrijgegeven hoge-entropietoken door", () => {
    const met: Allowlist = { ...PUBLIEKE_ALLOWLIST, tokens: [ENTROPIE_TOKEN] };
    expect(scanTekst(`site-key: ${ENTROPIE_TOKEN}`, met)).toEqual([]);
  });

  it("vindt een UUID ALTIJD, ook als iemand hem in de allowlist propt", () => {
    // Dit Allowlist-object omzeilt laadAllowlist (die zou het al weigeren);
    // de scan mag er evenmin intrappen.
    const gesmokkeld: Allowlist = {
      emails: [KLANT_UUID],
      telefoonnummers: [KLANT_UUID],
      tokens: [KLANT_UUID],
    };
    const bevindingen = scanTekst(`tenant: ${KLANT_UUID}`, gesmokkeld);
    expect(patronen(bevindingen)).toEqual(["uuid"]);
    expect(bevindingen[0].fragment).not.toContain("0305e82c3301");
  });

  it("laat een secret nooit toe via de allowlist", () => {
    const gesmokkeld: Allowlist = {
      emails: [],
      telefoonnummers: [],
      tokens: ["sb_secret_AbCdEf12345678xyzQRS"],
    };
    expect(patronen(scanTekst("k: sb_secret_AbCdEf12345678xyzQRS", gesmokkeld))).toEqual([
      "supabase_secret_key",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Voorbeeldblokken
// ---------------------------------------------------------------------------

describe("voorbeeldmarkering", () => {
  it("onderdrukt scanning in het volgende codeblok, en alleen daar", () => {
    const tekst = regels(
      "Contact: eerste@voorbeeld.nl",
      VOORBEELD_MARKERING,
      FENCE + "yaml",
      "supabase_key: sb_secret_AbCdEf12345678xyzQRS",
      FENCE,
      "",
      FENCE + "yaml",
      "lek: tweede@voorbeeld.nl",
      FENCE,
    );
    const bevindingen = scanTekst(tekst, LEGE_ALLOWLIST);
    // De markering onderdrukt UITSLUITEND contactgegevens. De sleutel binnen
    // het voorbeeldblok wordt wel degelijk gevonden: een secret is nooit een
    // legitiem voorbeeld, en wie er een in een voorbeeld zet heeft juist dan
    // een poort nodig.
    expect(patronen(bevindingen)).toEqual(["email", "supabase_secret_key", "email"]);
    expect(bevindingen.map((b) => b.regel)).toEqual([1, 4, 8]);
  });

  it("redigeert een sleutel ook binnen een voorbeeldblok", () => {
    const tekst = regels(
      VOORBEELD_MARKERING,
      FENCE,
      "key: sb_secret_AbCdEf12345678xyzQRS",
      FENCE,
      "echt: sb_secret_AbCdEf12345678xyzQRS",
    );
    const uitkomst = sanitizeTekst(tekst, LEGE_ALLOWLIST);
    expect(uitkomst.tekst).not.toContain("sb_secret_AbCdEf12345678xyzQRS");
    expect(uitkomst.vervangingen).toHaveLength(2);
  });

  it("laat een contactadres binnen een voorbeeldblok wel staan", () => {
    const tekst = regels(VOORBEELD_MARKERING, FENCE, "mail: iemand@voorbeeld.nl", FENCE);
    const uitkomst = sanitizeTekst(tekst, LEGE_ALLOWLIST);
    expect(uitkomst.tekst).toContain("mail: iemand@voorbeeld.nl");
    expect(uitkomst.vervangingen).toHaveLength(0);
  });

  it("vrijwaart alleen een blok dat DIRECT op de markering volgt", () => {
    const tekst = regels(
      VOORBEELD_MARKERING,
      "",
      FENCE,
      "lek: klant@voorbeeld.nl",
      FENCE,
    );
    expect(patronen(scanTekst(tekst, LEGE_ALLOWLIST))).toEqual(["email"]);
  });
});

// ---------------------------------------------------------------------------
// sanitizeTekst
// ---------------------------------------------------------------------------

describe("sanitizeTekst", () => {
  const VUILE_TEKST = regels(
    "# Taakdossier",
    "Klant e-mail: klant@voorbeeld.nl, telefoon 06-12345678.",
    `Tenant: ${KLANT_UUID}`,
    "Sleutel uit .env: sb_secret_AbCdEf12345678xyzQRS",
    "Publiek: info@tovas.nl en +31612686292",
  );

  it("vervangt door stabiele placeholders en laat publieke gegevens staan", () => {
    const uitkomst = sanitizeTekst(VUILE_TEKST, PUBLIEKE_ALLOWLIST, "tasks/T-001.md");
    expect(patronen(uitkomst.vervangingen)).toEqual([
      "email",
      "telefoon_nl",
      "uuid",
      "supabase_secret_key",
    ]);
    expect(uitkomst.tekst).toContain("[[GEREDIGEERD:email:1]]");
    expect(uitkomst.tekst).toContain("[[GEREDIGEERD:uuid:1]]");
    expect(uitkomst.tekst).toContain("Publiek: info@tovas.nl en +31612686292");
    expect(uitkomst.tekst).not.toContain(KLANT_UUID);
    expect(uitkomst.vervangingen.every((v) => v.bestand === "tasks/T-001.md")).toBe(true);
  });

  it("geeft dezelfde waarde altijd dezelfde placeholder", () => {
    const tekst = regels(
      "eerst klant@voorbeeld.nl",
      "andere ander@voorbeeld.nl",
      "weer klant@voorbeeld.nl",
    );
    const uitkomst = sanitizeTekst(tekst, LEGE_ALLOWLIST);
    expect(uitkomst.tekst).toBe(
      regels(
        "eerst [[GEREDIGEERD:email:1]]",
        "andere [[GEREDIGEERD:email:2]]",
        "weer [[GEREDIGEERD:email:1]]",
      ),
    );
  });

  it("sanitize → onafhankelijke rescan → schoon (happy path)", () => {
    const uitkomst = sanitizeTekst(VUILE_TEKST, PUBLIEKE_ALLOWLIST);
    expect(scanTekst(uitkomst.tekst, PUBLIEKE_ALLOWLIST)).toEqual([]);
  });

  it("laat een tekst zonder treffers letterlijk ongemoeid", () => {
    const tekst = regels("Niets aan de hand.", "Echt niets.");
    const uitkomst = sanitizeTekst(tekst, LEGE_ALLOWLIST);
    expect(uitkomst.tekst).toBe(tekst);
    expect(uitkomst.vervangingen).toEqual([]);
  });

  it("vervangt een hoge-entropiestring NIET automatisch", () => {
    const uitkomst = sanitizeTekst(`token: ${ENTROPIE_TOKEN}`, LEGE_ALLOWLIST);
    expect(uitkomst.vervangingen).toEqual([]);
    expect(uitkomst.tekst).toContain(ENTROPIE_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// sanitizeBestanden — de poort
// ---------------------------------------------------------------------------

function geheugen(bestanden: Record<string, string>) {
  const geschreven: Record<string, string> = { ...bestanden };
  return {
    geschreven,
    lees: (pad: string) => (pad in geschreven ? geschreven[pad] : null),
    schrijf: (pad: string, inhoud: string) => {
      geschreven[pad] = inhoud;
    },
  };
}

describe("sanitizeBestanden", () => {
  it("schrijft de gesanitizede tekst en meldt ok bij een schone rescan", async () => {
    const opslag = geheugen({
      "tasks/T-001.md": regels("Klant: klant@voorbeeld.nl", `Tenant: ${KLANT_UUID}`),
      "docs/CURRENT_STATE.md": "Alles rustig, bel info@tovas.nl.",
    });

    const uitkomst = await sanitizeBestanden(
      ["tasks/T-001.md", "docs/CURRENT_STATE.md"],
      opslag.lees,
      opslag.schrijf,
      PUBLIEKE_ALLOWLIST,
    );

    expect(uitkomst.ok).toBe(true);
    expect(uitkomst.bevindingen).toEqual([]);
    expect(uitkomst.gewijzigd).toEqual(["tasks/T-001.md"]);
    expect(opslag.geschreven["tasks/T-001.md"]).toBe(
      regels("Klant: [[GEREDIGEERD:email:1]]", "Tenant: [[GEREDIGEERD:uuid:1]]"),
    );
    expect(opslag.geschreven["docs/CURRENT_STATE.md"]).toBe("Alles rustig, bel info@tovas.nl.");
  });

  it("faalt hard wanneer de rescan nog iets vindt", async () => {
    const opslag = geheugen({
      "knowledge/LRN-0001.md": regels(
        `Debug-token: ${ENTROPIE_TOKEN}`,
        "Gemeld door klant@voorbeeld.nl",
      ),
    });

    const uitkomst = await sanitizeBestanden(
      ["knowledge/LRN-0001.md"],
      opslag.lees,
      opslag.schrijf,
      PUBLIEKE_ALLOWLIST,
    );

    // De e-mail is wél vervangen — dat maakt de poort niet groen.
    expect(uitkomst.gewijzigd).toEqual(["knowledge/LRN-0001.md"]);
    expect(opslag.geschreven["knowledge/LRN-0001.md"]).toContain("[[GEREDIGEERD:email:1]]");
    expect(uitkomst.ok).toBe(false);
    expect(uitkomst.bevindingen).toEqual([
      {
        bestand: "knowledge/LRN-0001.md",
        regel: 1,
        patroon: "hoge_entropie",
        fragment: maskeerFragment(ENTROPIE_TOKEN),
        severity: "kritiek",
      },
    ]);
    expect(uitkomst.bevindingen[0].fragment).not.toBe(ENTROPIE_TOKEN);
  });

  it("faalt op een onleesbaar bestand in plaats van het over te slaan", async () => {
    const opslag = geheugen({});
    const uitkomst = await sanitizeBestanden(
      ["knowledge/verdwenen.md"],
      opslag.lees,
      opslag.schrijf,
      LEGE_ALLOWLIST,
    );
    expect(uitkomst.ok).toBe(false);
    expect(patronen(uitkomst.bevindingen)).toEqual(["bestand_onleesbaar"]);
    expect(uitkomst.gewijzigd).toEqual([]);
  });

  it("werkt met asynchrone I/O-functies", async () => {
    const opslag = geheugen({ "project/PROJECT.md": "Bel 06-12345678" });
    const uitkomst = await sanitizeBestanden(
      ["project/PROJECT.md"],
      async (pad) => opslag.lees(pad),
      async (pad, inhoud) => {
        opslag.schrijf(pad, inhoud);
      },
      LEGE_ALLOWLIST,
    );
    expect(uitkomst.ok).toBe(true);
    expect(opslag.geschreven["project/PROJECT.md"]).toBe("Bel [[GEREDIGEERD:telefoon_nl:1]]");
  });
});

// ---------------------------------------------------------------------------
// Determinisme
// ---------------------------------------------------------------------------

describe("determinisme", () => {
  const TEKST = regels(
    "Klant klant@voorbeeld.nl / 06 12345678",
    `Tenant ${KLANT_UUID} met token ${ENTROPIE_TOKEN}`,
    "Key sk-ant-api03-AbCdEf1234567890XyZaBcDeFgHi en info@tovas.nl",
  );

  it("scanTekst geeft twee keer exact dezelfde uitvoer, inclusief volgorde", () => {
    const eerste = scanTekst(TEKST, PUBLIEKE_ALLOWLIST, "knowledge/K.md");
    const tweede = scanTekst(TEKST, PUBLIEKE_ALLOWLIST, "knowledge/K.md");
    expect(tweede).toEqual(eerste);
    expect(patronen(eerste)).toEqual([
      "email",
      "telefoon_nl",
      "uuid",
      "hoge_entropie",
      "anthropic_api_key",
    ]);
  });

  it("sanitizeTekst geeft twee keer exact dezelfde uitvoer", () => {
    expect(sanitizeTekst(TEKST, PUBLIEKE_ALLOWLIST)).toEqual(
      sanitizeTekst(TEKST, PUBLIEKE_ALLOWLIST),
    );
  });

  it("sanitizeBestanden geeft twee keer exact dezelfde uitvoer", async () => {
    const draai = async () => {
      const opslag = geheugen({ "tasks/T-002.md": TEKST });
      const uitkomst = await sanitizeBestanden(
        ["tasks/T-002.md"],
        opslag.lees,
        opslag.schrijf,
        PUBLIEKE_ALLOWLIST,
      );
      return { uitkomst, inhoud: opslag.geschreven["tasks/T-002.md"] };
    };
    expect(await draai()).toEqual(await draai());
  });

  it("laadAllowlist geeft twee keer exact dezelfde uitvoer", () => {
    const inhoud = regels("emails:", "  - flow@tovas.nl", "  - info@tovas.nl");
    expect(laadAllowlist(inhoud)).toEqual(laadAllowlist(inhoud));
  });
});

describe("de gaten die de derde QA-ronde vond", () => {
  const LEEG = LEGE_ALLOWLIST;

  it("scant wat er op schijf staat, niet de eigen geredigeerde uitvoer", async () => {
    // Dit was het ernstigste gat van de derde ronde. De poort draait in CI
    // bewust ZONDER --schrijf, waar de schrijffunctie niets doet. De rescan
    // keek toen naar een geredigeerde tekst die nergens bestond, terwijl het
    // bestand het secret nog gewoon bevatte. Elk patroon dat automatisch
    // vervangen kan worden was daardoor onzichtbaar in precies die stand.
    const inhoud = [
      "OPENAI_API_KEY=sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7dEf0hIj3k",
      "contact: klant@voorbeeldbedrijf.nl",
      "tenant: 3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
    ].join("\n");

    const geenSchrijver = async () => {
      /* precies wat de CLI doet zonder --schrijf */
    };
    const resultaat = await sanitizeBestanden(["knowledge/K.md"], async () => inhoud, geenSchrijver, LEEG);

    expect(resultaat.ok).toBe(false);
    expect(resultaat.gewijzigd).toEqual([]);
    const patronen = new Set(resultaat.bevindingen.map((b) => b.patroon));
    expect(patronen.has("openai_api_key")).toBe(true);
    expect(patronen.has("email")).toBe(true);
    expect(patronen.has("uuid")).toBe(true);
  });

  it("meldt het wanneer een bestand na het schrijven niet meer te lezen is", async () => {
    let eerste = true;
    const lees = async () => {
      if (eerste) {
        eerste = false;
        return "contact: klant@voorbeeldbedrijf.nl";
      }
      return null;
    };
    const resultaat = await sanitizeBestanden(["knowledge/K.md"], lees, async () => {}, LEEG);
    expect(resultaat.bevindingen.some((b) => b.patroon === "bestand_onleesbaar")).toBe(true);
    expect(resultaat.ok).toBe(false);
  });

  describe("sleutels die eerder onder de drempels door vielen", () => {
    const moetVinden: [string, string][] = [
      ["AWS-secret met schuine strepen", "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"],
      ["base64 met plus en schuine streep", "SMTP_PASS=Xk2/pQ8m+Lz4/Rt9wN1cVb7/YhJ3eKd5"],
      ["Basic-auth-kop", "Authorization: Basic YWRtaW46U3VwZXJHZWhlaW0yMDI2IQ=="],
      ["sleutel van 128 bits (22 tekens)", "API_KEY=Qm9vdHN0cmFwS2V5MTIzNA"],
      ["base64url van 27 tekens", "SESSION_SECRET=aG-9xQvK3mTd7LpWq2ZrYb8Nc_V"],
      ["PEM-header", "-----BEGIN RSA PRIVATE KEY-----"],
      ["PGP-blok", "-----BEGIN PGP PRIVATE KEY BLOCK-----"],
      ["token van 32 cijfers", "TWILIO_AUTH_TOKEN=01234567890123456789012345678901"],
      ["wachtwoord in een verbindingsreeks", "postgresql://postgres:Z0mer2026Sleutel@db.abc.example.com:5432/db"],
      ["wachtwoord met schuine streep erin", "mongodb+srv://appuser:Xk9/mQ2p@cluster0.abcd.example.net/test"],
    ];
    for (const [naam, tekst] of moetVinden) {
      it(`vangt ${naam}`, () => {
        expect(scanTekst(tekst, LEEG, "knowledge/K.md").length).toBeGreaterThan(0);
      });
    }

    it("vangt een wachtwoord in een verbindingsreeks ook in een voorbeeldblok", () => {
      // De voorbeeldmarkering zet contactgegevens uit. Toen een verbindingsreeks
      // alleen via het e-mailpatroon oplichtte, betekende dat: wachtwoord in een
      // voorbeeldblok is wachtwoord zonder bevinding.
      const tekst = [
        VOORBEELD_MARKERING,
        "```",
        "DATABASE_URL=postgresql://postgres:Z0mer2026Sleutel@db.abc.example.com:5432/db",
        "```",
      ].join("\n");
      expect(scanTekst(tekst, LEEG, "knowledge/K.md").some((b) => b.patroon === "verbindingsreeks")).toBe(true);
    });
  });

  describe("wat géén sleutel is", () => {
    const magNietVinden: [string, string][] = [
      ["een migratiepad", "nieuwe migratie `db/migrations/0012_factuur_herinnering_3.sql`"],
      ["een taakpad", "`jarvis/policies/security-checklist.md`, `tasks/T-20260910-jarvis-v1/opdracht.md`"],
      ["een windowspad", '"/c/Program Files/PostgreSQL/17/bin/pg_dump.exe" --dbname="$DB"'],
      ["een rotatienaam naast het woord key", "OPENAI_API_KEY rotatie: `mijnapp-prod-2026-08-31`"],
      ["een archiefbestand", "`docs/CLAUDE_ARCHIEF_2026-09-10.md`"],
      ["een git-blobhash", "manifesthash cef41d5a9b3e7f21c8d04e6a5b9f3c7d1e8a2b4f"],
      ["een plaatshouder tussen punthaken", "postgresql://postgres.abc:<pw-uit-kluis>@aws-0.pooler.example.com:5432/db"],
      ["het woord password als wachtwoord", "postgresql://gebruiker:password@localhost:5432/postgres"],
      ["gewone tekst", "De orchestrator draait de poort en leest de kennisbasis uit."],
    ];
    for (const [naam, tekst] of magNietVinden) {
      it(`zwijgt over ${naam}`, () => {
        expect(scanTekst(tekst, LEEG, "knowledge/K.md")).toEqual([]);
      });
    }
  });

  describe("padbinding van de allowlist", () => {
    const metToken = (regel: string) => ({ emails: [], telefoonnummers: [], tokens: [regel] });
    const TEKST = "sleutel: Xq7mTpZ2vLd9RkWs4NbHyCj6UaFg3Emt";

    it("laat de waarde door binnen het pad en nergens anders", () => {
      const lijst = metToken("Xq7mTpZ2vLd9RkWs4NbHyCj6UaFg3Emt in docs/");
      expect(scanTekst(TEKST, lijst, "docs/A.md")).toEqual([]);
      expect(scanTekst(TEKST, lijst, "knowledge/A.md").length).toBeGreaterThan(0);
    });

    it("behandelt een pad zonder slotstreep als een bestandsnaam", () => {
      // Anders dekt de uitzondering `docs` ook `docs-oud/`, en dat is precies
      // de stilzwijgende verbreding die een allowlist niet hoort te hebben.
      const lijst = metToken("Xq7mTpZ2vLd9RkWs4NbHyCj6UaFg3Emt in docs/A.md");
      expect(scanTekst(TEKST, lijst, "docs/A.md")).toEqual([]);
      expect(scanTekst(TEKST, lijst, "docs/A.md.bak").length).toBeGreaterThan(0);
      expect(scanTekst(TEKST, lijst, "docs-oud/A.md").length).toBeGreaterThan(0);
    });

    it("geldt overal wanneer er bewust geen pad staat", () => {
      const lijst = metToken("Xq7mTpZ2vLd9RkWs4NbHyCj6UaFg3Emt");
      expect(scanTekst(TEKST, lijst, "waar/dan/ook.md")).toEqual([]);
    });

    it("weigert een regel met \" in \" maar zonder pad", () => {
      const uitkomst = laadAllowlist(
        ["tokens:", "  - Xq7mTpZ2vLd9RkWs4NbHyCj6UaFg3Emt in "].join("\n"),
      );
      expect(uitkomst.ok).toBe(false);
      if (uitkomst.ok) return;
      expect(uitkomst.fouten.join(" ")).toContain("zonder pad");
    });
  });
});
