---
id: T-20260912-sanitizer-toekenning
titel: Sanitizer — toekenningspatroon voor korte secrets en een patroon voor postadressen
status: actief
klasse: S
risico: A
project: jarvis
aangevraagd_door: lodewijk
datum: 2026-09-12
gebieden:
  - jarvis
  - security
---

## Wat de opdrachtgever vroeg

Via de interface, 2026-09-12: RSK-0019 "aanpakken". Een credential korter
dan tweeëntwintig tekens glipt langs de sanitizer; een eerdere reparatie is
teruggedraaid omdat hij een nieuwe klasse vals-positieven gaf.

## Wat er moet gebeuren (in de engine)

1. Een patroon dat de **toekenning** herkent in plaats van de waarde:
   `WACHTWOORD=…`, `PASSWORD: …`, `secret = "…"` en varianten, ongeacht de
   lengte of vorm van de waarde; alleen buiten codeblokken die als voorbeeld
   zijn gemarkeerd.
2. Een apart patroon voor Nederlandse postadressen (straat + huisnummer +
   postcode `1234 AB`), categorie persoonsgegeven.
3. Beide gemeten tegen de volledige repositoryscan van ToVas Flow, Kasboek en
   de engine, en tegen een probeset met bekende treffers en niet-treffers;
   pas invoeren als de niet-treffers stil blijven (LRN uit de eerdere poging).
4. De uitzondering voor Jarvis-ids (`T-…`, `DEC-…`) ook in het
   entropiepatroon: een taak-id dat "secret" of "token" bevat, werd op een
   credentialregel alsnog gevlagd (gezien bij het aanmaken van deze taak).
5. Tests per patroon; RSK-0019 naar `beheerst`.

## Acceptatie

- De probeset: alle treffers gevonden, geen enkele niet-treffer gevlagd.
- De drie repositoryscans blijven schoon.
