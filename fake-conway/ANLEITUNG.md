# Fake-Conway – Agent mit Spielgeld starten

Die Fake-Conway ist ein kleiner Server auf deinem PC, der so tut, als wäre er Conway.
Der Agent merkt keinen Unterschied. In Wahrheit gilt:

| Was der Agent denkt | Was wirklich passiert |
|---|---|
| Conway-Guthaben | Virtuelles Konto, Start 50 $ |
| Denken über Conway | Wird an Ollama (oder später OpenAI/Groq/Anthropic) weitergeleitet, die Kosten werden vom Konto abgezogen |
| Geld verdienen | Paper-Trading mit echten Live-Kursen: Krypto rund um die Uhr (Coinbase, 0,1 % Gebühr), US-Aktien zu Börsenzeiten (Yahoo, 15:30–22:00 Uhr) |
| Day-Trader-Skill | Für Aktien nutzt der Agent den Day-Trader-Skill: Scanner → Einstieg → Stop/Ziel → Zeitmaschine → Positionsgröße → Risiko-Check → Order. Stop, Ziel und Glattstellen um 21:55 Uhr überwacht die Simulation selbst |
| Kontostand unter 0 | Agent ist tot |
| Monatsfrist | Alle 30 Tage muss der Gesamtwert mindestens +5 % gestiegen sein, sonst wird er abgeschaltet |
| Hebel (bis 10x) | Nur nach einem geschafften Monat, max. 20 % des Kapitals, automatische Liquidation; ein Verlust sperrt den Hebel bis Monatsende |
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
**Schon erledigt:** Ollama ist installiert, in der Ollama-App ist unter Settings die *Context length* auf **32k** gestellt und das Modell `qwen3:8b` geladen.
(Falls du es irgendwann neu machen musst: Ollama-App → Settings → Context length 32k, dann im Chat das Modell `qwen3:8b` auswählen und eine Nachricht schicken, dann lädt es sich.)

### 4. Programme in Ubuntu installieren
Im Ubuntu-Fenster, Zeile für Zeile:
```
sudo apt-get update && sudo apt-get install -y git curl python3
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
- `challenge.monthlyTargetPercent` – Monatsziel in Prozent (`"enabled": false` schaltet die Frist ab)
- `leverage.maxLeverage` / `leverage.maxMarginPercentOfEquity` – maximaler Hebel und wie viel Kapital dafür genutzt werden darf

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

## Day-Trader-Skill (US-Aktien)

Der Skill aus deinem Downloads-Ordner (`day-trader-skill`, MIT-Lizenz) liegt im Repo unter `fake-conway/day-trader-skill`.
`start-agent.sh` richtet ihn bei jedem Start automatisch ein:

- die Werkzeuge nach `~/day-trader-skill`
- eine Kurzanleitung als Agenten-Skill nach `~/.automaton/skills/day-trader`
- beim ersten Mal die Regeln nach `~/trader/config.json`

**Die Regeln für das kleine Konto** (`~/trader/config.json`): höchstens 1,50 $ Verlust pro Trade, 3 $ pro Tag, 3 Trades pro Tag, Ziel mindestens 1,5× so groß wie das Risiko, keine Käufe vor 15:45 und nach 21:30 Uhr, alles bis 21:55 Uhr glattstellen. Das Budget passt sich automatisch an den Kontostand an.

**Was anders ist als im Original-Skill:** Statt `trader-broker` (Alpaca + dein Ja) schickt `paper_broker.py` die Order an die Simulation, aber **nur, wenn trader-risk genau diese Order heute mit PASS geprüft hat**. Das ist nur für Spielgeld gedacht. Mit echtem Geld gehört dein Ja wieder vor jede Order.

**Gut zu wissen:**
- Mit 50 $ gehen nur ganze Aktien. Teure Aktien wie Tesla lehnt die Positionsgröße ab, er handelt also eher günstige Werte (Liste in `paper-watchlist.txt`).
- Die SEC-Meldungen in den News brauchen deinen Namen und deine E-Mail in `~/trader/config.json` bei `sec_user_agent` (z. B. `"Simon Marschke deine@mail.de"`). Ohne werden sie einfach übersprungen.
- Getestet mit den echten Tesla-Daten aus dem Skill (19.10.2026): Einstieg, Stop 358,32, Ziel 370,04, 8 Stück, Risiko-Check PASS, Order ausgeführt, Ziel automatisch verkauft.

---

## Gut zu wissen

- **Kosten:** Ein Denk-Schritt kostet ihn bei den Standardpreisen ca. 0,4 Cent. Wacht er alle 30 Minuten auf und denkt dabei 3-mal nach, sind das ca. 0,50 $ pro Tag, also ca. 15 $ im Monat. Damit er überlebt, muss er mindestens das mit Trading reinholen.
- **Kleine Modelle sind schwach:** `qwen3:8b` auf dem eigenen PC ist kostenlos, aber deutlich dümmer als Cloud-Modelle. Wenn er nur Unsinn macht, liegt es eher am Modell als an der Idee.
- **Schummeln wird erkannt:** Verändert der Agent die Kontodatei selbst, zeigt die Status-Seite dauerhaft "Manipuliert".
- **Alles wird protokolliert:** `fake-conway/data/journal.jsonl` enthält jeden Trade und jedes Nachdenken.
- **Der Agent kann Befehle ausführen.** Er läuft zwar in Ubuntu/WSL, kann aber trotzdem auf Windows-Dateien unter `/mnt/c` zugreifen. Lass ihn nicht unbeaufsichtigt tagelang laufen, bevor du gesehen hast, was er tut.
