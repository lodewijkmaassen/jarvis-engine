---
id: T-20261017-jarvis-vereenvoudigen
titel: Jarvis vereenvoudigen — terug naar de kleinste keten die werkt
status: actief
klasse: L
risico: B
project: jarvis
aangevraagd_door: lodewijk
datum: 2026-10-17
gebieden:
  - jarvis
  - engine
  - governance
---

## Wat de opdrachtgever vroeg

2026-10-17, na de root-causeanalyse van acceptatietest H:

> Doel: de kleinst mogelijke Jarvis-architectuur die weer doet wat
> oorspronkelijk werkte: eigenaar geeft doel → Jarvis analyseert en voert
> technisch zelfstandig uit → onafhankelijke controle → productiecontrole →
> klaar. Technische problemen tijdens uitvoering zijn geen eigenaarbesluiten.
> De eigenaar mag geen technische actor in de keten zijn.

En: "Ja, start met fase 0 en 1. Het doel 'Jarvis vereenvoudigen' keur ik in de
app goed zodra het klaarstaat." Acceptatiecriterium van de eigenaar: de
proeftaak in fase 3 slaagt volledig autonoom, met 0 handelingen van de
eigenaar na het invoeren van het doel.

## Waarom

De analyse van 2026-10-17 toont dat de eigenaar vanaf 2026-09-10 als
handtekening in de poort is gebouwd (Constraint-acks op triggerwoorden, per
kop), dat zijn akkoord een scope-hash werd die zichzelf vergrendelt, dat de
poort administratie controleert (feitenblok, rollendrift, eigenaarslijst,
trailers), en dat V3 een tweede controlesysteem bovenop het eerste zette. Van
712 commits sinds 2026-09-10 raakten er 637 alleen governance; productcode is
vrijwel niet gebouwd.

## Scope

Uitsluitend de engine (`jarvis/src`, tests, interface) en de instructie van
de uitvoerder. Geen wijziging aan rulesets, workflows (`.github/`),
`CODEOWNERS` of `jarvis.config.yml`: de check `poort` en de goedkeuring door
`jarvis-attestatie` blijven bestaan, alleen het gedrag erachter wordt kleiner.

1. **Poort.** Hard blijven: canonieke workflow, engine-pin op `main`,
   secrets-scan, en randvoorwaarden met padtriggers. Triggerwoorden van
   randvoorwaarden, feitenblok, rollen- en indexdrift, de lint op de
   eigenaarslijst en verplichte trailers worden waarschuwing. Er is geen
   Constraint-ack van de eigenaar meer nodig.
2. **Attestatie wordt de reviewjob.** Geen taakakkoord met scope-hash en geen
   dossierspiegel meer. In de workflow zelf leest een ander model dan de
   bouwer de diff tegen het doel; GO → goedkeuren en samenvoegen, NO-GO →
   commentaar, na twee NO-GO's staat het doel op "vast" met de reden. Blijven:
   auteur is de bot, poort en CI groen, geen harde uitzondering.
3. **Doelen en eindcontrole.** Eén tabel (doel, acceptatie-URL, status,
   uitkomst); de pagina `/v3/` wordt het invoerscherm. Na samenvoegen meet de
   CI het bouwmerk en de acceptatie-URL en zet het doel op klaar, of terug.
4. **Instructie.** Eén pagina vervangt `docs/ROUTINE_CLOUD.md` en
   `docs/ROUTINE_V3.md`.

## Acceptatie

Een echte proeftaak (bouwmerk in de paginakop van ToVas Flow) loopt van doel
tot klaar zonder enige handeling van de eigenaar na het invoeren van het
doel: goedkeuren en samenvoegen door `github-actions[bot]`, review GO door een
ander model, bouwmerk op productie gelijk aan (of volgend op) de merge-sha,
doel "klaar" gezet door de eindcontrole. Negatief: een PR die
`.github/workflows` raakt, een NO-GO, een nep-secret en een afwijkend
bouwmerk leiden elk niet tot samenvoegen of klaar.
