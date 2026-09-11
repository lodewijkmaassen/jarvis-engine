// De engine als afhankelijkheid.
//
// Een consumer neemt de engine op als git-afhankelijkheid op een vastgepinde
// commit (`github:<eigenaar>/jarvis-engine#<sha>`). Daarmee komt de code die
// de poort draait van buiten de repository (RSK-0020 wordt breder), en dus
// controleert de poort drie dingen voordat hij zichzelf vertrouwt:
//
//   1. `package-lock.json` pint de engine op een commit-SHA;
//   2. wat in `node_modules` staat is precies die SHA (de verborgen lockfile
//      die npm bij het installeren schrijft, noemt hem);
//   3. die SHA is bereikbaar vanaf de hoofdbranch van de engine-repository,
//      en dus door een mens beoordeeld en samengevoegd.
//
// In de engine-repository zelf wijst `node_modules/jarvis-engine` naar de
// repository (een `file:.`-afhankelijkheid), zodat de canonieke workflow daar
// dezelfde opdracht draait als bij elke consumer. Daar is er niets te pinnen.
//
// Alles hier is puur; de I/O (bestanden lezen, GitHub raadplegen) staat in
// opdrachten.ts, zodat elk geval met verzonnen invoer te toetsen is.

/** De naam van het enginepakket; bepaalt ook de padnaam in node_modules. */
export const ENGINE_PAKKET = "jarvis-engine";

export const ENGINE_MAP = `node_modules/${ENGINE_PAKKET}`;

export type EngineModus = "engine" | "consumer";

export type EngineStand =
  | { readonly modus: "engine" }
  | {
      readonly modus: "consumer";
      /** `eigenaar/repository` uit de resolved-URL in package-lock.json, of null. */
      readonly slug: string | null;
      /** De SHA waarop package-lock.json de engine pint, of null. */
      readonly shaLock: string | null;
      /** De SHA die npm bij het installeren vastlegde, of null als niet geïnstalleerd. */
      readonly shaGeinstalleerd: string | null;
    };

/** Bepaalt de modus uit de package.json van de repositorywortel. */
export function bepaalModus(pakketTekst: string | null): EngineModus {
  if (pakketTekst === null) return "consumer";
  try {
    const pakket = JSON.parse(pakketTekst) as { name?: unknown };
    return pakket.name === ENGINE_PAKKET ? "engine" : "consumer";
  } catch {
    return "consumer";
  }
}

const RESOLVED_GITHUB = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?#([0-9a-f]{40})$/;

/** Leest slug en SHA uit de `resolved`-waarde van een lockfile-item. */
export function ontleedResolved(lockTekst: string | null): { slug: string | null; sha: string | null } {
  if (lockTekst === null) return { slug: null, sha: null };
  let resolved: unknown;
  try {
    const lock = JSON.parse(lockTekst) as { packages?: Record<string, { resolved?: unknown }> };
    resolved = lock.packages?.[ENGINE_MAP]?.resolved;
  } catch {
    return { slug: null, sha: null };
  }
  if (typeof resolved !== "string") return { slug: null, sha: null };
  const m = RESOLVED_GITHUB.exec(resolved);
  if (!m) return { slug: null, sha: null };
  return { slug: `${m[1]}/${m[2]}`, sha: m[3] };
}

export function leesEngineStand(
  pakketTekst: string | null,
  lockTekst: string | null,
  verborgenLockTekst: string | null,
): EngineStand {
  if (bepaalModus(pakketTekst) === "engine") return { modus: "engine" };
  const lock = ontleedResolved(lockTekst);
  const geinstalleerd = ontleedResolved(verborgenLockTekst);
  return { modus: "consumer", slug: lock.slug, shaLock: lock.sha, shaGeinstalleerd: geinstalleerd.sha };
}

/**
 * De uitkomst van GitHub's vergelijking `main...<sha>`: "identical" of
 * "behind" betekent dat de SHA op of achter de kop van main ligt, en dus
 * via main is binnengekomen. "ahead" en "diverged" betekenen een commit die
 * main nooit heeft gezien. null: de vergelijking was niet te maken.
 */
export type HoofdbranchVergelijking = "identical" | "behind" | "ahead" | "diverged" | null;

/** Alle redenen waarom de engine niet te vertrouwen is. Leeg betekent in orde. */
export function beoordeelEngine(stand: EngineStand, vergelijking: HoofdbranchVergelijking): readonly string[] {
  if (stand.modus === "engine") return [];
  const redenen: string[] = [];
  if (stand.shaLock === null || stand.slug === null) {
    redenen.push(
      `package-lock.json pint ${ENGINE_PAKKET} niet op een commit van GitHub; de engine hoort een ` +
        `git-afhankelijkheid op een vaste SHA te zijn`,
    );
    return redenen;
  }
  if (stand.shaGeinstalleerd === null) {
    redenen.push(`${ENGINE_MAP} is niet geïnstalleerd of niet door npm vastgelegd; draai npm ci --ignore-scripts`);
  } else if (stand.shaGeinstalleerd !== stand.shaLock) {
    redenen.push(
      `${ENGINE_MAP} staat op ${stand.shaGeinstalleerd.slice(0, 7)} terwijl package-lock.json ` +
        `${stand.shaLock.slice(0, 7)} noemt; de geïnstalleerde engine is niet de vastgepinde`,
    );
  }
  if (vergelijking === null) {
    redenen.push(`kon niet vaststellen of ${stand.shaLock.slice(0, 7)} op de hoofdbranch van ${stand.slug} staat`);
  } else if (vergelijking !== "identical" && vergelijking !== "behind") {
    redenen.push(
      `${stand.shaLock.slice(0, 7)} staat niet op de hoofdbranch van ${stand.slug} (${vergelijking}); ` +
        `alleen een door een mens samengevoegde engine-commit mag de poort draaien`,
    );
  }
  return redenen;
}
