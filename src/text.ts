// Tokenisatie voor de deterministische retrieval.
//
// Bewust simpel en volledig lokaal: geen stemmer, geen taalmodel, geen
// externe woordenlijst. Wat hier telt is dat dezelfde tekst ALTIJD dezelfde
// tokens oplevert, ook over Node-versies heen.

// Nederlandse + Engelse functiewoorden. Kort gehouden: een te agressieve
// stoplijst verwijdert juist domeinwoorden ("status", "code").
const STOPWOORDEN = new Set([
  "aan", "af", "al", "als", "and", "bij", "dan", "dat", "de", "der", "die",
  "dit", "door", "een", "en", "er", "for", "geen", "het", "hij", "hoe", "iets",
  "in", "is", "je", "kan", "maar", "me", "meer", "met", "mij", "moet", "na",
  "naar", "niet", "nog", "nu", "of", "om", "ook", "op", "over", "te", "the",
  "to", "tot", "uit", "van", "veel", "voor", "waar", "wat", "we", "wel",
  "werd", "wij", "worden", "wordt", "zal", "ze", "zijn", "zo",
]);

/** Diakrieten weg, alles kleine letters. */
function normaliseer(tekst: string): string {
  return tekst.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Splitst tekst in tokens: kleine letters, geen diakrieten, geen leestekens,
 * geen stopwoorden, minimaal 2 tekens. Volgorde blijft die van de tekst.
 */
export function tokenize(tekst: string): readonly string[] {
  const ruw = normaliseer(tekst).split(/[^a-z0-9]+/);
  const tokens: string[] = [];
  for (const token of ruw) {
    if (token.length < 2) continue;
    if (STOPWOORDEN.has(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

/** Unieke tokens, in volgorde van eerste voorkomen (dus deterministisch). */
export function uniqueTokens(tekst: string): readonly string[] {
  const gezien = new Set<string>();
  const uniek: string[] = [];
  for (const token of tokenize(tekst)) {
    if (gezien.has(token)) continue;
    gezien.add(token);
    uniek.push(token);
  }
  return uniek;
}

/** Alleen voor tests/inspectie: is dit woord een stopwoord? */
export function isStopwoord(woord: string): boolean {
  return STOPWOORDEN.has(normaliseer(woord));
}
