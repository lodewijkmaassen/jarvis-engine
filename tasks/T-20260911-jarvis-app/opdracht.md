---
id: T-20260911-jarvis-app
titel: Jarvis als app op de telefoon, zoals Kasboek
status: actief
klasse: M
risico: A
project: jarvis
aangevraagd_door: lodewijk
datum: 2026-09-11
gebieden:
  - jarvis
  - interface
---

## Wat de opdrachtgever vroeg

Via het gesprek in de interface, 2026-09-11: "Kan je van Jarvis ook een app
maken ipv enkel een webpagina? Net zoals het kasboek."

## Wat "zoals Kasboek" technisch is

Kasboek is een installeerbare webapp (PWA): een Next.js-site op Vercel met een
`manifest` (`display: standalone`) en eigen iconen. Op de telefoon staat hij
met eigen icoon op het beginscherm en opent hij zonder browserbalk; de
gegevens staan in Supabase achter één account. Er is geen app-winkel en geen
aparte native code.

## Wat de huidige interface is en waarom die dat niet zomaar kan

De interface van Jarvis is een Artifact-pagina op claude.ai. Alles wat haar
interactief maakt komt uit die omgeving: de database (`overzicht`,
`antwoorden`, `berichten`), de inlog (je claude.ai-account) en het
wek-signaal waarmee de pagina een lopende Jarvis-sessie wakker maakt
(DEC-0033). Buiten claude.ai bestaat dat alles niet. De pagina als PWA
installeren kan dus niet; ze is bewust een weergave met de repository als bron
(DEC-0030) en claude.ai als drager.

Dat is ook precies haar zwakte tegen het oorspronkelijke doel: de interface
is nu de enige component van Jarvis die aan één leverancier hangt.

## Opties

1. **Snelkoppeling op het beginscherm van de huidige interface.** Nul werk.
   Op de telefoon opent de link in de browser, met claude.ai-inlog en
   browserbalk; alles wat er nu is blijft werken, inclusief directe
   verwerking. Geen eigen icoon, geen volledig scherm.
2. **Een eigen Jarvis-app, zoals Kasboek.** Next.js + Supabase + Vercel,
   eigen icoon, volledig scherm, één account. De drie collecties verhuizen
   naar een eigen Supabase-project; `jarvis overzicht` schrijft daarheen in
   plaats van naar de artifact-database. Gevolgen:
   - Provider-onafhankelijk: de interface hangt dan niet meer aan claude.ai.
     Dit is de laatste component waarvoor dat geldt.
   - Kosten € 0: Vercel Hobby en een tweede gratis Supabase-project (dat
     pauzeert na zeven dagen stilte; de dagelijkse ochtendroutine houdt het
     wakker). Geen nieuwe betaalde dienst, dus geen Class B.
   - Het wek-signaal verandert: een eigen app kan een lopende sessie niet
     rechtstreeks wekken zoals het artifact dat doet. Jarvis leest dan de
     eigen database (sessie: elke minuut; ochtendroutine: bij de start). Een
     antwoord wordt nog steeds in dezelfde sessie verwerkt, met tot een minuut
     vertraging in plaats van seconden.
   - Werk: één tot twee dagen Jarvis-werk (schema, pagina overzetten, inlog,
     `overzicht --doel supabase`), daarna één keer inloggen door jou. De
     eerste deploy en het Supabase-project zijn klasse A zodra de
     toestemmingslijst er staat; de rol van Vercel en Supabase in de
     toestemmingslijst komt dan als voorstel in `T-20260911-capabilities`.
   - Volgorde: dit concurreert met `T-20260911-engine-repository` en
     `T-20260911-kasboek-aansluiten`, die nu op de toestemmingslijst wachten.
3. **Eerst 1, daarna 2 als eigen taak na de twee lopende.** Nu de
   snelkoppeling; de app wordt gebouwd zodra engine-repository en Kasboek
   aangesloten zijn, met de artifact-pagina als tussentijdse interface.

## Advies

Optie 3. De vraag legt een echte afwijking van het doel bloot (de interface
is leveranciersgebonden) en verdient daarom een ja; maar de twee lopende taken
maken Jarvis eerst zelfstandig in zijn eigen omgeving, en de artifact-pagina
doet haar werk tot die tijd.
