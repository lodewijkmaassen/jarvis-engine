# Resultaat — T-20260917-eigenaarinteracties

In uitvoering. Het onderzoek is gedaan en de oorzaak is per regel aangewezen
(zie `opdracht.md`, sectie "Oorzaak"); de bouw staat nog open.

## Voortgang

- [x] Opdracht van de eigenaar ontvangen en vastgelegd (2026-09-17 11:33 UTC,
      bericht bij item `tovas-flow:T-20260914-eigen-laag:4fca1d68`)
- [x] Oorzaak gemeten in de gepinde engine `a89bf30`, vier bevindingen in
      `jarvis/src/overzicht.ts`: (1) de classificatie hangt aan de woordtoets
      `/^beslis/i` op de titel plus "blokkerend" in de context, zodat een keuze
      die met "kies" begint als `actie` eindigt en alleen "Gedaan" krijgt;
      (2) `bouwOpties` maakt alleen keuzemogelijkheden van aparte optieregels, en
      de keuze stond in één `- Stap 1:`-regel, zodat de twee alternatieven de
      knoppen nooit bereikten; (3) de kaarttitel is het afgekapte begin van die
      stapregel, zodat de vraag half werd getoond; (4) een bericht met
      `context.item_id` heeft geen weg terug naar de open actie, zodat een keuze
      uit het gesprek de kaart niet sluit
- [x] Acceptatiecriteria opgesteld (tien, alle toetsbaar; `opdracht.md`)
- [x] Afgebakend tegen `T-20260917-voor-jou-reconciliatie` (engine-PR #49): die
      taak gaat over *of* een item nog terecht in de lijst staat, deze over *hoe*
      een terecht item wordt voorgelegd. De bouw hier gaat op de engine-kop die
      #49 oplevert
- [x] Architect: uitvoeringsplan opgeleverd in `plan.md` (2026-09-18) — de vijf
      soorten `akkoord`, `keuze`, `externe-handeling`, `bevestiging`, `uitstel`
      met hun knoppen en een bepaling in volgorde die geen woordtoets gebruikt;
      het dossierformaat met aparte optieregels onder een gereserveerd label
      `Keuze`, door `lint` afgedwongen, met herkenning van "(a) … of (b) …" in
      één regel als migratievangnet; en de afbeelding van een bericht met
      `context.item_id` op de open actie per soort, die bij twijfel niets
      verandert. Volgorde van uitvoering en de eis rood-tegen-oud staan er in
- [x] Vijfde oorzaak gemeten (2026-09-18, cloud, gepinde engine): een
      akkoordstap in een dossier wordt nooit gesloten door het akkoord zelf.
      Zie "Vijfde bevinding" hieronder; hij hoort bij criterium 6 en moet in
      dezelfde reparatie mee
- [ ] Developer: de reparatie in `jarvis-engine`, met per acceptatiecriterium een
      test die faalt op de code van vóór de wijziging (merge-base uitchecken, en
      daarna controleren dat de eigen wijziging nog in de boom staat) — inclusief
      de vijfde bevinding: de toestandsbepaling leidt "de eigenaar is aan zet"
      af uit de autorisatietabel in plaats van uit de tekst van de open stap
- [ ] Inventarisatie van alle bestaande eigenaaracties met hun soort en knoppen,
      en herstel van de dossierpunten die verkeerd geclassificeerd blijken
      (criterium 7 en 8)
- [ ] QA: onafhankelijke ronde op de engine-PR, oordeel per criterium met bewijs
- [ ] De pin van ToVas Flow en Kasboek op de nieuwe engine — governance-
      uitzondering (DEC-0043 §2), apart akkoord
- [ ] Verificatie op de echte lijst: de kaart die deze opdracht uitlokte bestaat
      niet meer (de keuze is verwerkt, `DEC-0049`), dus de meting gebeurt op een
      nieuw keuzepunt en op de inventarisatie van criterium 8

## Wat de eigenaar nog moet doen

Niets. De opdracht is een uitvoeropdracht en de eigenaar heeft gevraagd alleen
terug te komen bij een governance-akkoord, een handeling die technisch alleen
hij kan doen, of een nieuwe inhoudelijke keuze die niet uit bestaande besluiten
valt af te leiden. Het akkoord op de engine-pin komt aan het eind van de rit en
staat tot die tijd als open stap in `## Voortgang`, niet hier.

## Vijfde bevinding — het akkoord sluit zijn eigen stap niet (gemeten 2026-09-18, cloud)

Aanleiding: een bericht van de eigenaar van 2026-09-18 23:42 UTC. Zijn woorden:
*"Ik heb geen goedkeuring taken open staan. Daarnaast heb ik die taken volgens
mij al goedgekeurd. Volgens mij hadden we dit al vaker geconstateerd."* Dat
laatste klopt: het is dezelfde melding die telkens terugkomt, en niets sloot de
lus.

Hij heeft gelijk, en de meting laat zien waarom. De regie meldde die avond vier
taken als `WAITING_FOR_USER` met de reden "Akkoord van de eigenaar op deze taak
in de Jarvis-app". Voor drie daarvan staat een taakakkoord in de database, en de
scope-hash van `tasks/<T>/opdracht.md` op `main` is nog letterlijk dezelfde als
die waarop de eigenaar akkoord gaf:

| Taak | Akkoord in de database | Scope-hash op `main` |
|---|---|---|
| `T-20260917-voor-jou-reconciliatie` | 2026-09-17 11:30 UTC | gelijk aan het akkoord |
| `T-20260917-autonome-opvolging` | 2026-09-17 11:30 UTC | gelijk aan het akkoord |
| `T-20260914-agent-operations` | 2026-09-14 21:45 UTC | gelijk aan het akkoord |

Er is dus niets vervallen. Alleen `T-20260918-herstelcyclus` heeft werkelijk nog
geen taakakkoord; dat is de enige van de vier waar de eigenaar aan zet is.

**Waar het misgaat.** De toestand `WAITING_FOR_USER` wordt niet afgeleid uit de
autorisatietabel, maar uit de tekst van de eerstvolgende open voortgangsstap in
het dossier. In `jarvis/src/regie.ts` (regel 180):

```ts
if (t.aan_zet === "eigenaar" || (volgende !== null && AKKOORD_STAP.test(volgende) && t.akkoord_nodig)) {
```

met `AKKOORD_STAP = /\bakkoord\b.*\beigenaar\b|\beigenaar\b.*\bakkoord\b/i`
(regel 104), en `aan_zet` / `akkoord_nodig` uit `jarvis/src/overzicht.ts`
(regel 735-736):

```ts
const akkoord_nodig = actief && t.tekst !== undefined && volgendeStap !== null && isAkkoordStap(volgendeStap);
const aan_zet: TaakItem["aan_zet"] = !actief ? "niemand" : openVoorEigenaar.length > 0 || akkoord_nodig ? "eigenaar" : "jarvis";
```

Geen van beide raadpleegt de autorisaties. Zodra stap 7 van de cloudroutine de
regel "Akkoord van de eigenaar op deze taak in de Jarvis-app" als open stap in
een dossier zet, blijft die taak bij de eigenaar staan tot iemand die stap met
de hand afvinkt. Zijn akkoord vinkt hem niet af: er is geen terugkoppeling van
de autorisatietabel naar het dossier. De kaart in de interface verdwijnt na zijn
akkoord wel — vandaar dat hij niets ziet openstaan terwijl de regie blijft
melden dat hij aan zet is.

De attestatie doet het wél goed: `jarvis/src/attestatie.ts` (regel 226-233)
vergelijkt `autorisatie.scope_hash` met de hash van de kop en weigert alleen bij
een echt verschil. Het gat zit dus uitsluitend in de toestandsbepaling, niet in
de autorisatiecontrole.

**Wat dit betekent voor criterium 6.** Criterium 6 ("zodra de vereiste
eigenaarinput geldig is verwerkt, sluit de bijbehorende eigenaaractie
automatisch") is met de vier eerdere bevindingen nog niet gehaald: die gaan over
de kaart in de interface, deze over de toestand van de taak erachter. De
reparatie moet de akkoordstap als gedaan behandelen zodra er een taakakkoord
ligt waarvan de scope-hash gelijk is aan die van `opdracht.md` op de kop — met
dezelfde vergelijking die `attestatie.ts` al gebruikt, zodat een werkelijk
gewijzigde scope de taak wél terecht bij de eigenaar terugbrengt.

**Randvoorwaarde bij het herstel van dossiers.** De scope-hash dekt alleen
`opdracht.md`. Een voortgangsstap afvinken hoort daarom in `resultaat.md` te
gebeuren, zoals hier; een wijziging in `opdracht.md` laat het akkoord van de
eigenaar vervallen en zet de taak opnieuw bij hem neer.
