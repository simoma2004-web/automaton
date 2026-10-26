#!/usr/bin/env bash
# Startet die Fake-Conway (Konto, Denken, Paper-Trading).
# Zurücksetzen auf 50 $ und leeres Depot:  ./fake-conway/start-fake-conway.sh --reset
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--reset" ]]; then
  node fake-conway/server.mjs --reset
fi

exec node fake-conway/server.mjs
