# Fake-Conway – Agent mit Spielgeld starten

Die Fake-Conway ist ein kleiner Server auf deinem PC, der so tut, als wäre er Conway.
Der Agent merkt keinen Unterschied. In Wahrheit gilt:

| Was der Agent denkt | Was wirklich passiert |
|---|---|
| Conway-Guthaben | Virtuelles Konto, Start 50 $ |
| Denken über Conway | Wird an Ollama (oder später OpenAI/Groq/Anthropic) weitergeleitet, die Kosten werden vom Konto abgezogen |
| Geld verdienen | Paper-Trading mit echten Live-Kursen (Coinbase), 0,1 % Gebühr + Slippage |
| Kontostand unter 0 | Agent ist tot |
| Domains, Sandboxes, Überweisungen, Klone | In der Simulation gesperrt |

Status-Seite: **http://localhost:4242** (aktualisiert sich alle 30 Sekunden).

---

## Einmalig einrichten (Windows)

### 1. WSL (Linux in Windows) installieren
Der Agent ist für Linux gebaut und führt selbst Befehle aus. Unter Windows läuft er deshalb in WSL.
Das ist auch sicherer, weil er dann nicht direkt in deinem Windows herumfuhrwerkt.

PowerShell **als Administrator** öffnen und eingeben:
```
wsl --install -d Ubuntu
```
PC neu starten, danach Ubuntu aus dem Startmenü öffnen und Benutzername + Passwort festlegen.

### 2. WSL mit Windows-"localhost" verbinden
Damit Ubuntu dein Windows-Ollama unter `localhost` erreicht:

Im Windows-Explorer `%UserProfile%` öffnen, dort eine Datei **`.wslconfig`** anlegen mit diesem Inhalt:
```
[wsl2]
networkingMode=mirrored
```
Dann in PowerShell: `wsl --shutdown` und Ubuntu neu öffnen.
(Braucht Windows 11. Bei Windows 10 sag Bescheid, dann machen wir es anders.)

### 3. Ollama vorbereiten (auf Windows)
Der Agent schickt bei jedem Nachdenken sehr viel Text (ca. 12.000 Tokens). Ollama nimmt standardmäßig viel weniger an.

1. Windows-Suche: **"Umgebungsvariablen für dieses Konto bearbeiten"**
2. Neu → Name `OLLAMA_CONTEXT_LENGTH`, Wert `32768`
3. Ollama komplett beenden (Symbol unten rechts → Quit) und neu starten
4. In PowerShell das Modell laden:
   ```
   ollama pull qwen3:8b
   ```
   (ca. 5 GB, braucht etwa 8 GB freien Arbeitsspeicher)

### 4. Programme in Ubuntu installieren
Im Ubuntu-Fenster, Zeile für Zeile:
```
sudo apt-get update && sudo apt-get install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs
sudo npm install -g pnpm
```
Test, ob Ollama erreichbar ist (muss eine Liste mit `qwen3:8b` zeigen):
```
curl http://localhost:11434/api/tags
```

### 5. Agent herunterladen und bauen
```
git clone -b fake-conway https://github.com/simoma2004-web/automaton.git
cd automaton
pnpm install
pnpm build
```

---

## Starten

Du brauchst **zwei Ubuntu-Fenster**.

**Fenster 1 – Fake-Conway:**
```
cd ~/automaton
./fake-conway/start-fake-conway.sh
```

**Fenster 2 – Agent:**
```
cd ~/automaton
./fake-conway/start-agent.sh
```

Beim **ersten Start** stellt der Agent Fragen:

| Frage | Antwort |
|---|---|
| Chain type | einfach Enter |
| Conway API key | kommt automatisch von der Fake-Conway |
| Name | z. B. `Atlas` |
| Genesis prompt | Inhalt von `fake-conway/genesis-prompt.txt` einfügen, dann **zweimal Enter** |
| Creator wallet address | deine MetaMask-Adresse (0x…) |
| **OpenAI / Anthropic / Ollama** | **alle drei leer lassen, nur Enter!** Sonst redet er an der Fake-Conway vorbei und zahlt nichts. |
| Limits | einfach Enter |

Den Genesis-Prompt zum Kopieren anzeigen: `cat ~/automaton/fake-conway/genesis-prompt.txt`

Danach läuft er los. Zuschauen: **http://localhost:4242** im Browser.

Beenden: in beiden Fenstern `Strg + C`. Beim nächsten Start macht er da weiter, wo er war.

**Alles auf Anfang** (wieder 50 $, leeres Depot):
```
./fake-conway/start-fake-conway.sh --reset
rm -rf ~/.automaton
```

---

## Einstellungen ändern

Kopiere zuerst die Vorlage (deine Kopie wird nicht zu GitHub hochgeladen):
```
cp fake-conway/config.example.json fake-conway/config.json
```
Dann `fake-conway/config.json` bearbeiten (`nano fake-conway/config.json`):

- `startBalanceUsd` – Startkapital
- `billing` – was ihm pro 1 Mio. Tokens fürs Denken berechnet wird. Bei Ollama ist es eigentlich gratis, damit der Test realistisch ist, werden trotzdem Preise wie bei einem günstigen Cloud-Modell abgezogen.
- `trading.feePercent` – Handelsgebühr

### Auf ein Cloud-Modell umstellen (schlauer, kostet echtes Geld)
In `config.json` bei `upstream` eintragen, und bei `billing` die echten Preise des Modells laut Anbieter-Website:

| Anbieter | baseUrl |
|---|---|
| Groq | `https://api.groq.com/openai/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Anthropic | `https://api.anthropic.com/v1` |

Den API-Key nicht in die Datei schreiben, sondern beim Start mitgeben:
```
UPSTREAM_API_KEY=dein-key ./fake-conway/start-fake-conway.sh
```
Und beim Anbieter unbedingt ein **Ausgabenlimit** setzen.

---

## Gut zu wissen

- **Kosten:** Ein Denk-Schritt kostet ihn bei den Standardpreisen ca. 0,4 Cent. Wacht er alle 30 Minuten auf und denkt dabei 3-mal nach, sind das ca. 0,50 $ pro Tag, also ca. 15 $ im Monat. Damit er überlebt, muss er mindestens das mit Trading reinholen.
- **Kleine Modelle sind schwach:** `qwen3:8b` auf dem eigenen PC ist kostenlos, aber deutlich dümmer als Cloud-Modelle. Wenn er nur Unsinn macht, liegt es eher am Modell als an der Idee.
- **Schummeln wird erkannt:** Verändert der Agent die Kontodatei selbst, zeigt die Status-Seite dauerhaft "Manipuliert".
- **Alles wird protokolliert:** `fake-conway/data/journal.jsonl` enthält jeden Trade und jedes Nachdenken.
- **Der Agent kann Befehle ausführen.** Er läuft zwar in Ubuntu/WSL, kann aber trotzdem auf Windows-Dateien unter `/mnt/c` zugreifen. Lass ihn nicht unbeaufsichtigt tagelang laufen, bevor du gesehen hast, was er tut.
