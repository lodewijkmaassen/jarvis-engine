// D-20261117-194904457: de acceptatietest van "Projecten" zakte twee keer omdat de beoordelaar alleen de
// pull request in het project zag, en die werkte alleen de engine-pin bij. Het werk zelf (de interface en
// de tests) stond in de engine. Het bewijs neemt dat engine-werk nu mee, tot en met de pin van het project.
import { describe, expect, it } from "vitest";

import { bouwPrBewijs, leesEngineWerkMee, metHerkomst, werkVanDoel, type DoelCommit } from "../../jarvis/src/acceptatie";

const DOEL = "D-20261117-194904457";

describe("leesEngineWerkMee", () => {
  it("leest de engine mee voor een doel in een ander project met een bekende pin", () => {
    expect(leesEngineWerkMee("eigenaar/project", "eigenaar/engine", "c00fca5")).toBe(true);
  });

  it("leest niet dubbel als het doel al in de engine zelf ligt", () => {
    expect(leesEngineWerkMee("eigenaar/engine", "eigenaar/engine", "c00fca5")).toBe(false);
    expect(leesEngineWerkMee("Eigenaar/Engine", "eigenaar/engine", "c00fca5")).toBe(false);
  });

  it("leest niets zonder engine of zonder pin", () => {
    expect(leesEngineWerkMee("eigenaar/project", "", "c00fca5")).toBe(false);
    expect(leesEngineWerkMee("eigenaar/project", null, "c00fca5")).toBe(false);
    expect(leesEngineWerkMee("eigenaar/project", "eigenaar/engine", null)).toBe(false);
    expect(leesEngineWerkMee("", "eigenaar/engine", "c00fca5")).toBe(false);
  });
});

describe("het bewijs toont het engine-werk naast de pin-wijziging", () => {
  const engine: DoelCommit[] = [
    {
      sha: "87e61e3",
      ouders: 1,
      bericht: `V3: projecten en subprojecten aanmaken\n\nJarvis-Role: developer\nJarvis-Task: ${DOEL}`,
      bestanden: [
        { naam: "jarvis/interface/v3.html", status: "modified", erbij: 60, eraf: 5, patch: "@@ -1 +1 @@\n+  function projectFormulier(ouder) {}" },
        { naam: "tests/jarvis/v3-projecten.test.ts", status: "added", erbij: 75, eraf: 0, patch: "@@ -0,0 +1 @@\n+  it(\"maakt een subproject aan\")" },
      ],
    },
  ];
  const project: DoelCommit[] = [
    {
      sha: "963dad8",
      ouders: 1,
      bericht: `Engine-pin bijgewerkt\n\nJarvis-Role: developer\nJarvis-Task: ${DOEL}`,
      bestanden: [{ naam: "package.json", status: "modified", erbij: 1, eraf: 1, patch: "@@ -1 +1 @@\n-  \"jarvis-engine\": \"#oud\"\n+  \"jarvis-engine\": \"#nieuw\"" }],
    },
  ];

  it("zet de engine-bestanden met hun herkomst in het bewijs, vóór de pin", () => {
    const bestanden = [...metHerkomst("eigenaar/engine", werkVanDoel(DOEL, engine)), ...werkVanDoel(DOEL, project)];
    const uit = bouwPrBewijs({ repo: "eigenaar/project", nummer: 341, titel: "Engine-pin", tekst: "" }, bestanden, "inhoud van al het werk van dit doel:");
    expect(uit).toContain("- eigenaar/engine: jarvis/interface/v3.html (modified, +60 -5)");
    expect(uit).toContain("function projectFormulier(ouder)");
    expect(uit).toContain("maakt een subproject aan");
    expect(uit).toContain("- package.json (modified, +1 -1)");
    expect(uit.indexOf("v3.html")).toBeLessThan(uit.indexOf("package.json"));
  });

  it("verandert alleen de naam, niet de inhoud", () => {
    const [b] = metHerkomst("eigenaar/engine", [{ naam: "a.ts", status: "added", erbij: 1, eraf: 0, patch: "+x" }]);
    expect(b).toEqual({ naam: "eigenaar/engine: a.ts", status: "added", erbij: 1, eraf: 0, patch: "+x" });
  });
});
