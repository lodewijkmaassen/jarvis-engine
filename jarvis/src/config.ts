// Projectconfiguratie van de Jarvis-engine.
//
// Dit is de scheidslijn die de engine generiek houdt: alle projectspecifieke
// paden, drempels en patronen komen hier binnen als DATA. Nergens in
// jarvis/src staat een pad, tabelnaam of domeinwoord van een concreet project.
// De portabiliteitstest bewaakt dat.
//
// Hergebruikt bewust de front-matterparser: dezelfde strikte YAML-subset, dus
// geen tweede parser en geen externe afhankelijkheid.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseFrontMatter } from "./frontmatter";

export const CONFIG_BESTANDSNAAM = "jarvis.config.yml";

const positiefGeheel = z.number().int().positive();

export const configSchema = z.strictObject({
  project: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  knowledge_map: z.string().trim().min(1).default("knowledge"),
  taken_map: z.string().trim().min(1).default("tasks"),
  current_state: z.string().trim().min(1).default("docs/CURRENT_STATE.md"),
  project_kaart: z.string().trim().min(1).default("project/PROJECT.md"),
  budget: z.strictObject({
    S: positiefGeheel,
    M: positiefGeheel,
    L: positiefGeheel,
  }),
  limieten: z.strictObject({
    qa_rondes: positiefGeheel,
    subagenten: positiefGeheel,
    besluiten_per_taak: positiefGeheel,
    nieuwe_dec_per_taak: positiefGeheel,
    wallclock_minuten: positiefGeheel,
  }),
  context_nooit: z.array(z.string().min(1)).default([]),
  context_symbolen: z.array(z.string().min(1)).default([]),
  context_fragment_regels: positiefGeheel.default(400),
  sanitize_paden: z.array(z.string().min(1)).default([]),
  status_paden: z.array(z.string().min(1)).default([]),
  // Waar de migraties staan. Leeg = dit project kent ze niet; het feitenblok
  // laat het veld dan weg in plaats van een pad te veronderstellen.
  migratie_pad: z.string().trim().default(""),
  // Vanaf welke commit de rolcontrole bindt. Leeg = alle commits.
  // Bedoeld voor het invoeren van de regel op een bestaande historie: die
  // herschrijven zou een force-push vragen, en dat is geen keuze die een
  // agent zelfstandig hoort te maken.
  // Uitsluitend een volledige commit-hash, nooit een branch of tag. Een ref is
  // een bewegend doel: `git branch -f startpunt HEAD` verschuift dan de
  // vrijstelling zonder dat er ook maar een bestand wijzigt, en de poort die de
  // verschuiving moet zien vergelijkt twee identieke strings.
  rol_controle_vanaf: z
    .string()
    .trim()
    .default("")
    .refine((v) => v === "" || /^[0-9a-f]{40}$/.test(v), {
      message: "moet een volledige commit-hash van 40 hexadecimale tekens zijn, geen branch of tag",
    }),
  // Waar de tests van dit project staan. Zit in de configuratie en niet in de
  // engine, omdat de rolcontrole erop steunt en niet elk project "tests" heet.
  test_pad: z.string().trim().default("tests"),
  branch_voorvoegsel: z.string().trim().min(1).default("jarvis/"),
  // Providerafgeleiden van de rolcontracten. De engine kent geen werkomgeving
  // bij naam; welke map, welk voorvoegsel en welke gereedschapsnamen bij
  // "lezen", "schrijven" en "uitvoeren" horen, zegt de configuratie.
  rollen_map: z.string().trim().default("jarvis/roles"),
  /**
   * De repository (eigenaar/naam op GitHub) die de engine levert. Leeg in de
   * engine-repository zelf; verplicht bij een consumer, want de poort bindt
   * de gepinde engine-SHA aan precies deze repository.
   */
  engine_repository: z.string().trim().default(""),
  /**
   * Waar de attestatieworkflow het akkoord van de eigenaar leest (DEC-0043):
   * de REST-URL van de eigen database van Jarvis en de publieke
   * (publishable) sleutel. Beide zijn publieke identifiers: ze staan in elke
   * browser die de interface opent. Leeg = geen attestatie in deze repository.
   */
  attestatie: z
    .strictObject({
      url: z.string().trim().default(""),
      sleutel: z.string().trim().default(""),
      /** De login van de bot die PR's opent; alleen diens werk wordt geattesteerd. */
      bot: z.string().trim().default(""),
      /**
       * Andere logins waaronder Jarvis pull requests opent: de identiteit die
       * het platform van de cloud-uitvoerder aan zijn verzoeken hangt (gemeten
       * 2026-09-14: een PR uit de cloud staat op naam van `claude[bot]`, terwijl
       * `/user` de bot noemt). Hun werk wordt ook geattesteerd.
       */
      uitvoerders: z.array(z.string().trim().min(1)).default([]),
      /**
       * Paden of mapvoorvoegsels die in dit project een harde uitzondering
       * zijn (deployment, productie, secrets), bovenop de vaste lijst van de
       * engine. Bijvoorbeeld het deploymentbestand van de hostingpartij.
       */
      extra_paden: z.array(z.string().trim().min(1)).default([]),
    })
    .default({ url: "", sleutel: "", bot: "", uitvoerders: [], extra_paden: [] }),
  // Jarvis als eigen project in het overzicht: de kern op de kaart. Wat in
  // deze repository bij Jarvis hoort (paden voor de beweging) en welke tag op
  // een record "dit gaat over Jarvis" betekent, zegt de configuratie; leeg =
  // geen apart project.
  overzicht_kern_id: z.string().trim().default(""),
  overzicht_kern_naam: z.string().trim().default(""),
  overzicht_kern_paden: z.array(z.string().min(1)).default([]),
  overzicht_kern_tag: z.string().trim().default(""),
  rol_afgeleiden_map: z.string().trim().default(""),
  rol_afgeleiden_voorvoegsel: z.string().trim().default(""),
  rol_overzicht: z.string().trim().default(""),
  // Leveranciersneutrale afgeleide: één machineleesbaar bestand met alle
  // contracten, zonder gereedschapsnamen, zodat een ander gereedschap de
  // rollen kan overnemen zonder handwerk. Leeg = niet genereren.
  rol_manifest: z.string().trim().default(""),
  rol_gereedschap: z
    .strictObject({
      lezen: z.string().trim().default(""),
      schrijven: z.string().trim().default(""),
      rapporteren: z.string().trim().default(""),
      uitvoeren: z.string().trim().default(""),
    })
    .default({ lezen: "", schrijven: "", rapporteren: "", uitvoeren: "" }),
});

export type JarvisConfig = z.infer<typeof configSchema>;
export type TaakKlasse = "S" | "M" | "L";

export type ConfigResultaat =
  | { readonly ok: true; readonly config: JarvisConfig }
  | { readonly ok: false; readonly fouten: readonly string[] };

/**
 * Leest en valideert de configuratie.
 *
 * Faalt hard en met een volledige lijst bevindingen: een half begrepen
 * configuratie is gevaarlijker dan geen configuratie, want dan draait de
 * engine met stille standaardwaarden op iemands echte project.
 */
/**
 * Leest alleen `rol_controle_vanaf` uit een ruwe configuratietekst.
 *
 * Bewust dezelfde parser als de rest, en niet een regex: een regex leest
 * `'AAAA'` en `AAAA  # notitie` anders dan de parser, en dan meldt de poort een
 * verschuiving die er niet is. `null` betekent "niet te lezen" en is iets
 * anders dan `""` ("leeg"); alleen zo kan de aanroeper stil blijven wanneer er
 * niets is om mee te vergelijken.
 */
export function leesStartpuntUitConfig(ruw: string): string | null {
  if (ruw.trim().length === 0) return null;
  const omhuld = `---\n${ruw.replace(/\r\n/g, "\n").replace(/^\n+/, "")}\n---\n`;
  const geparsed = parseFrontMatter(omhuld);
  if (!geparsed.ok) return null;
  const waarde = geparsed.data["rol_controle_vanaf"];
  if (waarde === undefined) return "";
  return typeof waarde === "string" ? waarde.trim() : null;
}

export async function laadConfig(wortel: string): Promise<ConfigResultaat> {
  const pad = path.join(wortel, CONFIG_BESTANDSNAAM);
  let ruw: string;
  try {
    ruw = await readFile(pad, "utf8");
  } catch {
    return { ok: false, fouten: [`${CONFIG_BESTANDSNAAM} niet gevonden in ${wortel}`] };
  }
  return parseConfigTekst(ruw);
}

/** De configuratie uit tekst, voor een bestand dat niet op schijf staat (van een andere repository via de API). */
export function parseConfigTekst(ruw: string): ConfigResultaat {
  // De configuratie is een kaal YAML-document; de parser verwacht een
  // front-matterblok. Vandaar de omhulling — één parser, één subset.
  const geparsed = parseFrontMatter(`---\n${ruw.replace(/\r\n/g, "\n").replace(/^\n+/, "")}\n---\n`);
  if (!geparsed.ok) {
    return {
      ok: false,
      fouten: geparsed.fouten.map((f) => `${CONFIG_BESTANDSNAAM}:${f.regel - 1}: ${f.boodschap}`),
    };
  }

  const uitkomst = configSchema.safeParse(geparsed.data);
  if (!uitkomst.success) {
    return {
      ok: false,
      fouten: uitkomst.error.issues.map(
        (i) => `${CONFIG_BESTANDSNAAM}: ${i.path.join(".") || "(root)"}: ${i.message}`,
      ),
    };
  }
  return { ok: true, config: uitkomst.data };
}

/**
 * Zoekt de projectwortel: de dichtstbijzijnde map (vanaf `start` omhoog) met
 * een jarvis.config.yml. Zo werkt de CLI vanuit elke submap.
 */
export async function vindWortel(start: string): Promise<string | null> {
  const { access } = await import("node:fs/promises");
  let huidig = path.resolve(start);
  for (;;) {
    try {
      await access(path.join(huidig, CONFIG_BESTANDSNAAM));
      return huidig;
    } catch {
      const ouder = path.dirname(huidig);
      if (ouder === huidig) return null;
      huidig = ouder;
    }
  }
}
