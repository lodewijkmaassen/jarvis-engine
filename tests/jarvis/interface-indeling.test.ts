/**
 * De indeling: elk stuk werk in precies één vak, en de interface toont die
 * vakken los van elkaar.
 *
 * De eigenaar kon actief werk, backlog, geparkeerd werk, wachtend werk,
 * risico's en afgerond werk niet uit elkaar houden: alles wat niet van hem was
 * kwam als "Jarvis aan zet" op één hoop, en een nulstand was alleen te zien
 * aan het uitblijven van kaarten. Deze tests leggen twee dingen vast: de
 * indeling zelf is volledig en uitsluitend, en de pagina kent elk vak.
 *
 * De laatste groep voert de echte functies uit de pagina uit in plaats van
 * haar brontekst te bekijken — dezelfde les als in interface-waarheid.test.ts,
 * waar een sabotage aantoonde dat een tekstcontrole een uitgeschakelde functie
 * niet ziet.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bouwOverzicht, deelIn, type ProjectInvoer, type StandVak, type TaakDossier } from "../../jarvis/src/overzicht";

const NU = new Date("2026-09-24T22:00:00Z");

function dossier(id: string, stap: string, status = "actief"): TaakDossier {
  return {
    id,
    opdracht: { status, titel: id, project: "jarvis", klasse: "S" },
    resultaat: `# Resultaat\n\n## Voortgang\n\n- [x] Begonnen\n- [ ] ${stap}\n`,
    tekst: `---\nid: ${id}\n---\n\nscope\n`,
  } as unknown as TaakDossier;
}

function project(taken: readonly TaakDossier[], gitLog: ProjectInvoer["gitLog"] = []): ProjectInvoer {
  return {
    id: "jarvis",
    naam: "jarvis",
    aangesloten: true,
    hoofdbranch: { naam: "main", commit: "abc1234", datum: "2026-09-24" },
    statusDocument: "# CURRENT_STATE\n\n## Waar staan we\n\nIets.\n",
    records: [],
    taken,
    gitLog,
  } as unknown as ProjectInvoer;
}

/** Een commit die de taak binnen het venster beweging geeft. */
function commit(taak: string): ProjectInvoer["gitLog"][number] {
  return {
    hash: "deadbee",
    datum: "2026-09-23T10:00:00Z",
    onderwerp: `Werk aan ${taak}`,
    body: `Jarvis-Role: builder\nJarvis-Task: ${taak}\n`,
  } as unknown as ProjectInvoer["gitLog"][number];
}

const VAKSLEUTELS: readonly StandVak[] = ["actief", "backlog", "bij_jou", "wacht", "geparkeerd", "afgerond"];

describe("de indeling is volledig en uitsluitend", () => {
  it("zet elke taak in precies één vak", () => {
    const o = bouwOverzicht(
      [
        project(
          [
            dossier("T-actief", "Bouw de knop"),
            dossier("T-backlog", "Bouw iets anders"),
            dossier("T-wacht", "wacht op gebeurtenis: de eigenaar geeft dit vrij"),
            dossier("T-klaar", "Af", "afgerond"),
            dossier("T-parkeer", "Later", "gepland"),
          ],
          [commit("T-actief")],
        ),
      ],
      NU,
    );
    const ind = o.indeling;
    const alle = VAKSLEUTELS.flatMap((v) => ind[v].map((t) => t.id));
    // Evenveel regels als taken: geen taak dubbel, geen taak kwijt.
    expect(alle.length).toBe(5);
    expect(new Set(alle).size).toBe(5);
    expect(ind.actief.map((t) => t.id)).toEqual(["T-actief"]);
    expect(ind.backlog.map((t) => t.id)).toEqual(["T-backlog"]);
    expect(ind.wacht.map((t) => t.id)).toEqual(["T-wacht"]);
    expect(ind.afgerond.map((t) => t.id)).toEqual(["T-klaar"]);
    expect(ind.geparkeerd.map((t) => t.id)).toEqual(["T-parkeer"]);
  });

  it("scheidt actief werk van backlog op beweging, niet op status", () => {
    const zonder = bouwOverzicht([project([dossier("T-1", "Bouw de knop")])], NU).indeling;
    expect(zonder.actief).toHaveLength(0);
    expect(zonder.backlog.map((t) => t.id)).toEqual(["T-1"]);
    const met = bouwOverzicht([project([dossier("T-1", "Bouw de knop")], [commit("T-1")])], NU).indeling;
    expect(met.actief.map((t) => t.id)).toEqual(["T-1"]);
    expect(met.backlog).toHaveLength(0);
  });

  it("noemt de nulstand alleen wanneer er geen actief werk is", () => {
    const stil = bouwOverzicht([project([dossier("T-1", "wacht op gebeurtenis: iets")])], NU).indeling;
    expect(stil.nulstand).toBe(true);
    // Wachtend werk bestaat nog wél: een nulstand is een uitspraak, geen leegte.
    expect(stil.wacht).toHaveLength(1);
    const druk = bouwOverzicht([project([dossier("T-1", "Bouw de knop")], [commit("T-1")])], NU).indeling;
    expect(druk.nulstand).toBe(false);
  });

  it("geeft elk vak een eigen reden", () => {
    const ind = bouwOverzicht(
      [project([dossier("T-a", "Bouw"), dossier("T-w", "wacht op PR #1 — iets"), dossier("T-p", "Later", "gepland")])],
      NU,
    ).indeling;
    const redenen = [...ind.backlog, ...ind.wacht, ...ind.geparkeerd].map((t) => t.reden);
    expect(new Set(redenen).size).toBe(redenen.length);
    for (const r of redenen) expect(r).not.toBe("");
  });

  it("legt open risico's en blokkades apart, niet als taak", () => {
    const ind = deelIn([], [
      { id: "r1", project: "jarvis", soort: "risico", titel: "Een risico", urgentie: "hoog" },
      { id: "b1", project: "jarvis", soort: "blokkade", titel: "Een blokkade", urgentie: "midden" },
      { id: "a1", project: "jarvis", soort: "actie", titel: "Een actie", urgentie: "laag" },
    ] as never);
    expect(ind.risicos.map((r) => r.id)).toEqual(["r1", "b1"]);
  });
});

describe("de pagina kent elk vak", () => {
  const bron = readFileSync(path.join(process.cwd(), "jarvis/src/overzicht.ts"), "utf8");
  const html = readFileSync(path.join(process.cwd(), "jarvis/interface/jarvis.html"), "utf8");

  /** De vakken zoals het type ze noemt; de pagina moet ze allemaal kennen. */
  function vakkenUitBron(): readonly string[] {
    const m = /export type StandVak =\s*([^;]+);/.exec(bron);
    if (!m) throw new Error("StandVak is niet gevonden in overzicht.ts");
    return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  }

  it("noemt elk vak in VAKKEN, met een naam en een lege-tekst", () => {
    const lijst = /const VAKKEN = \[([\s\S]*?)\n\];/.exec(html)?.[1] ?? "";
    expect(lijst).not.toBe("");
    for (const v of vakkenUitBron()) {
      expect(lijst, `VAKKEN kent "${v}" niet`).toContain(`sleutel: "${v}"`);
    }
    // De risico's zijn geen taakvak en staan er los bij; zonder deze regel
    // zouden ze stil uit het paneel vallen.
    expect(lijst).toContain('sleutel: "risico"');
    const regels = [...lijst.matchAll(/sleutel: "([a-z_]+)"/g)].map((x) => x[1]);
    for (const r of regels) {
      expect(lijst, `${r} heeft geen lege-tekst`).toMatch(new RegExp(`sleutel: "${r}"[^}]*leeg:`));
    }
  });

  it("geeft elk vak een eigen streepkleur in de opmaak", () => {
    for (const v of [...vakkenUitBron(), "risico"]) {
      expect(html, `geen eigen opmaak voor vak ${v}`).toContain(`.vak.v-${v}>summary`);
    }
  });
});

describe("standHtml, uitgevoerd", () => {
  const html = readFileSync(path.join(process.cwd(), "jarvis/interface/jarvis.html"), "utf8");

  /** De echte functies uit de pagina, met de twee hulpfuncties erbij gegeven. */
  function standUitPagina(): (o: unknown) => string {
    const stukken = [
      /const VAKKEN = \[[\s\S]*?\n\];/.exec(html)?.[0],
      /function vakRij\(t\) \{[\s\S]*?\n\}/.exec(html)?.[0],
      /function risicoRij\(r\) \{[\s\S]*?\n\}/.exec(html)?.[0],
      /function standHtml\(o\) \{[\s\S]*?\n\}/.exec(html)?.[0],
    ];
    for (const [i, s] of stukken.entries()) if (!s) throw new Error(`stuk ${i} niet gevonden in jarvis.html`);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function(
      "esc",
      "relatief",
      `${stukken.join("\n")}\nreturn standHtml;`,
    )((x: unknown) => String(x), () => "nu") as (o: unknown) => string;
  }

  const ind = (extra: Record<string, unknown> = {}) => ({
    gegenereerd_op: NU.toISOString(),
    indeling: { actief: [], backlog: [], bij_jou: [], wacht: [], geparkeerd: [], afgerond: [], risicos: [], nulstand: true, ...extra },
  });

  it("zegt met zoveel woorden dat er geen actief werk is", () => {
    const s = standUitPagina()(ind());
    expect(s).toContain("Geen actief werk");
    expect(s).toContain("leegstand");
  });

  it("meldt actief werk in plaats van een nulstand zodra er werk loopt", () => {
    const s = standUitPagina()(
      ind({ actief: [{ id: "T-1", titel: "Iets", reden: "Jarvis aan zet; er is aan gewerkt", stil: false }], nulstand: false }),
    );
    expect(s).toContain("1 taak actief");
    expect(s).not.toContain("Geen actief werk");
    expect(s).toContain("werkstand");
  });

  it("toont elk vak, ook leeg, met een telling", () => {
    const s = standUitPagina()(ind({ wacht: [{ id: "T-w", titel: "Wachtend", reden: "wacht op een pull request", stil: false }] }));
    for (const v of ["actief", "bij_jou", "wacht", "backlog", "geparkeerd", "risico", "afgerond"]) {
      expect(s, `vak ${v} staat niet in de uitvoer`).toContain(`v-${v}`);
    }
    // Een leeg vak verdwijnt niet: anders is niet te zien of er niets is of
    // dat er niets gemeten is.
    expect(s).toContain("Geen taak in uitvoering.");
    expect(s).toContain("wacht op een pull request");
  });

  it("laat het paneel weg bij een document zonder indeling", () => {
    expect(standUitPagina()({ gegenereerd_op: NU.toISOString() })).toBe("");
  });

  it("markeert een stille taak apart binnen zijn vak", () => {
    const s = standUitPagina()(ind({ backlog: [{ id: "T-1", titel: "Iets", reden: "klaarliggend", stil: true }], nulstand: true }));
    expect(s).toContain("stil");
  });
});

describe("de regie publiceert beide documenten uit dezelfde run", () => {
  const bron = readFileSync(path.join(process.cwd(), "jarvis/src/opdrachten.ts"), "utf8");

  it("schrijft overzicht/huidig naast regie/huidig", () => {
    const blok = /async function opdrachtRegie\([\s\S]*?\n\}/.exec(bron)?.[0] ?? "";
    expect(blok).not.toBe("");
    expect(blok).toContain('DOCUMENT_SQL, ["regie/huidig"');
    expect(blok, "de regie publiceert het overzicht niet mee").toContain('DOCUMENT_SQL, ["overzicht/huidig"');
  });

  it("scant beide documenten voordat er iets weggaat", () => {
    const blok = /async function opdrachtRegie\([\s\S]*?\n\}/.exec(bron)?.[0] ?? "";
    expect(blok).toContain('scanTekst(json, allowlist, "regie.json")');
    expect(blok).toContain('scanTekst(overzichtJson, allowlist, "overzicht.json")');
  });
});
