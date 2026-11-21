# Meting taakwerkruimte V3 per schermformaat (D-20261121-105625624)

Afdruk van tests/jarvis/v3-taakwerkruimte.test.ts in Chromium (Playwright): taak geopend, per formaat in alle
vier tabbladen (Overzicht, Bewijs & tests, Opdracht, Historie) gemeten bovenaan en na scrollen naar onderen.
De test faalt als dit bestand afwijkt van wat hij meet.

| formaat | metingen | paginabreedte (px) | horizontaal scrollen | elementen buiten beeld | knoppen overlappen | resultaat in beeld bij openen (vóór scrollen) | reactieveld in beeld |
|---|---|---|---|---|---|---|---|
| 320×568 kleine telefoon | 8 | 320 van 320 | nee | 0 | nee | ja | ja |
| 360×640 Android | 8 | 360 van 360 | nee | 0 | nee | ja | ja |
| 375×667 iPhone SE | 8 | 375 van 375 | nee | 0 | nee | ja | ja |
| 390×844 iPhone 14 | 8 | 390 van 390 | nee | 0 | nee | ja | ja |
| 412×915 grote Android | 8 | 412 van 412 | nee | 0 | nee | ja | ja |
| 768×1024 tablet | 8 | 768 van 768 | nee | 0 | nee | ja | ja |
| 1366×820 bureaublad | 8 | 1366 van 1366 | nee | 0 | nee | ja | ja |
