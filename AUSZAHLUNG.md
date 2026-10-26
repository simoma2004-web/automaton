# Gründer-Auszahlung (deine Anpassung)

**Regel:**
- **Dein erster Agent** (den du selbst startest) zahlt **nie** etwas.
- **Jeder Klon** (Kinder, Enkel, …) zahlt einmal am Tag **5 % seines USDC-Überschusses** an deine Wallet –
  aber **nur, solange dein Schalter auf „an“ steht**.
- Überschuss = alles über **20 USDC Puffer**. Beträge unter 1 USDC werden übersprungen.
- Ausgezahlt wird in USDC auf Base.

Beispiel (Schalter an): Ein Klon hat 120 USDC → Überschuss 100 → 5 USDC gehen an dich, 115 bleiben bei ihm.

## Der Schalter: `auszahlung.json`

Die Datei liegt im Hauptordner **deines** GitHub-Repos. Jeder Klon liest sie einmal am Tag.

Aus (Startzustand – niemand zahlt, die Agenten bauen sich eine Grundlage auf):
```json
{
  "aktiv": false,
  "prozent": 5
}
```

An (z. B. wenn du siehst, dass es 10 Klone gibt):
```json
{
  "aktiv": true,
  "prozent": 5
}
```

Umschalten: auf github.com die Datei `auszahlung.json` öffnen → Stift-Symbol → `false` in `true` ändern →
„Commit changes“. Den Prozentsatz kannst du hier jederzeit ändern (maximal 25 %, mehr wird gedeckelt).

Sicherheit: Die Agenten haben keinen Zugang zu deinem GitHub und können den Schalter nicht ändern.
Ist die Datei nicht erreichbar oder kaputt, wird **nichts** ausgezahlt.

## In `src/payout/rules.ts` schon eingetragen

Dein GitHub-Name ist an beiden Stellen bereits eingesetzt:

1. `CHILD_REPO_URL = "https://github.com/simoma2004-web/automaton.git"`
2. `PAYOUT_SWITCH_URL = "https://raw.githubusercontent.com/simoma2004-web/automaton/main/auszahlung.json"`

Wichtig: Dein Repo muss **Public** bleiben und `automaton` heißen, sonst finden die Klone Code und Schalter nicht.

Außerdem braucht jeder zahlende Klon etwas **ETH auf Base für Gebühren** (Centbeträge).

## Was geändert wurde

| Datei | Was |
|---|---|
| `src/payout/rules.ts` | Regeln, Puffer, Repo-Adresse und Schalter-Adresse |
| `src/payout/creator-payout.ts` | Liest den Schalter und führt die USDC-Überweisung auf Base aus |
| `src/payout/child-setup.ts` | Gibt deine Adresse, Generation und Schalter-Adresse an jeden Klon weiter |
| `src/replication/spawn.ts` | Klone werden aus **deinem** Repo installiert |
| `src/heartbeat/daemon.ts` | Startet die Auszahlungsprüfung im Hintergrund |
| `src/self-mod/code.ts`, `src/agent/policy-rules/command-safety.ts` | Agenten dürfen diese Dateien und ihre genesis.json nicht ändern |
| `auszahlung.json` | Dein Schalter (Start: aus) |
| `src/__tests__/founder-payout.test.ts` | 19 Tests für die Regel |

## Grenzen (ehrlich)

- Wie viele Klone es gibt, musst du selbst beobachten – die Agenten kennen nur ihre direkten Kinder.
- Der Schutz vor Manipulation ist gut, aber nicht absolut; alles landet im Audit-Log.
- Die Regel bringt nur Geld, wenn Klone mehr verdienen als sie verbrauchen.
- Solana-Wallets werden nicht unterstützt (nur Base/EVM).
