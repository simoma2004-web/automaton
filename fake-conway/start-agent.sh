#!/usr/bin/env bash
# Startet den Agenten so, dass er mit der Fake-Conway statt mit der echten spricht.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${FAKE_CONWAY_PORT:-4242}"

if ! curl -s -m 3 "http://127.0.0.1:${PORT}/v1/credits/balance" > /dev/null; then
  echo "Fake-Conway läuft nicht. Starte sie zuerst in einem anderen Fenster:"
  echo "  ./fake-conway/start-fake-conway.sh"
  exit 1
fi

if [[ -n "${OLLAMA_BASE_URL:-}" ]]; then
  echo "Hinweis: OLLAMA_BASE_URL ist gesetzt. Dann würde der Agent an der Fake-Conway"
  echo "vorbei direkt mit Ollama reden und nichts bezahlen. Wird für diesen Start entfernt."
  unset OLLAMA_BASE_URL
fi

if [[ ! -f dist/index.js ]]; then
  echo "Agent ist noch nicht gebaut. Baue jetzt (einmalig) ..."
  pnpm install
  pnpm build
fi

export FAKE_CONWAY=1
export CONWAY_API_URL="http://127.0.0.1:${PORT}"
exec node dist/index.js --run
