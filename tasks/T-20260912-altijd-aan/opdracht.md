---
id: T-20260912-altijd-aan
titel: Opdrachten vanaf de telefoon worden ook verwerkt als de laptop uit staat
status: actief
klasse: M
risico: A
project: jarvis
aangevraagd_door: lodewijk
datum: 2026-09-12
gebieden:
  - jarvis
  - interface
---

## Wat de opdrachtgever vroeg

2026-09-12: "kan je kijken waarom de opdrachten die ik vanaf mijn telefoon
geef richting Jarvis structureel niet worden opgepakt. het lijkt er op dat
mijn laptop aan moet staan, want dan begint hij weer lijkt wel."

## Wat er aan de hand is

De waarneming klopt. Alles wat een opdracht verwerkt draait nu op de laptop:

1. **De live-lus.** De interface schrijft naar de artifact-database en
   publiceert een signaalbestand; dat signaal wekt de Claude Code-sessie in
   de desktop-app op de laptop (DEC-0033). Slaapt de laptop of is de app
   dicht, dan komt het signaal pas aan als beide weer wakker zijn — vandaag
   kwamen vier berichten van 09:36–10:21 pas om 12:28 binnen, in één batch.
2. **De ochtendroutine.** Dat is een geplande taak van de desktop-app,
   dus dezelfde afhankelijkheid: vandaag startte hij om 12:28 in plaats van
   07:33.

Er is dus geen uitvoerder die onafhankelijk van de laptop bestaat. De
interface zelf kan niets uitvoeren (DEC-0030: weergave); een eigen app
(T-20260911-jarvis-app) verandert daar niets aan — ook die heeft een sessie
nodig die het werk doet.

## Architectuuronderzoek (op verzoek van de eigenaar, 2026-09-12)

De behoefte: Jarvis blijft autonoom werken als de laptop uit staat — nieuwe
opdrachten uit de interface zo snel mogelijk, lopend werk gaat zelfstandig
door, na een autorisatie gaat het verder, periodieke controles als dat
nodig is. Actief wanneer nodig, stil wanneer er niets te doen is.

Wat het platform biedt (Claude Code cloud, "routines"): een sessie in de
cloud van Anthropic op een cron-rooster (minimaal één uur tussen runs), én
**webhook-triggers**: een GitHub-gebeurtenis (review, push, comment, …) op
een repository die een routine direct start. Een routine werkt in de
omgeving "Jarvis Build", waarin de bot de GitHub-identiteit is.

Wat de interface kan: ze schrijft in de artifact-database van claude.ai en
publiceert een signaalbestand. Dat signaal bereikt alleen een sessie die
het artifact volgt — de laptop. De pagina kan geen externe dienst aanroepen
(de artifact-sandbox blokkeert dat), dus zij kan zelf geen GitHub- of
webhook-gebeurtenis veroorzaken.

| | A. Elk uur een cloud-sessie | B. Event-driven | C. Hybride |
|---|---|---|---|
| Betrouwbaarheid | Hoog: platform-cron, onafhankelijk van alles | Hoog voor GitHub-gebeurtenissen; voor interface-gebeurtenissen alleen als er een bron is die een gebeurtenis kan afgeven | Hoog: gebeurtenis waar mogelijk, rooster als vangnet |
| Responstijd | Tot 60 min | Seconden tot minuten | Seconden tot minuten voor GitHub-gebeurtenissen; vangnetinterval voor de rest |
| Abonnementsgebruik | 17 runs per dag, ook als er niets is (elke run: kloon, `npm ci`, controle) | Alleen bij een gebeurtenis | Gebeurtenissen plus een klein aantal vangnetruns |
| Complexiteit | Laag | Middel: webhook-triggers, en voor interface-gebeurtenissen een brug (eigen database → gebeurtenis) | Middel |
| Onafhankelijk van de laptop | Volledig | Volledig | Volledig |
| "Actief wanneer nodig, stil wanneer niets" | Nee | Ja | Grotendeels; volledig zodra de interface gebeurtenissen afgeeft |

**Wat event-driven concreet betekent.** Drie soorten gebeurtenissen:

1. *Autorisaties op GitHub* (goedkeuring van een PR): webhook-trigger op
   `pull_request_review` → de routine start, `jarvis pr mergen` voegt samen.
   Beschikbaar nu.
2. *Lopend werk doorzetten*: webhook-trigger op `push` naar `main` (een
   merge) → de routine pakt de volgende open stap van de taak. Beschikbaar
   nu.
3. *Nieuwe opdrachten en antwoorden uit de interface*: geen gebeurtenis
   zolang de interface in de artifact-database van claude.ai leeft. Zodra
   Jarvis een eigen database heeft (Supabase, gratis — de eerste stap van
   T-20260911-jarvis-app), geeft die per nieuwe rij een database-webhook af
   naar een kleine serverfunctie die een `repository_dispatch` op ToVas Flow
   afvuurt → de routine start binnen seconden. Tot die tijd vangt het
   rooster dit op.

**Conclusie en advies: C, met B als eindtoestand.** Nu: webhook-triggers
voor goedkeuringen en merges, plus één cloud-routine als vangnet op een
laag rooster (overdag elke twee uur, 's nachts niet) die ook de stille
taken en het bottoken bewaakt. Daarna, als onderdeel van de Jarvis-app: de
eigen database als gebeurtenisbron, waarna het rooster terug kan naar een
paar controles per dag. A alleen is een polling-oplossing die zeventien
keer per dag wakker wordt voor meestal niets; B alleen laat de interface
tot de eigen database buiten beeld.

**Wat Jarvis zelf doet (mandaat):** de routine en de webhook-triggers
aanmaken en beproeven (eerste run: is de artifact-database bereikbaar
vanuit de cloud?), `jarvis pr` geschikt maken voor de cloud (engine-PR #8),
dubbele verwerking uitsluiten (status "in behandeling"), de laptop-
ochtendroutine terugbrengen tot aanvulling. De permissielaag van de
werkomgeving hield het aanmaken van de routine tegen; dat vraagt één
uitdrukkelijke opdracht van de eigenaar in het gesprek (geen keuze, wel
een go).

**Wat werkelijk bij de eigenaar blijft:** de eigen database voor Jarvis
(de eerste stap van de Jarvis-app) — dat is waar Jarvis' gegevens leven,
buiten claude.ai — en het abonnementsgebruik van de cloud-routine.

## Wat het structureel oplost (eerdere, engere versie)

**Een cloud-routine van Jarvis**: een Claude Code-sessie die op een vast
rooster in de cloud van Anthropic draait, met de repository als bron en de
bot als GitHub-identiteit (dezelfde omgeving "Jarvis Build" die eerder de
pull requests opende). Ze doet precies wat de ochtendroutine doet — nieuwe
antwoorden en berichten verwerken, het overzicht verversen, PR's openen en
samenvoegen na goedkeuring — maar dan elk uur, zonder laptop. De laptopsessie
blijft de snelle weg (seconden) als hij aan staat; de cloud-routine is het
vangnet (hoogstens een uur).

Randvoorwaarden en gevolgen:

- Rooster: minimaal één uur tussen runs (beperking van het platform).
  Voorstel: elk uur van 07:00 tot 23:00 Nederlandse tijd.
- Kosten: draait op het bestaande abonnement; een run die niets vindt is
  kort. Geen nieuwe betaalde dienst.
- Het bottoken hoeft niet naar de cloud: de cloud-omgeving werkt al als de
  bot via GitHub; `jarvis pr` gaat de GitHub-CLI daar als bron gebruiken
  wanneer het tokenbestand ontbreekt (kleine engine-wijziging).
- Te verifiëren bij de eerste run: dat de cloud-sessie de artifact-database
  kan lezen en schrijven (de Artifact-tool). Zo niet, dan is de volgende
  stap de eigen Jarvis-database (Supabase, zie T-20260911-jarvis-app) en
  wordt die beslissing urgenter.
- Twee uitvoerders tegelijk (laptop én cloud) mogen elkaar niet dubbel
  verwerken: beide zetten een antwoord eerst op "in behandeling" voordat ze
  ermee verder gaan (kleine wijziging in de routinetekst en de pagina).

## Wat bewust niet

De laptop "altijd aan" laten: werkt, maar is geen oplossing, alleen een
werkinstructie voor de eigenaar — precies wat CON-0015 niet wil.

## Acceptatie

- Een antwoord dat 's nachts vanaf de telefoon wordt gegeven terwijl de
  laptop uit staat, is de volgende ochtend om 07:00 verwerkt en zichtbaar
  in de interface.
- Geen dubbele verwerking wanneer laptop en cloud beide draaien.
