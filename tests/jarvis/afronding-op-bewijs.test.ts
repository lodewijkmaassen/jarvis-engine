// Een doel is pas klaar als het eindresultaat aantoonbaar is bereikt (D-20261115-095941788).
//
// De zeven acceptatie-eisen van dat doel, elk met een eigen blok. De meting loopt door de echte
// `voerAcceptatieUit` met een nagebootste database en beoordelaar: dezelfde weg die de eindcontrole
// in CI neemt, zonder netwerk.

import { describe, expect, it } from "vitest";

import { AFGELEIDE_TEST_ID, afgeleideAcceptatieTest, bouwPrBewijs, eindoordeel, PR_BEWIJS_TEKENS, leesAcceptatieTests, testsVoorDoel } from "../../jarvis/src/acceptatie";
import { voerAcceptatieUit } from "../../jarvis/src/doel-acceptatie";
import { dispatchNodig, herhaling, HERHALING_DREMPEL, HERHALING_MAX, normaliseerOvergang, type Doel, type Herhaling } from "../../jarvis/src/doelen";
import type { DbClient } from "../../jarvis/src/opdrachten";

function doel(over: Partial<Doel> = {}): Doel {
  return {
    id: "D-20261114-120000000",
    titel: "Een knop toevoegen",
    opdracht: "Voeg op de overzichtspagina een knop 'Exporteren' toe die een CSV downloadt.",
    acceptatie_url: null,
    status: "samengevoegd",
    pr: { repo: "voorbeeld/app", nummer: 42, kop: "a".repeat(40), merge_sha: "b".repeat(40) },
    uitkomst: null,
    pogingen: 0,
    bijgewerkt: "2026-11-14T12:00:00Z",
    ...over,
  };
}

/** Een database die alles leeg teruggeeft, behalve de beoordelaar: die antwoordt met `oordeel`. */
function nepDb(oordeel: { geslaagd: boolean; reden: string }): { sql: DbClient; vragen: string[] } {
  const vragen: string[] = [];
  const sql: DbClient = {
    unsafe: async (q, params) => {
      if (q.includes("vraag_review")) {
        const aanroep = JSON.parse(String(params?.[0])) as { messages?: { content?: string }[] };
        vragen.push((aanroep.messages ?? []).map((m) => m.content ?? "").join("\n"));
        return [{ id: 1 }];
      }
      if (q.includes("lees_review")) {
        return [{ status_code: 200, error_msg: null, timed_out: false, content: JSON.stringify({ choices: [{ message: { content: JSON.stringify(oordeel) } }] }) }];
      }
      return [];
    },
    end: async () => {},
  };
  return { sql, vragen };
}

const PR = bouwPrBewijs({ repo: "voorbeeld/app", nummer: 42, titel: "Exportknop", tekst: "Voegt de knop toe.\nDoel: D-20261114-120000000" }, [
  { naam: "src/overzicht.tsx", status: "modified", erbij: 12, eraf: 1, patch: "+<button>Exporteren</button>" },
]);

describe("2. een samengevoegde pull request maakt een doel niet klaar", () => {
  it("geeft een doel zonder acceptatietest toch een test: de afgeleide, nooit een lege lijst", () => {
    const tests = testsVoorDoel(doel());
    expect(tests).toHaveLength(1);
    expect(tests[0]!.id).toBe(AFGELEIDE_TEST_ID);
    expect(tests[0]!.tekst).toMatch(/op zichzelf GEEN bewijs/);
  });

  it("noemt nul uitgevoerde tests niet klaar", () => {
    expect(eindoordeel([]).klaar).toBe(false);
  });

  it("vraagt de beoordelaar naar het eindresultaat, met de opdracht en de inhoud van de pull request", async () => {
    const { sql, vragen } = nepDb({ geslaagd: false, reden: "de diff toont de knop, maar niets toont dat de CSV wordt gedownload" });
    const uit = await voerAcceptatieUit(sql, doel(), testsVoorDoel(doel()), PR);
    expect(vragen).toHaveLength(1);
    expect(vragen[0]).toContain("CSV downloadt");
    expect(vragen[0]).toContain("inhoud van pull request voorbeeld/app#42");
    expect(vragen[0]).toContain("+<button>Exporteren</button>");
    expect(eindoordeel(uit).klaar).toBe(false);
  }, 20_000);
});

describe("4. ontbrekend acceptatiebewijs leidt tot een vervolgactie", () => {
  it("is een gezakte afgeleide test werk voor de uitvoerder (herstelketen), geen ontbrekende bevoegdheid", async () => {
    const { sql } = nepDb({ geslaagd: false, reden: "geen test toont de download" });
    const eind = eindoordeel(await voerAcceptatieUit(sql, doel(), testsVoorDoel(doel()), PR));
    expect(eind.klaar).toBe(false);
    expect(eind.onmeetbaar).toBe(false); // → bezig, niet vast
    expect(eind.samenvatting).toContain(`${AFGELEIDE_TEST_ID}: niet-geslaagd`);
  }, 20_000);
});

describe("5. een daadwerkelijk afgerond doel heet klaar", () => {
  it("is klaar zodra de beoordelaar het eindresultaat in het bewijs ziet", async () => {
    const { sql } = nepDb({ geslaagd: true, reden: "knop en download-test staan in de diff" });
    const eind = eindoordeel(await voerAcceptatieUit(sql, doel(), testsVoorDoel(doel()), PR));
    expect(eind.klaar).toBe(true);
  }, 20_000);
});

// De overgangen zoals ze op 2026-11-13/14 in jarvis.activiteit stonden voor D-20261107-225515647, nieuwste eerst.
const ECHT = [
  "samengevoegd → klaar: samengevoegd; het doel noemt geen acceptatie-URL en geen expliciete acceptatietest",
  "review → samengevoegd",
  "bezig → review",
  "open → bezig",
  "klaar → open [heropend]",
  "samengevoegd → klaar: samengevoegd; het doel noemt geen acceptatie-URL en geen expliciete acceptatietest",
  "review → samengevoegd",
  "bezig → review",
  "open → bezig",
  "klaar → open [heropend]",
  "samengevoegd → klaar: samengevoegd; het doel noemt geen acceptatie-URL en geen expliciete acceptatietest",
].map((tekst) => ({ tekst }));

describe("3. herhalend of vastgelopen gedrag wordt gedetecteerd en doorbroken", () => {
  it("herkent de echte lus van D-20261107-225515647 als herhaling", () => {
    const h = herhaling(ECHT);
    expect(h.aantal).toBe(3);
    expect(h.besluit).toBe("andere-aanpak");
  });

  it("telt gewoon werk (overgangen zonder reden) niet als herhaling", () => {
    const werk = Array.from({ length: 10 }, () => ({ tekst: "bezig → review" }));
    expect(herhaling(werk).besluit).toBe("door");
  });

  it("ziet dezelfde reden met andere minuten, commits en ketenversie als dezelfde", () => {
    expect(normaliseerOvergang("samengevoegd → bezig: productie na 31 min niet in orde: bouwmerk abc1234 [keten 7f20041]")).toBe(
      normaliseerOvergang("samengevoegd → bezig: productie na 95 min niet in orde: bouwmerk def5678"),
    );
  });

  it("stopt een eindeloze lus: vanaf HERHALING_MAX is het besluit vast", () => {
    const lus = Array.from({ length: HERHALING_MAX }, (_, i) => ({ tekst: `samengevoegd → bezig: productie na ${30 + i} min niet in orde: HTTP 500` }));
    expect(herhaling(lus.slice(0, HERHALING_DREMPEL - 1)).besluit).toBe("door");
    expect(herhaling(lus.slice(0, HERHALING_DREMPEL)).besluit).toBe("andere-aanpak");
    expect(herhaling(lus).besluit).toBe("vast");
  });
});

describe("1. een onafgerond doel wordt zelfstandig voortgezet", () => {
  const nu = new Date("2026-11-15T10:00:00Z");
  const stil = { id: "D-20261114-120000000", status: "bezig" as const, bijgewerkt: "2026-11-15T09:00:00Z" };

  it("start de uitvoerder voor een doel dat stilstaat", () => {
    expect(dispatchNodig([stil], nu).start).toBe(true);
  });

  it("zegt de uitvoerder dat het doel herhaalt en dat de aanpak anders moet", () => {
    const h: Herhaling = herhaling(ECHT);
    const b = dispatchNodig([stil], nu, new Map([[stil.id, h]]));
    expect(b.start).toBe(true);
    expect(b.reden).toContain("HERHALING");
    expect(b.reden).toContain("andere aanpak");
  });

  it("noemt geen herhaling waar er geen is", () => {
    expect(dispatchNodig([stil], nu, new Map()).reden).not.toContain("HERHALING");
  });
});

describe("6. werkt generiek, voor elk project", () => {
  it("leidt voor elk project dezelfde soort test af, zonder projectkennis", () => {
    for (const repo of ["voorbeeld/app", "voorbeeld/kasboek", "voorbeeld/engine"]) {
      const t = afgeleideAcceptatieTest({ acceptatie_url: null, pr: { nummer: 7 } });
      expect(t.soort).toBe("bewijs");
      expect(t.onderwerp).toBe("#7");
      expect(t.tekst).not.toContain(repo);
    }
  });

  it("meet de pagina zelf als het doel een acceptatie-URL noemt", () => {
    const t = afgeleideAcceptatieTest({ acceptatie_url: "https://voorbeeld.test/login", pr: null });
    expect(t.soort).toBe("http");
    expect(t.url).toBe("https://voorbeeld.test/login");
    expect(t.onderwerp).toBeNull();
  });
});

describe("7. bestaande uitvoering is niet verslechterd", () => {
  it("houdt de tests die de eigenaar zelf schreef en voegt er geen afgeleide aan toe", () => {
    const opdracht = "Doe iets.\n\nAcceptatietests:\nA. Stel aan de AI Core de vraag “wat is de status van D-20261021-161119608?” en controleer het antwoord.\nB. De pagina https://voorbeeld.test/x toont het woord Welkom.";
    const d = doel({ opdracht });
    expect(testsVoorDoel(d)).toEqual(leesAcceptatieTests(opdracht));
    expect(testsVoorDoel(d).map((t) => t.id)).toEqual(["A", "B"]);
  });

  it("kapt een grote pull request af zodat het overige bewijs blijft passen", () => {
    const groot = bouwPrBewijs({ repo: "r/x", nummer: 1, titel: "t", tekst: "" }, Array.from({ length: 200 }, (_, i) => ({ naam: `f${i}.ts`, status: "added", erbij: 1, eraf: 0, patch: "+".repeat(1500) })));
    expect(groot.length).toBeLessThan(PR_BEWIJS_TEKENS + 100);
    expect(groot).toMatch(/\[afgekapt\]$/);
  });
});

/**
 * Het bewijsblok komt uit de merge-commit, niet uit de pull request.
 *
 * De eindcontrole draait met `contents: read`. Pull requests lezen vraagt
 * `pull-requests: read`, dat die job niet heeft — gemeten op 2026-11-16: het
 * blok bleef leeg en de beoordelaar zag nooit wát er gebouwd was, ook niet bij
 * een doel waarvan de samenvoeging exact deed wat de opdracht vroeg. De
 * merge-commit draagt dezelfde bestanden en diffs.
 */
describe("de herkomst van het bewijsblok staat erbij", () => {
  const bestanden = [{ naam: "package.json", status: "modified", erbij: 1, eraf: 1, patch: "@@ -25,7 +25,7 @@\n-  oud\n+  nieuw" }];

  it("noemt standaard de pull request", () => {
    const b = bouwPrBewijs({ repo: "org/app", nummer: 336, titel: "Pin", tekst: "" }, bestanden);
    expect(b).toContain("inhoud van pull request org/app#336");
    expect(b).toContain("package.json");
    expect(b).toContain("+  nieuw");
  });

  it("noemt de merge-commit wanneer het blok daaruit komt", () => {
    const b = bouwPrBewijs(
      { repo: "org/app", nummer: 336, titel: "Merge pull request #336", tekst: "" },
      bestanden,
      "inhoud van de samenvoeging van dit doel (org/app, merge-commit 847a059, zojuist gelezen via de GitHub-API):",
    );
    expect(b).toContain("merge-commit 847a059");
    expect(b).not.toContain("inhoud van pull request");
    expect(b).toContain("package.json");
  });
});
