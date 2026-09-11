#!/usr/bin/env bash
# Maakt een privé repository aan onder het GitHub-account van de eigenaar en
# koppelt de huidige map eraan. Klasse A (CON-0015): Jarvis mag dit zelf,
# binnen de toestemmingslijst van de eigenaar.
#
# Gebruik: bash jarvis/scripts/repo-aanmaken.sh <naam> [beschrijving]
#   - draai vanuit de map die de repository wordt (bestaande git-historie)
#   - het token komt uit de credential manager; het wordt nooit getoond
#   - bestaat de repository al, dan alleen de remote koppelen
set -euo pipefail

naam="${1:-}"
beschrijving="${2:-}"
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
  body="$(python -c 'import json,sys;print(json.dumps({"name":sys.argv[1],"description":sys.argv[2],"private":True,"has_wiki":False,"has_projects":False,"auto_init":False}))' "$naam" "$beschrijving")"
  antwoord="$(curl -s -X POST -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" "$api/user/repos" -d "$body")"
  if ! printf '%s' "$antwoord" | python -c 'import json,sys;d=json.load(sys.stdin);sys.exit(0 if d.get("private") is True else 1)'; then
    echo "repo-aanmaken: aanmaken mislukt: $(printf '%s' "$antwoord" | python -c 'import json,sys;print(json.load(sys.stdin).get("message","onbekend"))')" >&2
    exit 1
  fi
  echo "repo-aanmaken: privé repository $login/$naam aangemaakt."
  # Standaard-ruleset, alleen op een zojuist aangemaakte repository (DEC-0038):
  # geen verwijderen, geen force-push, pull request met één goedkeuring.
  # Identiek aan wat tovas-flow en kasboek hebben. Bestaande repositories
  # raakt dit script nooit.
  ruleset='{"name":"main-protection","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},"rules":[{"type":"deletion"},{"type":"non_fast_forward"},{"type":"pull_request","parameters":{"required_approving_review_count":1,"dismiss_stale_reviews_on_push":true,"require_code_owner_review":false,"require_last_push_approval":false,"required_review_thread_resolution":false}}]}'
  rs="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" "$api/repos/$login/$naam/rulesets" -d "$ruleset")"
  if [[ "$rs" == "201" ]]; then
    echo "repo-aanmaken: standaard-ruleset main-protection gezet."
  else
    echo "repo-aanmaken: WAARSCHUWING: ruleset niet gezet (HTTP $rs); zet hem met de hand of meld het aan de eigenaar." >&2
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
