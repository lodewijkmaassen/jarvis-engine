#!/usr/bin/env bash
# Maakt een privé repository aan onder het GitHub-account van de eigenaar en
# koppelt de huidige map eraan. Klasse A (CON-0015): Jarvis mag dit zelf,
# binnen de toestemmingslijst van de eigenaar.
#
# Gebruik: bash jarvis/scripts/repo-aanmaken.sh <naam> [beschrijving] [--publiek] [--bot <login>]
#   - draai vanuit de map die de repository wordt (bestaande git-historie)
#   - het token komt uit de credential manager; het wordt nooit getoond
#   - bestaat de repository al, dan alleen de remote koppelen
#   - standaard privé; --publiek alleen op besluit van de eigenaar
#   - --bot <login> (of JARVIS_BOT_LOGIN): nodigt de bot direct uit met
#     schrijfrecht, alleen op een zojuist aangemaakte repository (DEC-0038,
#     aanvulling 2026-09-11); Jarvis accepteert met `jarvis pr uitnodigingen`
set -euo pipefail

publiek=false
bot="${JARVIS_BOT_LOGIN:-}"
args=()
verwacht_bot=false
for a in "$@"; do
  if $verwacht_bot; then bot="$a"; verwacht_bot=false; continue; fi
  case "$a" in
    --publiek) publiek=true ;;
    --bot) verwacht_bot=true ;;
    *) args+=("$a") ;;
  esac
done
naam="${args[0]:-}"
beschrijving="${args[1]:-}"
if [[ -z "$naam" || ! "$naam" =~ ^[a-z0-9][a-z0-9-]{0,99}$ ]]; then
  echo "gebruik: repo-aanmaken.sh <naam in kleine letters, cijfers en streepjes> [beschrijving]" >&2
  exit 2
fi
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "repo-aanmaken: dit is geen git-werkboom" >&2
  exit 2
fi

token="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')"
login="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^username=//p')"
if [[ -z "$token" || -z "$login" ]]; then
  echo "repo-aanmaken: geen GitHub-credential gevonden in de credential manager" >&2
  exit 1
fi

api="https://api.github.com"
status="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "$api/repos/$login/$naam")"
if [[ "$status" == "404" ]]; then
  body="$(python -c 'import json,sys;print(json.dumps({"name":sys.argv[1],"description":sys.argv[2],"private":sys.argv[3]!="true","has_wiki":False,"has_projects":False,"auto_init":False}))' "$naam" "$beschrijving" "$publiek")"
  antwoord="$(curl -s -X POST -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" "$api/user/repos" -d "$body")"
  if ! printf '%s' "$antwoord" | python -c 'import json,sys;d=json.load(sys.stdin);sys.exit(0 if d.get("private")==(sys.argv[1]!="true") else 1)' "$publiek"; then
    echo "repo-aanmaken: aanmaken mislukt: $(printf '%s' "$antwoord" | python -c 'import json,sys;print(json.load(sys.stdin).get("message","onbekend"))')" >&2
    exit 1
  fi
  if $publiek; then echo "repo-aanmaken: publieke repository $login/$naam aangemaakt."; else echo "repo-aanmaken: privé repository $login/$naam aangemaakt."; fi
  # Standaard-ruleset, alleen op een zojuist aangemaakte repository (DEC-0038,
  # aangescherpt in DEC-0041): geen verwijderen, geen force-push, pull request
  # met één goedkeuring en uitsluitend een mergecommit, en de check `poort`
  # (de job uit de canonieke workflow) moet geslaagd zijn. Bestaande
  # repositories raakt dit script nooit.
  ruleset='{"name":"main-protection","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},"rules":[{"type":"deletion"},{"type":"non_fast_forward"},{"type":"pull_request","parameters":{"required_approving_review_count":1,"dismiss_stale_reviews_on_push":true,"require_code_owner_review":false,"require_last_push_approval":false,"required_review_thread_resolution":false,"allowed_merge_methods":["merge"]}},{"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":false,"required_status_checks":[{"context":"poort"}]}}]}'
  rs="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" "$api/repos/$login/$naam/rulesets" -d "$ruleset")"
  if [[ "$rs" == "201" ]]; then
    echo "repo-aanmaken: standaard-ruleset main-protection gezet."
  else
    echo "repo-aanmaken: WAARSCHUWING: ruleset niet gezet (HTTP $rs); zet hem met de hand of meld het aan de eigenaar." >&2
  fi
  # De bot als collaborator met schrijfrecht, alleen hier (zojuist aangemaakt):
  # zonder de bot kan Jarvis er geen pull request openen die de eigenaar kan
  # goedkeuren (DEC-0039). Nooit admin.
  if [[ -n "$bot" ]]; then
    bs="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" "$api/repos/$login/$naam/collaborators/$bot" -d '{"permission":"push"}')"
    if [[ "$bs" == "201" || "$bs" == "204" ]]; then
      echo "repo-aanmaken: bot $bot uitgenodigd met schrijfrecht; accepteer met: jarvis pr uitnodigingen"
    else
      echo "repo-aanmaken: WAARSCHUWING: bot $bot niet uitgenodigd (HTTP $bs); meld het aan de eigenaar." >&2
    fi
  fi
elif [[ "$status" == "200" ]]; then
  echo "repo-aanmaken: $login/$naam bestaat al; alleen de remote wordt gekoppeld."
else
  echo "repo-aanmaken: onverwacht antwoord van GitHub ($status)" >&2
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  echo "repo-aanmaken: remote origin bestaat al: $(git remote get-url origin)"
else
  git remote add origin "https://github.com/$login/$naam.git"
  echo "repo-aanmaken: remote origin gekoppeld."
fi
echo "repo-aanmaken: klaar. Push met: git push -u origin <branch>"
