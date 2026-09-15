---
id: T-20260914-agent-operations
titel: Jarvis als observeerbaar en autonoom digitaal team — Operations-view en Task Controller
status: actief
klasse: L
risico: B
project: jarvis
aangevraagd_door: lodewijk
datum: 2026-09-14
gebieden:
  - jarvis
  - interface
  - governance
  - engine
---

## Wat de opdrachtgever vroeg

De eigen Jarvis-app is de primaire interface, maar Jarvis voelt er statisch:
projecten, taken en statussen zijn zichtbaar, het digitale team eronder niet.
Onduidelijk is wie ergens aan werkt, vanuit welke taak, wat een agent nu doet,
wat daarna komt, waarom werk stilstaat, of een taak werkelijk loopt en of
Jarvis ingrijpt als werk niet doorloopt. Taken liggen soms uren bij Jarvis
zonder zichtbare voortgang terwijl er niets van de eigenaar nodig is: dat is
een operationeel probleem, niet alleen een UI-probleem.

Doel: Jarvis doorontwikkelen van projecten/taken naar een observeerbaar en
autonoom digitaal team, in twee delen:

1. **Agent/Operations-view.** Een tik op de centrale Jarvis-knoop opent een
   view met het team: stabiele functionele rollen (geen tijdelijke sessies of
   subagents als aparte agents), per rol: naam, status (bezig, beschikbaar,
   wacht, geblokkeerd, fout/herstel), huidige taak en project, wat hij doet,
   hoelang al, laatste aantoonbare activiteit, volgende stap, wachtende taken.
   Geen schijnactiviteit: "bezig" moet echte uitvoeringsinformatie hebben.
   Inzoomen op een agent vertaalt technische gebeurtenissen naar begrijpelijke
   operationele activiteit. Vanuit een taak is de verantwoordelijke rol en de
   operationele toestand zichtbaar. Live op echte gebeurtenissen, geen
   kunstmatige animatie; bruikbaar op telefoon en desktop; bestaande
   visuele identiteit en mindmap blijven.
2. **Task Controller (operationele regielaag).** Een permanente regiefunctie
   die alle open taken bewaakt: elke open taak heeft een aantoonbare toestand
   (richting QUEUED / RUNNING / BLOCKED / WAITING_FOR_USER /
   WAITING_FOR_DEPENDENCY; geen betekenisloos "open") en een verantwoordelijke.
   De controller handelt zelf: dispatch van uitvoerbaar werk, onderzoek bij
   QUEUED zonder eigenaar, RUNNING zonder heartbeat, uitgevallen uitvoerder
   opnieuw dispatchen, dependency bewaken en hervatten, administratieve
   afronding zelf doen, technisch herstel binnen bevoegdheden; alleen
   WAITING_FOR_USER komt in "Voor jou".

Invariant: geen open taak is operationeel eigenaarloos of onverklaard stil.
Voor elke open taak beantwoordt Jarvis: eigenaar, toestand, waarom, laatste
relevante activiteit, volgende stap, wie die uitvoert. Time-outs per soort
werk, niet één blinde timeout.

"Voor jou" wordt hierdoor niet voller: alleen beslissingen, toestemmingen,
credentials/identiteit en handelingen die uitsluitend de eigenaar kan doen.
Statusmeldingen, administratieve afrondingen, normale QA, attestaties,
merges binnen governance, herstarts, technische controles, verificaties en
mededelingen horen in Operations/Activity.

Governance blijft volledig gelden (taakautorisatie, QA, attestatie,
constraints, security, repositoryregels, harde uitzonderingen); de controller
omzeilt niets om een wachtrij leeg te krijgen.

Werkwijze: eerst de huidige architectuur en de actuele stilstaande taken
onderzoeken (met bewijs), dan ontwerp, bouw, onafhankelijke QA, herstel,
end-to-end acceptatie, uitrol via de bestaande governance, dossiers en kennis
zelfstandig bijwerken. Alleen productmatige of governance-matige keuzes komen
bij de eigenaar.

## Acceptatiecriteria (letterlijk van de opdrachtgever)

1. Klik op Jarvis opent een duidelijke Agent/Operations-view.
2. De daadwerkelijk relevante functionele agents/rollen zijn zichtbaar.
3. Per actieve agent: project, taak, actuele activiteit, status, laatste
   activiteit, volgende stap.
4. Vanuit een taak is de verantwoordelijke agent en operationele toestand
   zichtbaar.
5. Alle open taken hebben een verklaarbare operationele toestand/eigenaar.
6. Een nieuwe uitvoerbare taak wordt zonder tussenkomst van de eigenaar
   opgepakt.
7. Een taak die kunstmatig/veilig reproduceerbaar stilvalt wordt door de
   controller gedetecteerd.
8. Jarvis onderneemt daarna zelfstandig een passende herstel-/redispatchactie
   als governance dat toestaat.
9. Een dependency die verdwijnt leidt automatisch tot hervatting.
10. Een taak die werkelijk het akkoord van de eigenaar nodig heeft verschijnt
    in "Voor jou".
11. Een taak die geen handeling van de eigenaar nodig heeft verschijnt daar
    niet.
12. Agentactiviteiten worden op basis van echte gebeurtenissen dynamisch
    zichtbaar.
13. Bruikbaar op telefoon en desktop.
14. De bestaande project/mindmap-interface blijft functioneren.
15. Bestaande governance wordt aantoonbaar niet omzeild.
16. Een echte end-to-end proef: een taak doorloopt aangemaakt → geclassificeerd
    → toegewezen → uitgevoerd → QA/governance → afgerond zonder technische of
    administratieve handelingen van de eigenaar.
