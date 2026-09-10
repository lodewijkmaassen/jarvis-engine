// Bestandsclassificatie voor het contextpakket.
//
// Het probleem dat dit oplost: één gegenereerd typebestand kan in zijn eentje
// het hele contextbudget opeten. In deze repo is `lib/db/types.ts` 1.306
// regels Supabase-output — ruim meer dan het volledige S-budget. Zonder
// classificatie is "selecteer de geraakte bestanden" dus een budgetlek.
//
// Vier klassen, van goedkoop naar duur:
//   nooit      — komt er niet in; alleen naam + reden op de weglatingslijst
//   symbolen   — alleen het declaratieskelet (welke types/tabellen/velden)
//   fragment   — alleen de relevante stukken plus omliggende context
//   volledig   — het hele bestand
//
// De klasse volgt uit configuratie (globs) en omvang, nooit uit een model.

export const CONTEXT_KLASSEN = ["nooit", "symbolen", "fragment", "volledig"] as const;
export type ContextKlasse = (typeof CONTEXT_KLASSEN)[number];

/**
 * Vertaalt een glob naar een reguliere expressie.
 *
 * Ondersteunt `**` (nul of meer padsegmenten), `*` (binnen één segment),
 * `?` (één teken). Bewust geen brace-expansie of extglob: minder verrassingen,
 * en alles wat we nodig hebben.
 */
export function globNaarRegex(glob: string): RegExp {
  let patroon = "";
  let i = 0;
  while (i < glob.length) {
    const teken = glob[i];
    if (teken === "*") {
      const dubbel = glob[i + 1] === "*";
      if (dubbel) {
        const gevolgdDoorSlash = glob[i + 2] === "/";
        // `**/` mag ook nul segmenten zijn, zodat "**/*.ts" ook "a.ts" matcht.
        patroon += gevolgdDoorSlash ? "(?:.*/)?" : ".*";
        i += gevolgdDoorSlash ? 3 : 2;
        continue;
      }
      patroon += "[^/]*";
      i += 1;
      continue;
    }
    if (teken === "?") {
      patroon += "[^/]";
      i += 1;
      continue;
    }
    patroon += teken.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }
  return new RegExp(`^${patroon}$`);
}

/** Padvergelijking is altijd met forward slashes, ook op Windows. */
export function normaliseerPad(pad: string): string {
  return pad.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function matchtGlob(pad: string, globs: readonly string[]): boolean {
  const genormaliseerd = normaliseerPad(pad);
  return globs.some((g) => globNaarRegex(normaliseerPad(g)).test(genormaliseerd));
}

/**
 * Ruwe tokenschatting: ongeveer vier tekens per token.
 *
 * Bewust een schatting en geen tokenizer: de tokenizer verschilt per model en
 * per versie, en het budget is een stuurmiddel, geen boekhouding. De schatting
 * is deterministisch en aan de veilige kant (eerder te hoog dan te laag).
 */
export function schatTokens(tekst: string): number {
  if (tekst.length === 0) return 0;
  return Math.ceil(tekst.length / 4);
}

export type ClassificatieConfig = {
  readonly nooit: readonly string[];
  readonly symbolen: readonly string[];
  readonly fragmentRegels: number;
};

export type Classificatie = {
  readonly klasse: ContextKlasse;
  /** Waarom deze klasse — komt letterlijk op de weglatingslijst terecht. */
  readonly reden: string;
};

/** Herkent bestanden die zichzelf als gegenereerd aankondigen. */
const GEGENEREERD_MARKERING =
  /(^|\n)\s*(\/\/|#|\*)\s*.*(gegenereerd|generated|do not edit|niet handmatig bewerken|build-output)/i;

/**
 * Bepaalt de klasse van één bestand.
 *
 * Volgorde is betekenisvol: expliciete configuratie wint van heuristiek, en
 * heuristiek wint van "gewoon meenemen". Een bestand waarover niets bekend is
 * en dat groot is, valt terug op `fragment` — nooit stilzwijgend op volledig.
 */
export function classificeer(
  pad: string,
  inhoud: string,
  config: ClassificatieConfig,
): Classificatie {
  const genormaliseerd = normaliseerPad(pad);

  if (matchtGlob(genormaliseerd, config.nooit)) {
    return { klasse: "nooit", reden: "uitgesloten via context_nooit" };
  }
  if (matchtGlob(genormaliseerd, config.symbolen)) {
    return { klasse: "symbolen", reden: "gegenereerd bestand via context_symbolen" };
  }

  const alleRegels = inhoud.split("\n");
  const regels = alleRegels.length;
  // Alleen de eerste regels bekijken: een "generated"-banner hoort bovenaan te
  // staan. Regels tellen en niet tekens, anders bepaalt de regellengte
  // stilzwijgend hoe ver we kijken.
  const kop = alleRegels.slice(0, 10).join("\n");
  if (GEGENEREERD_MARKERING.test(kop)) {
    return { klasse: "symbolen", reden: "bestand meldt zichzelf als gegenereerd" };
  }
  if (regels > config.fragmentRegels) {
    return {
      klasse: "fragment",
      reden: `${regels} regels, boven de drempel van ${config.fragmentRegels}`,
    };
  }
  return { klasse: "volledig", reden: `${regels} regels` };
}

const DECLARATIE =
  /^\s*(export\s+)?(default\s+)?(abstract\s+)?(async\s+)?(type|interface|enum|class|function|const|let|var)\s+[A-Za-z_$][\w$]*/;

/**
 * Symbolenskelet van een bestand: declaraties en ondiepe objectsleutels.
 *
 * Voor een gegenereerd Supabase-typebestand levert dit de tabel- en
 * kolomnamen zonder de omringende typeruis — genoeg om te weten wat er
 * bestaat, zonder duizend regels te betalen.
 */
export function symbolen(inhoud: string, maxRegels = 160): string {
  const regels = inhoud.replace(/\r\n/g, "\n").split("\n");
  const behouden: string[] = [];
  let overgeslagen = 0;

  for (const regel of regels) {
    if (behouden.length >= maxRegels) {
      overgeslagen += 1;
      continue;
    }
    const inspringing = /^ */.exec(regel)?.[0].length ?? 0;
    const kaal = regel.trim();
    if (kaal.length === 0) continue;

    // Alleen echte symbolen: wat geëxporteerd wordt, of wat op het hoogste
    // niveau staat. Een `const` binnen een functiebody is een implementatie-
    // detail en hoort niet in een skelet dat moet vertellen wát er bestaat.
    const isDeclaratie = DECLARATIE.test(regel) && (inspringing === 0 || /^\s*export\s/.test(regel));
    // Sleutels tot en met drie niveaus diep: bij gegenereerde schema's zit
    // daar precies de tabel- en kolomlaag.
    const isOndiepeSleutel = inspringing <= 8 && /^[A-Za-z_"'][\w$"'-]*\??\s*:/.test(kaal);
    if (!isDeclaratie && !isOndiepeSleutel) continue;

    behouden.push(regel.replace(/\s+$/, ""));
  }

  const kop = `// [jarvis] symbolenskelet — ${regels.length} regels teruggebracht tot ${behouden.length}`;
  const staart = overgeslagen > 0 ? `\n// [jarvis] ${overgeslagen} verdere regels weggelaten` : "";
  return `${kop}\n${behouden.join("\n")}${staart}`;
}

/**
 * Fragment: de regels rond elke treffer van een van de termen.
 *
 * Overlappende vensters worden samengevoegd, en tussen niet-aansluitende
 * blokken komt een expliciete markering — zodat niemand twee losse stukken
 * per ongeluk als aaneengesloten code leest.
 */
export function fragment(
  inhoud: string,
  termen: readonly string[],
  venster = 12,
  maxRegels = 200,
): string {
  const regels = inhoud.replace(/\r\n/g, "\n").split("\n");
  if (termen.length === 0) {
    return symbolen(inhoud, maxRegels);
  }
  const gezocht = termen.map((t) => t.toLowerCase()).filter((t) => t.length >= 2);
  const raak = new Set<number>();
  for (let i = 0; i < regels.length; i += 1) {
    const laag = regels[i].toLowerCase();
    if (!gezocht.some((t) => laag.includes(t))) continue;
    for (let j = Math.max(0, i - venster); j <= Math.min(regels.length - 1, i + venster); j += 1) {
      raak.add(j);
    }
  }
  if (raak.size === 0) return symbolen(inhoud, maxRegels);

  const gesorteerd = [...raak].sort((a, b) => a - b).slice(0, maxRegels);
  const uit: string[] = [`// [jarvis] fragment — ${gesorteerd.length} van ${regels.length} regels`];
  let vorige = -2;
  for (const nr of gesorteerd) {
    if (nr !== vorige + 1 && vorige !== -2) uit.push(`// [jarvis] ... regels ${vorige + 2}-${nr} weggelaten`);
    uit.push(`${String(nr + 1).padStart(5, " ")}| ${regels[nr]}`);
    vorige = nr;
  }
  return uit.join("\n");
}

/** Past de klasse toe en levert de tekst die daadwerkelijk in het pakket komt. */
export function renderVoorKlasse(
  klasse: ContextKlasse,
  inhoud: string,
  termen: readonly string[],
  fragmentRegels: number,
): string | null {
  switch (klasse) {
    case "nooit":
      return null;
    case "symbolen":
      return symbolen(inhoud);
    case "fragment":
      return fragment(inhoud, termen, 12, Math.max(60, Math.floor(fragmentRegels / 2)));
    case "volledig":
      return inhoud;
  }
}
