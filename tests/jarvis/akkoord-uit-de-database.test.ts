/**
 * Eén waarheid over "wie is aan zet", en de database hoort erbij.
 *
 * Het defect dat deze tests vastleggen, meldde de eigenaar op 2026-10-02. Eén
 * taak toonde tegelijk:
 *
 *   - status **WACHT OP JOU**;
 *   - "Wie en waar": *de eigenaar is aan zet: Eigenaar: één herbevestiging van
 *     het akkoord op deze taak*;
 *   - "Bij jou uit deze taak": **Niets — Jarvis is aan zet**;
 *   - het centrale "Voor jou": **niets voor jou**.
 *
 * Hij kon de gevraagde herbevestiging dus nergens geven. De oorzaak was één
 * waarheid die op twee plaatsen werd berekend: `leesTaken` leidde
 * `akkoord_nodig` uitsluitend uit de tekst van het dossier af, terwijl de
 * akkoordkaart in de interface óók in `jarvis.autorisaties` keek en daardoor
 * verdween zodra het akkoord er lag. De vraag bleef staan, het antwoord was al
 * gegeven, en de knop was weg.
 *
 * De reparatie: `leesTaken` krijgt de gemeten akkoordstand mee en past dezelfde
 * toets toe. De interface leest wat de bouw zegt, corrigeert alleen nog het
 * venster tussen een vers akkoord en de volgende bouw, en mag daarbij alleen
 * afzwakken — nooit een vraag toevoegen die de bouw niet stelde.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scopeHash } from "../../jarvis/src/attestatie";
import { bouwOverzicht, leesTaken, type Akkoordstand, type AandachtItem, type ProjectInvoer, type TaakDossier } from "../../jarvis/src/overzicht";
import { bepaalRegie } from "../../jarvis/src/regie";

const NU = new Date("2026-10-02T16:00:00Z");
const SCOPE = "---\nid: T-1\n---\n\nde opdracht zoals de eigenaar haar goedkeurde\n";

/**
 * Een actief dossier waarvan de eigenaarslijst om het akkoord vraagt — precies
 * de vorm die `isAkkoordVraag` herkent, en dus de vorm die de taak op "wacht op
 * jou" zette.
 */
function dossier(vraagtAkkoord: boolean): TaakDossier {
  const eigenaar = vraagtAkkoord
    ? "\n## Wat de eigenaar nog moet doen\n\n- Stap 4: **Eén keer je akkoord op deze taak herbevestigen in de Jarvis-app.**\n"
    : "";
  return {
    id: "T-1",
    opdracht: { status: "actief", titel: "Technische uitvoering", project: "jarvis", klasse: "L" },
    resultaat: `# Resultaat\n\n## Voortgang\n\n- [x] Begonnen\n- [ ] Bouwen\n${eigenaar}`,
    tekst: SCOPE,
  } as unknown as TaakDossier;
}

function project(taken: readonly TaakDossier[]): ProjectInvoer {
  return {
    id: "jarvis",
    naam: "Jarvis",
    aangesloten: true,
    hoofdbranch: { naam: "main", commit: "abc1234", datum: "2026-10-02" },
    statusDocument: "# CURRENT_STATE\n\n## Waar staan we\n\nIets.\n",
    records: [],
    taken,
    gitLog: [],
  };
}

const stand = (hash: string | null): Akkoordstand => new Map(hash === null ? [] : [["T-1", hash]]);

describe("de akkoordstand telt mee in wie aan zet is", () => {
  it("vraagt het akkoord zolang de stand niet is gemeten", () => {
    const [t] = leesTaken([dossier(true)], "jarvis", [], [], NU, null);
    expect(t.akkoord_gemeten).toBe(false);
    expect(t.akkoord_nodig).toBe(true);
    expect(t.aan_zet).toBe("eigenaar");
  });

  it("vraagt het akkoord wanneer de stand is gemeten en er geen akkoord ligt", () => {
    const [t] = leesTaken([dossier(true)], "jarvis", [], [], NU, stand(null));
    expect(t.akkoord_gemeten).toBe(true);
    expect(t.akkoord_nodig).toBe(true);
    expect(t.aan_zet).toBe("eigenaar");
  });

  it("vraagt het akkoord niet meer zodra het op precies deze scope ligt", () => {
    const [t] = leesTaken([dossier(true)], "jarvis", [], [], NU, stand(scopeHash(SCOPE)));
    expect(t.scope_hash).toBe(scopeHash(SCOPE));
    expect(t.akkoord_nodig).toBe(false);
    expect(t.aan_zet).toBe("jarvis");
  });

  it("vraagt het akkoord wél opnieuw wanneer de scope sinds het akkoord veranderde", () => {
    const [t] = leesTaken([dossier(true)], "jarvis", [], [], NU, stand(scopeHash("een oudere opdracht\n")));
    expect(t.akkoord_nodig).toBe(true);
    expect(t.aan_zet).toBe("eigenaar");
  });

  it("laat een geldig akkoord een echt punt uit de eigenaarslijst niet wegpoetsen", () => {
    const punt = {
      id: "jarvis:T-1:token",
      project: "jarvis",
      soort: "actie",
      titel: "Maak een Vercel-token aan",
      toelichting: "Alleen jij kunt dit.",
      bron: "tasks/T-1/resultaat.md",
      urgentie: "hoog",
    } as unknown as AandachtItem;
    const [t] = leesTaken([dossier(true)], "jarvis", [], [punt], NU, stand(scopeHash(SCOPE)));
    expect(t.akkoord_nodig).toBe(false);
    expect(t.aan_zet).toBe("eigenaar");
    expect(t.wacht_op).toBe("Maak een Vercel-token aan");
  });

  it("draagt de stand door de hele bouw heen, niet alleen door leesTaken", () => {
    const o = bouwOverzicht([project([dossier(true)])], NU, "jarvis", stand(scopeHash(SCOPE)));
    const t = o.projecten[0]!.taken[0]!;
    expect(t.akkoord_nodig).toBe(false);
    expect(t.aan_zet).toBe("jarvis");
  });

  it("haalt de taak uit WAITING_FOR_USER zodra het akkoord er ligt", () => {
    const metAkkoord = bouwOverzicht([project([dossier(true)])], NU, "jarvis", stand(scopeHash(SCOPE)));
    const zonder = bouwOverzicht([project([dossier(true)])], NU, "jarvis", stand(null));
    const regie = (o: ReturnType<typeof bouwOverzicht>) =>
      bepaalRegie(o, [], NU).taken.find((r) => r.id === "T-1");
    expect(regie(zonder)?.toestand).toBe("WAITING_FOR_USER");
    expect(regie(metAkkoord)?.toestand).not.toBe("WAITING_FOR_USER");
  });
});

// ---------------------------------------------------------------------------
// De interface: dezelfde waarheid, één keer berekend
// ---------------------------------------------------------------------------

const html = readFileSync(path.join(process.cwd(), "jarvis/interface/jarvis.html"), "utf8");

/** De echte functie uit de pagina, uitgevoerd — niet haar brontekst gelezen. */
function uitPagina<T>(naam: string): T {
  const m = new RegExp(`function ${naam}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n\\}`).exec(html);
  if (!m) throw new Error(`${naam} is niet gevonden in jarvis.html`);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`return function ${naam}(${m[1]}) {${m[2]}\n};`)() as T;
}

describe("zetVan — de interface spreekt de bouw niet tegen", () => {
  const zetVan = uitPagina<(t: Record<string, unknown>) => string>("zetVan");

  it("laat alles wat niet op de eigenaar staat ongemoeid", () => {
    for (const z of ["jarvis", "wacht", "niemand"]) {
      expect(zetVan({ aan_zet: z, akkoord_nodig: true, akkoord_open: false, eigen_punten: false })).toBe(z);
    }
  });

  it("zwakt af zodra het gevraagde akkoord er blijkt te liggen", () => {
    expect(zetVan({ aan_zet: "eigenaar", akkoord_nodig: true, akkoord_open: false, eigen_punten: false })).toBe("jarvis");
  });

  it("houdt de eigenaar aan zet zolang de kaart het akkoord nog vraagt", () => {
    expect(zetVan({ aan_zet: "eigenaar", akkoord_nodig: true, akkoord_open: true, eigen_punten: false })).toBe("eigenaar");
  });

  it("houdt de eigenaar aan zet bij een echt punt uit zijn lijst", () => {
    expect(zetVan({ aan_zet: "eigenaar", akkoord_nodig: true, akkoord_open: false, eigen_punten: true })).toBe("eigenaar");
  });

  it("zwakt nooit af wanneer de eigenaar om een andere reden dan het akkoord aan zet is", () => {
    expect(zetVan({ aan_zet: "eigenaar", akkoord_nodig: false, akkoord_open: false, eigen_punten: false })).toBe("eigenaar");
  });

  it("scherpt nooit aan: een taak die niet op de eigenaar staat, komt er niet op", () => {
    expect(zetVan({ aan_zet: "jarvis", akkoord_nodig: true, akkoord_open: true, eigen_punten: true })).toBe("jarvis");
  });
});

describe("akkoordNodig — de kaart en de status stellen dezelfde vraag", () => {
  it("volgt akkoord_nodig uit de bouw en laat het akkoord in de database het vetoën", () => {
    // De functie leest `staat` en `akkoordVan`; die worden hier gegeven, zodat
    // het gedrag wordt uitgevoerd en niet uit de brontekst afgeleid.
    const m = /function akkoordNodig\(([^)]*)\) \{([\s\S]*?)\n\}/.exec(html);
    expect(m, "akkoordNodig is niet gevonden in jarvis.html").not.toBeNull();
    const sluit = /function sluitDossier\(([^)]*)\) \{([\s\S]*?)\n\}/.exec(html)!;
    const maak = (laatste: { scope_hash: string } | null) =>
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function(
        `function sluitDossier(${sluit[1]}) {${sluit[2]}\n}\n` +
          `const akkoordVan = () => (${JSON.stringify(laatste)});\n` +
          `return function akkoordNodig(${m![1]}) {${m![2]}\n};`,
      )() as (t: Record<string, unknown>) => boolean;
    const taak = { status: "actief", scope: SCOPE, scope_hash: scopeHash(SCOPE), akkoord_nodig: true, stappen: [] };

    expect(maak(null)(taak), "zonder akkoord hoort de kaart er te staan").toBe(true);
    expect(maak({ scope_hash: scopeHash(SCOPE) })(taak), "met een geldig akkoord hoort zij weg te zijn").toBe(false);
    expect(maak({ scope_hash: "een andere scope" })(taak), "een akkoord op een oudere scope telt niet").toBe(true);
    expect(maak(null)({ ...taak, akkoord_nodig: false }), "de bouw vraagt niets, dus de kaart ook niet").toBe(false);
    expect(maak(null)({ ...taak, status: "afgerond" }), "een gesloten dossier vraagt niets").toBe(false);
  });
});
