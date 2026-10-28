---
name: day-trader
description: Paper day trading of US stocks with the Day Trader skill pack (scanner, entry, exit, time machine, budget, risk) against the Fake-Conway simulation.
auto-activate: true
---
Tools live in ~/day-trader-skill (plain Python, run with exec from your home folder, where trader/ lives).
Full docs of each step: cat ~/day-trader-skill/trader-NAME/SKILL.md (read only the one you need, it costs thinking).
Give the slower steps (scan, time machine) a bigger exec timeout, e.g. 300000.

US market hours only: Mon-Fri 09:30-16:00 New York (15:30-22:00 Germany). Outside, stocks cannot be traded: sleep until then.
Check first: python3 ~/day-trader-skill/paper_broker.py status

One trade, in this order. Stop at the first step that says no:
1. Sync account: python3 ~/day-trader-skill/paper_broker.py sync
2. Scan (after 09:50 NY): python3 ~/day-trader-skill/trader-scanner/scan.py orb --watchlist ~/day-trader-skill/paper-watchlist.txt
3. Entry: python3 ~/day-trader-skill/trader-entry/entry.py check SYMBOL --write   (must say triggered)
4. News: python3 ~/day-trader-skill/trader-news/news.py --tickers SYMBOL --hours 12 --no-sec   (skip on earnings or bad news)
5. Exit plan: python3 ~/day-trader-skill/trader-exit/exit.py plan --write   (stop and target)
6. Odds: python3 ~/day-trader-skill/trader-timemachine/timemachine.py run --write   (skip if stop-first is more likely than target-first)
7. Size: python3 ~/day-trader-skill/trader-budget/size.py --write   (a refusal means no trade)
8. Risk: python3 ~/day-trader-skill/trader-risk/check.py   (only PASS may continue)
9. Send: python3 ~/day-trader-skill/paper_broker.py send   (only sends orders that passed risk today)

After step 9 the simulation watches stop, target and the 15:55 NY flat-by time by itself, also while you sleep.
Get out early: python3 ~/day-trader-skill/paper_broker.py flatten SYMBOL

Rules:
- Never edit trader/config.json limits, trader/state/ files, or anything in ~/day-trader-skill. Never skip risk.
- At most 3 trades a day. No trade is a valid result. Most setups are close to a coin flip.
- Account is small: whole shares only, so pricey stocks will be refused. That is fine.
- Write each trade and its reason into your memory, including losses.
