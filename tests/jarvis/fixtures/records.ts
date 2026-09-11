// Synthetische kennisrecords voor het calibratieprototype.
//
// ALLES hierin is verzonnen. Geen klantdata, geen productiegegevens, geen
// secrets, geen echte telefoonnummers of e-mailadressen. De inhoud lijkt op
// een realistische kennisbank omdat retrieval anders niets zinnigs meet.
//
// `bronnen` verwijst naar fixtures/sources/*.md, relatief aan de
// fixtures-map (zie FIXTURES_WORTEL in de tests).
import type { KnowledgeRecord } from "@/jarvis/src/records";

export const GELDIGE_RECORDS: readonly KnowledgeRecord[] = [
  {
    id: "DEC-0001",
    type: "DEC",
    titel: "Deterministische state machine boven een taalmodel",
    samenvatting:
      "De gespreksstatus wordt uitsluitend door code bepaald, nooit door een taalmodel.",
    datum: "2026-01-12",
    tags: ["architectuur", "ai", "state-machine"],
    bronnen: ["sources/architectuur.md"],
    status: "besloten",
    besluit:
      "Statusovergangen, huurderbepaling, overname en prijsuitspraken staan in een state machine in code.",
    motivatie:
      "Een state machine is herhaalbaar te testen en uit te leggen; een taalmodel is dat niet.",
    alternatieven: ["Het taalmodel de status laten kiezen", "Een regelmotor met configuratie"],
    gevolgen: [
      "Het taalmodel formuleert alleen tekst",
      "Elke nieuwe status vraagt een codewijziging en een test",
    ],
    vervangt: [],
  },
  {
    id: "DEC-0002",
    type: "DEC",
    titel: "Serverroutes in de webapplicatie in plaats van losse functies",
    samenvatting:
      "Webhooks en achtergrondtaken draaien als serverroutes binnen dezelfde applicatie.",
    datum: "2026-01-20",
    tags: ["architectuur", "deployment"],
    bronnen: ["sources/architectuur.md"],
    status: "besloten",
    besluit: "Alle webhooks draaien als serverroutes; er komt geen aparte functieruntime bij.",
    motivatie: "Eén runtime, één deploy, één logboek; minder bewegende delen bij een klein team.",
    alternatieven: ["Losse edge functions naast de applicatie"],
    gevolgen: ["Deploy van de applicatie deployt ook de webhooks"],
    vervangt: [],
  },
  {
    id: "DEC-0003",
    type: "DEC",
    titel: "Eigen nummer van de klant blijft leidend",
    samenvatting:
      "Doorschakeling loopt via het bestaande nummer van de klant; een platformnummer vervangt dat nooit.",
    datum: "2026-02-03",
    tags: ["telefonie", "product"],
    bronnen: ["sources/telefonie.md"],
    status: "besloten",
    besluit: "Het publieke nummer van de klant wordt nooit vervangen door een platformnummer.",
    motivatie: "Het nummer is het bedrijfsadres van de klant; vervangen kost vertrouwen en vindbaarheid.",
    alternatieven: ["Een platformnummer als terugvaloptie toestaan"],
    gevolgen: ["Elke telefonie-oplossing moet met doorschakeling werken"],
    vervangt: ["DEC-0004"],
  },
  {
    id: "DEC-0004",
    type: "DEC",
    titel: "Platformnummer als tijdelijke terugvaloptie",
    samenvatting: "Oud besluit dat een platformnummer toestond wanneer doorschakeling faalde.",
    datum: "2025-11-08",
    tags: ["telefonie"],
    bronnen: ["sources/telefonie.md"],
    status: "vervallen",
    besluit: "Bij een falende doorschakeling mag tijdelijk een platformnummer gebruikt worden.",
    motivatie: "Sneller live kunnen bij de eerste testklanten.",
    alternatieven: [],
    gevolgen: ["Vervangen door DEC-0003"],
    vervangt: [],
  },
  {
    id: "CON-0001",
    type: "CON",
    titel: "Transparantie over AI in het eerste bericht",
    samenvatting: "Het eerste uitgaande bericht vermeldt altijd dat een assistent meeleest.",
    datum: "2026-01-12",
    tags: ["ai", "compliance", "berichten"],
    bronnen: ["sources/architectuur.md"],
    regel:
      "Het eerste uitgaande bericht bevat een AI-vermelding; deze is in code afgedwongen en niet uitschakelbaar.",
    hardheid: "hard",
    handhaving: "code",
    bron_besluit: "DEC-0001",
  },
  {
    id: "CON-0002",
    type: "CON",
    titel: "Geen verzonnen prijzen of bedrijfsfeiten",
    samenvatting: "Het taalmodel mag nooit prijzen of feiten produceren die niet in de configuratie staan.",
    datum: "2026-01-14",
    tags: ["ai", "guardrail"],
    bronnen: ["sources/architectuur.md"],
    regel:
      "Prijzen en bedrijfsfeiten komen uitsluitend uit de configuratie; ontbreekt een feit, dan volgt overdracht aan een mens.",
    hardheid: "hard",
    handhaving: "code",
    bron_besluit: "DEC-0001",
  },
  {
    id: "CON-0003",
    type: "CON",
    titel: "Externe keten telt pas na aantoonbaar extern effect",
    samenvatting: "Een flow met een externe partij geldt pas als werkend na bewijs aan het eind van de keten.",
    datum: "2026-02-28",
    tags: ["testen", "acceptatie", "notificaties"],
    bronnen: ["sources/notificaties.md", "sources/telefonie.md"],
    regel:
      "Unittests zijn verplicht maar nooit voldoende als eindacceptatie voor een keten met een externe partij.",
    hardheid: "hard",
    handhaving: "proces",
  },
  {
    id: "LRN-0001",
    type: "LRN",
    titel: "Telefoniebugs komen pas bij een echte oproep boven",
    samenvatting: "Vier hersteldrondes waren nodig omdat alleen de webhook getest was, niet de keten.",
    datum: "2026-02-10",
    tags: ["telefonie", "testen"],
    bronnen: ["sources/telefonie.md"],
    observatie:
      "Een webhook die in unittests correct antwoordde, liet in de praktijk de oproep alsnog stranden.",
    les: "Een telefoniewijziging geldt pas als werkend na een echte oproep van begin tot eind.",
    bewijs: ["Fictief testverslag ronde 1 tot en met 4"],
  },
  {
    id: "LRN-0002",
    type: "LRN",
    titel: "Stille mislukkingen bij externe verzenders",
    samenvatting: "Een geaccepteerd bericht bleek nooit afgeleverd; er stond niets in de database.",
    datum: "2026-03-02",
    tags: ["notificaties", "observability"],
    bronnen: ["sources/notificaties.md"],
    observatie: "De functie logde succes, maar de aflevering mislukte bij de externe partij.",
    les: "Elke externe mislukking hoort in de gebeurtenissentabel, nooit alleen in een functielog.",
    bewijs: ["Verzonnen voorbeeldgebeurtenis zonder afleverbevestiging"],
  },
  {
    id: "RSK-0001",
    type: "RSK",
    titel: "Afhankelijkheid van één berichtenleverancier",
    samenvatting: "Uitval of beleidswijziging bij de leverancier legt de chatkanalen stil.",
    datum: "2026-02-15",
    tags: ["leverancier", "berichten", "continuiteit"],
    bronnen: ["sources/architectuur.md"],
    beschrijving:
      "Alle uitgaande chatberichten lopen via één externe leverancier zonder alternatief pad.",
    kans: "midden",
    impact: "hoog",
    mitigatie:
      "De uitgaande berichtenlaag centraal houden zodat een tweede leverancier alleen daar geraakt wordt.",
    eigenaar: "product owner",
    status: "open",
  },
  {
    id: "RSK-0002",
    type: "RSK",
    titel: "Doorschakeling bij de provider van de klant faalt stil",
    samenvatting: "Een verkeerd ingestelde doorschakeling levert geen foutmelding op, alleen stilte.",
    datum: "2026-02-18",
    tags: ["telefonie", "onboarding"],
    bronnen: ["sources/telefonie.md"],
    beschrijving:
      "De klant stelt de doorschakeling zelf in bij zijn provider; een fout daarin is van buiten niet zichtbaar.",
    kans: "hoog",
    impact: "hoog",
    mitigatie: "Een verplichte eindtest met een echte oproep vóór activatie.",
    eigenaar: "onboarding",
    status: "beheerst",
  },
  {
    id: "CFL-0001",
    type: "CFL",
    titel: "Platformnummer versus eigen nummer",
    samenvatting: "Het oude terugvalbesluit spreekt het huidige nummerbesluit tegen.",
    datum: "2026-02-03",
    tags: ["telefonie"],
    bronnen: ["sources/telefonie.md"],
    beschrijving:
      "DEC-0004 stond een platformnummer toe als terugvaloptie; DEC-0003 verbiedt dat onvoorwaardelijk.",
    tussen: ["DEC-0003", "DEC-0004"],
    status: "opgelost",
    opgelost_door: "DEC-0003",
  },
  {
    id: "CFL-0002",
    type: "CFL",
    titel: "Unittest als acceptatie versus externe-keteneis",
    samenvatting: "Onopgeloste spanning tussen snel opleveren en de externe-keteneis.",
    datum: "2026-03-05",
    tags: ["testen", "acceptatie"],
    bronnen: ["sources/notificaties.md"],
    beschrijving:
      "CON-0003 eist bewijs aan het eind van de keten, terwijl LRN-0002 laat zien dat dat bewijs niet altijd te krijgen is.",
    tussen: ["CON-0003", "LRN-0002"],
    status: "open",
  },
];

/**
 * Records die bewust NIET deugen — één per foutsoort. Gebruikt om te toetsen
 * dat validatie faalt waar dat hoort, en niet stilletjes doorlaat.
 */
export const ONGELDIGE_RECORDS: Readonly<Record<string, unknown>> = {
  // titel leeg
  legeTitel: {
    ...GELDIGE_RECORDS[0],
    id: "DEC-0900",
    titel: "   ",
  },
  // id-voorvoegsel hoort niet bij het type
  voorvoegselMismatch: {
    ...GELDIGE_RECORDS[0],
    id: "CON-0901",
  },
  // onbekend veld
  onbekendVeld: {
    ...GELDIGE_RECORDS[0],
    id: "DEC-0902",
    verzonnenVeld: "hoort hier niet",
  },
  // absoluut bronpad
  absoluutBronpad: {
    ...GELDIGE_RECORDS[0],
    id: "DEC-0903",
    bronnen: ["/etc/hosts"],
  },
  // padtraversal in bron
  traversalBronpad: {
    ...GELDIGE_RECORDS[0],
    id: "DEC-0904",
    bronnen: ["../../geheim.md"],
  },
  // datum in het verkeerde formaat
  verkeerdeDatum: {
    ...GELDIGE_RECORDS[0],
    id: "DEC-0905",
    datum: "12-01-2026",
  },
  // opgelost conflict zonder verwijzing naar het oplossende besluit
  opgelostZonderBesluit: {
    id: "CFL-0906",
    type: "CFL",
    titel: "Conflict zonder oplosser",
    samenvatting: "Staat op opgelost maar noemt geen besluit.",
    datum: "2026-03-06",
    tags: [],
    bronnen: [],
    beschrijving: "Synthetisch foutgeval.",
    tussen: ["DEC-0001", "DEC-0002"],
    status: "opgelost",
  },
  // conflict met te weinig deelnemers
  conflictMetEenDeelnemer: {
    id: "CFL-0907",
    type: "CFL",
    titel: "Conflict met één kant",
    samenvatting: "Een conflict loopt tussen minstens twee records.",
    datum: "2026-03-06",
    tags: [],
    bronnen: [],
    beschrijving: "Synthetisch foutgeval.",
    tussen: ["DEC-0001"],
    status: "open",
  },
  // onbekend recordtype
  onbekendType: {
    ...GELDIGE_RECORDS[0],
    id: "XYZ-0908",
    type: "XYZ",
  },
};
