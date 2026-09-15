// Providerafgeleiden van de rolcontracten.
//
// De rolcontracten in de rollenmap zijn de bron: provider-neutraal, zonder
// leveranciers-, model- of toolnamen. Een werkomgeving wil die contracten in
// haar eigen vorm: een agentdefinitie met front-matter en gereedschapsnamen,
// of een instapdocument met een overzicht per rol. Die vormen zijn afgeleiden,
// en een afgeleide die met de hand wordt bijgehouden drift: bij de eerste QA
// van v1 miste de afgeleide van het QA-contract twee volledige secties.
//
// Deze module genereert de afgeleiden deterministisch uit de bron. Alles wat
// omgevingsspecifiek is - de doelmap, het voorvoegsel, welke gereedschapsnamen
// bij "lezen", "schrijven" en "uitvoeren" horen - komt uit de configuratie.
// De engine kent geen enkele werkomgeving bij naam.
//
// Puur: geen I/O. De aanroeper leest de contracten en schrijft of vergelijkt.
import { parseFrontMatter, type FrontMatterValue } from "./frontmatter";

/**
 * Neutrale vermogens die een rol kan hebben; de configuratie vertaalt ze.
 * "rapporteren" is schrijven zonder bewerken: een rol die alleen een rapport
 * oplevert (QA) hoort geen bestaande bestanden te kunnen wijzigen.
 */
export const VERMOGENS = ["lezen", "schrijven", "rapporteren", "uitvoeren"] as const;
export type Vermogen = (typeof VERMOGENS)[number];

export type Rolcontract = {
  /** Korte sleutel, gelijk aan de bestandsnaam zonder extensie. */
  readonly rol: string;
  readonly titel: string;
  readonly samenvatting: string;
  readonly vermogens: readonly Vermogen[];
  /** Krijgt deze rol een eigen agentdefinitie? De hoofdrol van een sessie meestal niet. */
  readonly agent: boolean;
  /** De volledige contracttekst zonder front-matter, LF-genormaliseerd. */
  readonly tekst: string;
};

export type AfgeleidenConfig = {
  /** Map voor agentdefinities; leeg = geen agentdefinities genereren. */
  readonly map: string;
  readonly voorvoegsel: string;
  /** Instapdocument met een gegenereerd blok; leeg = geen overzicht. */
  readonly overzicht: string;
  /** Leveranciersneutraal manifest; leeg = geen manifest. */
  readonly manifest: string;
  /** Vermogen -> door komma's gescheiden gereedschapsnamen van de omgeving. */
  readonly gereedschap: Readonly<Partial<Record<Vermogen, string>>>;
};

/** Vorm van het manifest; verhoog bij een wijziging die een lezer breekt. */
export const MANIFEST_VERSIE = 1;

export const ROLLEN_START = "<!-- jarvis:rollen:start -->";
export const ROLLEN_EIND = "<!-- jarvis:rollen:eind -->";

export type RolLeesResultaat = { readonly ok: true; readonly contract: Rolcontract } | { readonly ok: false; readonly fout: string };

const tekstVeld = (data: Readonly<Record<string, FrontMatterValue>>, sleutel: string): string | null => {
  const w = data[sleutel];
  return typeof w === "string" && w.trim().length > 0 ? w.trim() : null;
};

/** Leest één rolcontract: front-matter met rol, samenvatting, vermogens, agent; daaronder de tekst. */
export function leesRolcontract(bestandsnaam: string, inhoud: string): RolLeesResultaat {
  const genormaliseerd = inhoud.replace(/\r\n/g, "\n");
  const rol = bestandsnaam.replace(/\.md$/i, "");
  const fm = parseFrontMatter(genormaliseerd);
  if (!fm.ok) return { ok: false, fout: `${bestandsnaam}: ${fm.fouten.map((f) => f.boodschap).join("; ")}` };
  const samenvatting = tekstVeld(fm.data, "samenvatting");
  if (!samenvatting) return { ok: false, fout: `${bestandsnaam}: front-matter mist "samenvatting"` };
  const ruweVermogens = fm.data["vermogens"];
  if (!Array.isArray(ruweVermogens)) return { ok: false, fout: `${bestandsnaam}: front-matter mist de lijst "vermogens"` };
  const vermogens: Vermogen[] = [];
  for (const v of ruweVermogens) {
    if (typeof v !== "string" || !(VERMOGENS as readonly string[]).includes(v)) {
      return { ok: false, fout: `${bestandsnaam}: onbekend vermogen "${String(v)}"; toegestaan: ${VERMOGENS.join(", ")}` };
    }
    vermogens.push(v as Vermogen);
  }
  const agentVeld = fm.data["agent"];
  const agent = agentVeld === undefined ? true : agentVeld === true || agentVeld === "ja";
  const kop = /^#\s+(.+)$/m.exec(fm.body);
  const titel = kop ? kop[1].trim() : rol;
  return { ok: true, contract: { rol, titel, samenvatting, vermogens, agent, tekst: fm.body.replace(/^\n+/, "") } };
}

function gereedschapVoor(contract: Rolcontract, config: AfgeleidenConfig): string {
  const namen: string[] = [];
  for (const v of contract.vermogens) {
    const lijst = config.gereedschap[v];
    if (!lijst) continue;
    for (const naam of lijst.split(",").map((n) => n.trim()).filter((n) => n.length > 0)) {
      if (!namen.includes(naam)) namen.push(naam);
    }
  }
  return namen.join(", ");
}

/** Eén agentdefinitie: front-matter van de omgeving, daaronder het contract volledig. */
export function genereerAgentdefinitie(contract: Rolcontract, config: AfgeleidenConfig, bronpad: string): string {
  const gereedschap = gereedschapVoor(contract, config);
  return [
    "---",
    `name: ${config.voorvoegsel}${contract.rol}`,
    `description: ${contract.samenvatting.replace(/\s+/g, " ")}`,
    ...(gereedschap ? [`tools: ${gereedschap}`] : []),
    "---",
    `<!-- Gegenereerd door \`jarvis rollen\` uit ${bronpad}. Niet met de hand wijzigen: de bron wint, en de poort vergelijkt. -->`,
    "",
    contract.tekst.trimEnd(),
    "",
  ].join("\n");
}

/** Het overzichtsblok voor het instapdocument: per rol één regel, plus de leesvolgorde. */
export function genereerOverzichtsblok(contracten: readonly Rolcontract[], rollenMap: string): string {
  const regels = [
    ROLLEN_START,
    "",
    "<!-- Dit blok wordt gegenereerd door `jarvis rollen`. Handmatige wijzigingen",
    "     worden door de poort gedetecteerd. Schrijf je toelichting buiten het blok. -->",
    "",
    "| Rol | Wat de rol doet | Contract |",
    "|---|---|---|",
    ...[...contracten]
      .sort((a, b) => a.rol.localeCompare(b.rol))
      .map((c) => `| ${c.titel.replace(/^Rolcontract\s+[—-]\s+/, "")} | ${c.samenvatting.replace(/\s+/g, " ").replace(/\|/g, "/")} | \`${rollenMap}/${c.rol}.md\` |`),
    "",
    "Het contract is de bron en is volledig; lees het voordat je als die rol begint.",
    "",
    ROLLEN_EIND,
  ];
  return regels.join("\n");
}

/**
 * Het leveranciersneutrale manifest: alle contracten in één machineleesbaar
 * bestand.
 *
 * De agentdefinities hierboven zijn de vorm van één werkomgeving, en juist de
 * twee stukken die per leverancier verschillen - de front-matter en de
 * gereedschapsnamen - zitten erin verweven. Wie naar een ander gereedschap wil
 * wisselen, moet de contracten dan opnieuw met de hand vertalen, en dat is
 * precies het handwerk waardoor de enige bestaande afgeleide ging driften.
 *
 * Het manifest draagt daarom alleen wat van de leverancier onafhankelijk is:
 * sleutel, titel, samenvatting, de neutrale vermogens, of de rol een eigen
 * agentdefinitie hoort te krijgen, het bronpad en de volledige contracttekst.
 * Bewust géén gereedschapsnamen - die horen bij de omgeving, niet bij het
 * contract. Een tweede gereedschap leest dit bestand, vertaalt `vermogens`
 * naar wat het zelf kent, en heeft verder niets van deze engine nodig.
 *
 * Deterministisch: vaste volgorde op rol, geen tijdstip, geen omgeving.
 */
export function genereerManifest(contracten: readonly Rolcontract[], rollenMap: string): string {
  const rollen = [...contracten]
    .sort((a, b) => a.rol.localeCompare(b.rol))
    .map((c) => ({
      rol: c.rol,
      titel: c.titel,
      samenvatting: c.samenvatting.replace(/\s+/g, " "),
      vermogens: [...c.vermogens],
      agent: c.agent,
      bron: `${rollenMap}/${c.rol}.md`,
      contract: c.tekst.trimEnd(),
    }));
  const manifest = {
    versie: MANIFEST_VERSIE,
    gegenereerd_door: "jarvis rollen",
    bron: rollenMap,
    toelichting:
      "Leveranciersneutrale afgeleide van de rolcontracten. De bron wint; wijzig dit bestand nooit met de hand. " +
      "Vermogens zijn neutraal (lezen, schrijven, rapporteren, uitvoeren); vertaal ze naar de gereedschapsnamen van je eigen omgeving.",
    rollen,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Vervangt het gegenereerde blok in een bestaand document, of voegt het onderaan toe. */
export function vervangOverzichtsblok(document: string, blok: string): string {
  const tekst = document.replace(/\r\n/g, "\n");
  const start = tekst.indexOf(ROLLEN_START);
  const eind = tekst.indexOf(ROLLEN_EIND);
  if (start !== -1 && eind !== -1 && eind > start) {
    return `${tekst.slice(0, start)}${blok}${tekst.slice(eind + ROLLEN_EIND.length)}`;
  }
  return `${tekst.trimEnd()}\n\n${blok}\n`;
}

export type Afgeleide = { readonly pad: string; readonly inhoud: string };

/**
 * Alle afgeleiden voor een set contracten. `bestaandOverzicht` is de huidige
 * tekst van het instapdocument (of null), zodat het blok erin wordt vervangen
 * en de rest van dat document onaangeroerd blijft.
 */
export function genereerAfgeleiden(
  contracten: readonly Rolcontract[],
  config: AfgeleidenConfig,
  rollenMap: string,
  bestaandOverzicht: string | null,
): readonly Afgeleide[] {
  const uit: Afgeleide[] = [];
  if (config.map) {
    for (const c of [...contracten].sort((a, b) => a.rol.localeCompare(b.rol))) {
      if (!c.agent) continue;
      const pad = `${config.map.replace(/\/+$/, "")}/${config.voorvoegsel}${c.rol}.md`;
      uit.push({ pad, inhoud: genereerAgentdefinitie(c, config, `${rollenMap}/${c.rol}.md`) });
    }
  }
  if (config.overzicht) {
    const blok = genereerOverzichtsblok(contracten, rollenMap);
    uit.push({ pad: config.overzicht, inhoud: vervangOverzichtsblok(bestaandOverzicht ?? "", blok) });
  }
  if (config.manifest) {
    uit.push({ pad: config.manifest, inhoud: genereerManifest(contracten, rollenMap) });
  }
  return uit;
}

/** Vergelijkt afgeleiden met wat er op schijf staat; regeleinden tellen niet mee. */
export function vindDrift(
  afgeleiden: readonly Afgeleide[],
  opSchijf: ReadonlyMap<string, string | null>,
): readonly { readonly pad: string; readonly reden: string }[] {
  const drift: { pad: string; reden: string }[] = [];
  for (const a of afgeleiden) {
    const huidig = opSchijf.get(a.pad) ?? null;
    if (huidig === null) drift.push({ pad: a.pad, reden: "ontbreekt" });
    else if (huidig.replace(/\r\n/g, "\n") !== a.inhoud) drift.push({ pad: a.pad, reden: "wijkt af van de bron" });
  }
  return drift;
}
