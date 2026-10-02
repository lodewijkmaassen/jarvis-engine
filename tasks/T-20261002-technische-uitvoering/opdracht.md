---
id: T-20261002-technische-uitvoering
titel: Technische uitvoering volledig door Jarvis
status: actief
klasse: L
risico: B
project: jarvis
aangevraagd_door: lodewijk
datum: 2026-10-02
gebieden:
  - jarvis
  - engine
  - governance
  - ci
uitzonderingen:
  - workflows en repository-automatisering
  - governanceconfiguratie
  - de code die de autorisatie beoordeelt
---

## Wat de opdrachtgever vroeg

2026-10-02, bericht in de Jarvis-interface:

> Als ik als eigenaar een besluit of akkoord heb gegeven, moet Jarvis de
> daaropvolgende technische uitvoering zelfstandig kunnen afhandelen. [...] Ik
> neem beslissingen en geef waar nodig expliciet akkoord. Jarvis voert daarna
> zelfstandig de technische keten uit, inclusief waar van toepassing: bouwen →
> testen → onafhankelijke controle → PR → merge → deployment → productiecontrole
> → administratief afsluiten.
>
> Doel is niet om beveiliging uit te schakelen of alles onbeperkt toe te staan.
> Doel is dat normale technische uitvoering binnen een reeds goedgekeurde
> opdracht niet telkens opnieuw bij mij terechtkomt.

Hij noemde zeven handelingen die hij op 2026-10-01/02 zelf moest doen: een pull
request goedkeuren en samenvoegen, git-opdrachten draaien, zijn lokale
repository synchroniseren, de interface bouwen, inloggen bij Vercel, de
productie-uitrol doen, en het productieresultaat controleren.

## De kern van de bevinding

**Het ontwerp klopt al; de uitvoerder kan er niet bij.**

`DEC-0043` legt precies de gevraagde werkwijze vast: de eigenaar autoriseert
*per taak*, en `.github/workflows/jarvis-attestatie.yml` geeft daarna namens de
poort de goedkeurende review af — na deterministische verificatie dat het
akkoord bestaat, dat de scope sindsdien niet veranderde, dat een onafhankelijke
toetsing GO gaf op precies die commit, dat er geen harde uitzondering speelt, en
dat de poort groen is. Die machinerie is gebouwd en werkt.

Wat ontbreekt is niet de governance maar de *bereikbaarheid* ervan. De zeven
handelingen van de eigenaar zijn geen zeven losse gebreken: het zijn de gevolgen
van vier omgevingsbeperkingen.

## De vier beperkingen, elk gemeten

**B1 — De attestatieweg is wisselvallig, niet onbereikbaar.** *Bijgesteld op
2026-10-02 na een eigen meting; zie `resultaat.md`, ronde 2.* De oorspronkelijke
lezing hieronder bleek te stellig: dezelfde dag lukte een `workflow_dispatch`
vanuit de cloud-uitvoerder wél, tweemaal, en de hele keten attesteren →
samenvoegen liep zonder tussenkomst van de eigenaar. De beperking is dus niet
absoluut; wat zij is — opgeheven, of wisselend per run — is van hieruit niet vast
te stellen. `RSK-0025`
(gemeten 2026-09-15, nog `open`): de proxy van het platform antwoordt op
`workflow_dispatch` met *"Dispatching, enabling or disabling workflows ... are
not permitted for this session type"*. Dat is geen GitHub-recht — pushen en een
pull request openen lukken met hetzelfde token wél. Daarmee is de attestatieweg
van `DEC-0043` voor de cloud structureel onbereikbaar, en valt elke samenvoeging
terug op een handmatige review van de eigenaar. Dit is de oorzaak van zijn punt
1. Let op: `RSK-0025` noemt als aanpak `T-20260912-altijd-aan`, en dat dossier is
bij de reset vervallen; het risico staat sindsdien zonder eigenaar. Deze taak
neemt het over.

**B2 — De permissieclassificatie van de uitvoeringsomgeving weigert de
afrondende handelingen.** Gemeten op 2026-10-01/02, vier verschillende redenen:
`Merge Without Review` op een merge-commit en op de push daarvan; `Self-Approval`
op `jarvis pr attesteren`; `CI Bypass` op het herformuleren van een regel waar de
poort op aanslaat. De derde is terecht en hoort te blijven — tekst aanpassen waar
een poort op controleert is van buiten niet te onderscheiden van het omzeilen
ervan. De eerste twee treffen juist handelingen waarvoor het akkoord al bestond.
Ook `npx jarvis db verwerkt berichten` werd geweigerd, terwijl dat pure
administratie is.

**B3 — Er is geen geautomatiseerde uitrolweg.** De interface wordt gebouwd met
`jarvis/interface/app/bouw.mjs` en uitgerold met `npx vercel --prod` vanaf de
laptop van de eigenaar. Er is geen CI-workflow die dat doet; `config.js` (de
Supabase-url en de publieke sleutel) staat nergens machineleesbaar; de binding
naar het Vercel-project leeft alleen in een niet-versiebeheerde
`.vercel/project.json` op zijn machine; en `docs/ROUTINE_CLOUD.md` verbiedt de
uitvoerder uitdrukkelijk elke deployment. Dit is de oorzaak van zijn punten 2
tot en met 6.

**B4 — De uitvoerder kan productie niet waarnemen.** De netwerkpolicy van de
cloudomgeving weigert `jarvis-nine-virid.vercel.app` (403 van de proxy). Daardoor
kon op 2026-10-02 een uitrol die de bestanden niet verving als geslaagd gelden:
alle verificatie stopte bij de repositorygrens, terwijl het defect juist in het
gat tussen bron en productie zat. Dit is de oorzaak van zijn punt 7, en het is de
duurste van de vier — hij maakt de andere drie onbetrouwbaar, want zonder
waarneming is "klaar" een aanname.

## De driedeling die de opdrachtgever vroeg

### 1. Wat Jarvis veilig zelfstandig moet kunnen

Alles wat deterministisch is en achteraf te controleren, binnen een taak die al
is geautoriseerd:

- bouwen, testen, `lint`, `index`, `state`, `sanitize`, de poort;
- branchen, committen en pushen op `jarvis/**`;
- een pull request openen;
- een onafhankelijke toetsing draaien en vastleggen (`db toetsing`);
- attesteren en samenvoegen van een PR die het taakakkoord draagt, een GO op de
  huidige kop heeft en een groene poort — de verificatie zit al in de workflow;
- een statische uitrol naar een *preview*-adres;
- productie lezen (een publieke GET op de uitgerolde pagina) en vergelijken;
- administratief afsluiten en berichten op verwerkt zetten.

### 2. Eén eigenaarbesluit vooraf, daarna zelfstandig

- het taakakkoord in de Jarvis-interface (`DEC-0043`) — dit is en blijft het
  scharnierpunt;
- een apart akkoord bij een harde uitzondering (`DEC-0043` §2);
- het vrijgeven van een geverifieerde preview naar productie, zolang dat besluit
  per taak geldt en niet per commit;
- een `Constraint-ack` op een harde randvoorwaarde. **Bevinding van vandaag:** die
  ack werkt nu per kop in plaats van per taak, en alleen in de run die de review
  zelf aansteekt. Daardoor vroeg één push de eigenaar om dezelfde afweging
  opnieuw. Dat hoort in deze taak gerepareerd te worden; het is de enige plaats
  waar hij vandaag tweemaal hetzelfde moest beslissen.

### 3. Wat aantoonbaar alleen de eigenaar kan

Vier dingen, en geen daarvan is een technische keuze:

- een Vercel-credential aanmaken en als repository-secret opslaan; een token
  bestaat alleen als een mens hem aanmaakt;
- de instelling *"Allow GitHub Actions to create and approve pull requests"* op
  de repository, die de attestatieworkflow nodig heeft;
- de netwerkpolicy en de permissiemodus van de cloudomgeving;
- de inhoudelijke beslissingen en akkoorden zelf.

## Aanpak — de minimaal noodzakelijke structurele wijzigingen

Vier wijzigingen, in deze volgorde, want elke volgende leunt op de vorige.

**A. Productie waarneembaar maken (lost B4 op).** Twee delen: de pagina draagt
een bouwmerk (de commit waaruit ze is gebouwd, zichtbaar naast het bestaande
`v${versie}`), en er komt één opdracht die de uitgerolde pagina ophaalt en dat
merk vergelijkt met wat er had moeten staan. Zonder dit blijft elke volgende
verbetering onbewijsbaar. Dit is de goedkoopste wijziging en de grootste winst.

**B. Uitrollen vanuit CI in plaats van vanaf een laptop (lost B3 op).** Een
canonieke workflow in de engine die op een samenvoeging naar `main` de interface
bouwt en uitrolt, en daarna A draait als harde controle. Randvoorwaarde die bij
het ontwerp hoort: de poort eist dat `.github/workflows` geen onbekende workflows
bevat en byte-identiek is aan `jarvis/canonical/`, dus een uitrolworkflow is
alleen toe te voegen door hem canoniek te maken — een bewuste, reviewbare
wijziging. Dat is geen hindernis maar precies de gewenste grens.

**C. De attestatieweg betrouwbaar maken (B1).** *Bijgesteld op 2026-10-02:* nu
gemeten is dat de weg het soms wél doet, is een tweede weg bouwen niet langer de
eerste zet. Meet eerst wanneer de dispatch slaagt en wanneer niet, en bouw pas
een alternatief als de weigering terugkeert; een tweede attestatieweg is extra
oppervlak op de plek waar de autorisatie wordt bewaakt, en dat verdient geen
voorsprong op bewijs. Mocht een alternatief nodig blijken, dan geldt de
mitigatie die `RSK-0025` al voorschreef, met deze harde
ontwerpvoorwaarde: de beslissende code moet uit `main` draaien en niet uit de
kop van de pull request, anders kan een pull request zichzelf goedkeuren — dat is
de eigenschap die `workflow_dispatch` nu levert. Welke trigger dat haalt, is een
ontwerpkeuze binnen deze taak en geen eigenaarsbesluit. Daarbij hoort de tweede
openstaande mitigatie van `RSK-0025`: `jarvis pr wie` moet de drie rechten
onderscheiden die er werkelijk zijn — lezen, schrijven op inhoud, en een workflow
starten — in plaats van "geen schrijfrecht" te melden.

**D. De `Constraint-ack` per taak in plaats van per kop (lost de dubbele vraag
op).** Zie categorie 2 hierboven.

Wat B2 betreft: dat is geen wijziging in deze repositories. De weigeringen komen
uit de uitvoeringsomgeving. A tot en met C verkleinen het aantal momenten waarop
die weigering de keten raakt; wat daarna overblijft, is een instelling van de
eigenaar en hoort in de lijst hieronder, niet in de bouw.

## Acceptatiecriteria

- **AC-1** Een uitrol van de interface draait uit CI, zonder handeling op een
  lokale machine, en faalt hard wanneer de uitgerolde pagina niet het bouwmerk
  van de uitgerolde commit draagt.
- **AC-2** Het concrete geval van 2026-10-02 is gedekt: een uitrol die de
  bestanden niet vervangt wordt rood, en niet groen.
- **AC-3** De cloud-uitvoerder kan een PR die het taakakkoord draagt, een GO op
  de huidige kop heeft en een groene poort, zelfstandig attesteren en
  samenvoegen — aantoonbaar zonder `workflow_dispatch`.
- **AC-4** `jarvis pr wie` meldt de drie rechten los van elkaar, en meldt nooit
  "geen schrijfrecht" wanneer de bot `write` heeft.
- **AC-5** Een `Constraint-ack` van de eigenaar op een taak blijft geldig na een
  volgende push op dezelfde taak, en vraagt hem niet opnieuw.
- **AC-6** De beslissende code van de attestatie draait aantoonbaar uit `main`;
  een pull request kan haar niet aanpassen om zichzelf goed te keuren. Vast te
  leggen met een test die het faalpad afdekt.
- **AC-7** `RSK-0025` is aan deze taak gekoppeld en komt op `beheerst` zodra AC-3
  en AC-4 gehaald zijn.
- **AC-8** Geen enkele wijziging verruimt de poort, de sanitizer of de
  autorisatiecontrole. Te toetsen op de diff: `attestatie.ts` en `pr.ts` mogen
  geen controle laten vallen.
- **AC-9** Eén akkoord van de eigenaar op deze taak volstaat voor alle
  technische tussenstappen die aantoonbaar binnen de goedgekeurde scope
  vallen. Pull requests, commits, workflows, configuratiewijzigingen, merges
  en uitrollen zijn op zichzelf geen reden voor een nieuw akkoord zolang zij
  nodig zijn voor en vallen binnen deze taak. Alleen een wezenlijk nieuwe
  beslissing buiten die scope komt opnieuw bij hem. De technische controles,
  de onafhankelijke toetsing en de verificatie blijven onverkort: wat
  eenvoudiger wordt is de autorisatie, niet de kwaliteitsbewaking.

  De derde aangekondigde soort verdient een eigen woord, want zij is de
  zwaarste. Deze taak wijzigt de code die de autorisatie zélf beoordeelt
  (`attestatie.ts` en `pr.ts`), en sinds die bestanden een harde uitzondering
  zijn, kan dat niet meer ongezien. Zonder deze aankondiging zou elke
  wijziging daaraan een apart akkoord per kop vragen; mét haar dekt het
  taakakkoord ze, maar alleen voor déze taak. Een andere taak die diezelfde
  code wil raken, moet het opnieuw aankondigen en opnieuw worden goedgekeurd.

  De `uitzonderingen` in de front-matter hierboven zijn wat dit afdwingbaar
  maakt. Zij zeggen welke soorten harde uitzondering deze taak mag raken, en
  zij vallen onder de scope-hash: er een soort bij schrijven laat het akkoord
  vervallen. Het mandaat kan dus niet door Jarvis worden verruimd, alleen
  door een nieuw akkoord van de eigenaar.

## Risico's en grenzen

- **Een uitrolworkflow met secrets is een nieuw aanvalsoppervlak.** Daarom
  canoniek, byte-vergeleken, en met de secrets uitsluitend in de uitrolstap —
  niet in de poort, die bewust zonder secrets draait.
- **De attestatieweg mag geen zelfgoedkeuring worden.** AC-6 is de harde grens;
  bij twijfel gaat de bestaande weg voor.
- **Niet in deze taak:** de permissiemodus van de cloudomgeving, de inhoud van de
  kaart, en elke andere doorontwikkeling. De opdrachtgever heeft deze taak
  uitdrukkelijk afgebakend.

## Wat de eigenaar nog moet doen

Niets om te beginnen — de analyse en het ontwerp vragen hem niets. De vier
punten hieronder worden pas gevraagd op het moment dat de bouw ze nodig heeft,
en elk is er een die aantoonbaar alleen hij kan zetten.

- Stap 1: Akkoord van de eigenaar op deze taak in de Jarvis-app. De taak raakt
  governance en CI en vraagt daarom zijn autorisatie (`DEC-0043`).
- Stap 2: Een Vercel-token aanmaken en als repository-secret opslaan, samen met
  de Supabase-url en de publieke sleutel die `bouw.mjs` nodig heeft. Waar:
  Vercel → Account Settings → Tokens, en GitHub → `lodewijkmaassen/jarvis-engine`
  → Settings → Secrets and variables → Actions. Controle: de uitrolworkflow
  draait groen op een proefcommit.
- Stap 3: Controleren of op `lodewijkmaassen/jarvis-engine` de instelling
  *"Allow GitHub Actions to create and approve pull requests"* aanstaat
  (Settings → Actions → General). Zonder die instelling telt de goedkeuring van
  de attestatieworkflow niet mee. Controle: een attestatie op een proef-PR levert
  een goedkeurende review op.
- Controle: na oplevering voert Jarvis een volledige keten uit op één taak —
  bouwen, toetsen, PR, attesteren, samenvoegen, uitrollen, productie nameten,
  afsluiten — en meldt het resultaat, zonder dat de eigenaar tussenbeide komt.
