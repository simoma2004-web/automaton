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

# Sicherheitsprüfung: Der Agent darf nicht an Windows-Dateien oder Windows-Programme kommen.
if [[ "${AGENT_WINDOWS_ERLAUBT:-}" != "1" ]] && grep -qi microsoft /proc/version 2>/dev/null; then
  probleme=()
  for d in /mnt/[a-z]; do
    if [[ -d "$d" ]] && [[ -n "$(ls -A "$d" 2>/dev/null | head -1)" ]]; then
      probleme+=("Windows-Laufwerk $d ist eingebunden")
    fi
  done
  if [[ -e /proc/sys/fs/binfmt_misc/WSLInterop ]] || [[ -e /proc/sys/fs/binfmt_misc/WSLInterop-late ]]; then
    probleme+=("Windows-Programme (cmd.exe, powershell.exe) können gestartet werden")
  fi
  if (( ${#probleme[@]} > 0 )); then
    echo "STOPP: Ubuntu ist noch nicht von Windows abgeschottet:"
    for p in "${probleme[@]}"; do echo "  - $p"; done
    echo
    echo "Einmal ausführen:  ./fake-conway/abschotten.sh"
    echo "Dann in Windows-PowerShell:  wsl --shutdown  und Ubuntu neu öffnen."
    exit 1
  fi
fi

if [[ "$(id -u)" == "0" ]]; then
  echo "STOPP: Den Agenten nicht als root starten (sonst darf er alles in Ubuntu). Normales Benutzerkonto verwenden."
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

# Day-Trader-Skill für den Agenten bereitstellen (Werkzeuge nach ~/day-trader-skill,
# Kurzanleitung als Automaton-Skill, Regeln einmalig nach ~/trader/config.json)
if command -v python3 > /dev/null; then
  rm -rf "$HOME/day-trader-skill"
  cp -r fake-conway/day-trader-skill "$HOME/day-trader-skill"
  mkdir -p "$HOME/.automaton/skills/day-trader" "$HOME/trader"
  cp fake-conway/automaton-skills/day-trader/SKILL.md "$HOME/.automaton/skills/day-trader/SKILL.md"
  if [[ ! -f "$HOME/trader/config.json" ]]; then
    cp fake-conway/day-trader-skill/paper-config.json "$HOME/trader/config.json"
  fi
else
  echo "Hinweis: python3 fehlt, der Day-Trader-Skill wird nicht eingerichtet (sudo apt-get install -y python3)."
fi

export FAKE_CONWAY=1
export FAKE_CONWAY_URL="http://127.0.0.1:${PORT}"
export CONWAY_API_URL="http://127.0.0.1:${PORT}"
exec node dist/index.js --run
