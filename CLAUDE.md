# jarvis-engine — instap voor agents

1. Lees `project/PROJECT.md`, `docs/CURRENT_STATE.md` en het rolcontract in
   `jarvis/roles/` van de rol die je vervult.
2. Werk op een branch `jarvis/<naam>`; elke commit onder één rol met de
   trailers `Jarvis-Role:` en `Jarvis-Task:`.
3. Vóór elke commit: `npm run typecheck`, `npm test`; vóór een PR:
   `node bin/jarvis.mjs poort`.
4. Geen projectkennis in deze repository: de portabiliteitstest en de
   sanitizer bewaken dat, en jij ook.
5. Geen merge, geen force-push, geen wijziging van instellingen; de eigenaar
   reviewt elke PR.
