#!/usr/bin/env bash
# Schottet Ubuntu (WSL) von Windows ab, damit der Agent nicht an deine Sachen kommt:
#   - Windows-Laufwerke (C:, D: ...) werden nicht mehr unter /mnt eingebunden
#   - Windows-Programme (cmd.exe, powershell.exe, explorer.exe ...) lassen sich
#     aus Ubuntu nicht mehr starten
#   - der Windows-Suchpfad wird nicht mehr übernommen
# Die Netzwerkverbindung zu Ollama auf Windows (localhost:11434) bleibt erhalten.
#
# Einmal ausführen:  ./fake-conway/abschotten.sh
# Danach in Windows-PowerShell:  wsl --shutdown   und Ubuntu neu öffnen.
#
# Rückgängig machen:  ./fake-conway/abschotten.sh --rueckgaengig
set -euo pipefail

CONF="${WSL_CONF_PATH:-/etc/wsl.conf}"

if [[ "${1:-}" == "--rueckgaengig" ]]; then
  if [[ -f "$CONF.vor-abschotten" ]]; then
    sudo cp "$CONF.vor-abschotten" "$CONF"
  else
    sudo rm -f "$CONF"
  fi
  echo "Abschottung entfernt. Jetzt in Windows-PowerShell: wsl --shutdown  und Ubuntu neu öffnen."
  exit 0
fi

if [[ -f "$CONF" && ! -f "$CONF.vor-abschotten" ]]; then
  sudo cp "$CONF" "$CONF.vor-abschotten"
fi

# Bestehende Einstellungen (z. B. [boot] systemd=true, [user] default=...) behalten,
# nur die Abschnitte [automount] und [interop] werden ersetzt.
TMP="$(mktemp)"
if [[ -f "$CONF" ]]; then
  awk '
    /^\[/ { skip = ($0 == "[automount]" || $0 == "[interop]") }
    !skip { print }
  ' "$CONF" > "$TMP"
fi
cat >> "$TMP" <<'EOF'

[automount]
# Windows-Laufwerke nicht einbinden: Ubuntu (und der Agent) sehen C:\ nicht
enabled = false
mountFsTab = false

[interop]
# Keine Windows-Programme aus Ubuntu starten, keinen Windows-Pfad übernehmen
enabled = false
appendWindowsPath = false
EOF
sudo cp "$TMP" "$CONF"
rm -f "$TMP"

echo "Fertig. Ubuntu ist ab dem nächsten Start von Windows abgeschottet."
echo
echo "Jetzt noch:"
echo "  1. Ubuntu-Fenster schließen"
echo "  2. In Windows-PowerShell eingeben:  wsl --shutdown"
echo "  3. Ubuntu wieder öffnen und prüfen:  ls /mnt   (darf kein 'c' mehr zeigen)"
