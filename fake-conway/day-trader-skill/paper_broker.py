#!/usr/bin/env python3
"""Paper-Broker: verbindet den Day-Trader-Skill mit der Fake-Conway-Simulation.

Ersetzt im Simulator den Schritt "trader-broker" (Alpaca + Ja des Menschen).
Es sendet NUR Orders, die trader-risk heute genau so mit PASS geprüft hat,
und nur an die Simulation (Spielgeld). Mit echtem Geld darf dieser Weg nicht
benutzt werden: dort gehört das Ja eines Menschen vor jede Order.

    python3 ~/day-trader-skill/paper_broker.py sync              # Konto -> trader/portfolio.json, Budget anpassen
    python3 ~/day-trader-skill/paper_broker.py send              # alle READY-Orders an die Simulation
    python3 ~/day-trader-skill/paper_broker.py send --index 1    # nur Order 1
    python3 ~/day-trader-skill/paper_broker.py flatten TSLA      # Position sofort komplett verkaufen
    python3 ~/day-trader-skill/paper_broker.py status            # Börse, Konto, offene Stop/Ziel-Orders, Monatsfrist

Arbeitet im aktuellen Ordner (trader/ liegt dort). Nur Standardbibliothek.
"""

import argparse
import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get("FAKE_CONWAY_URL", "http://127.0.0.1:4242").rstrip("/")


def load_ticket():
    spec = importlib.util.spec_from_file_location("ticket", os.path.join(HERE, "trader-broker", "ticket.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode()).get("error")
        except Exception:
            msg = str(e)
        raise SystemExit("Simulation lehnt ab: %s" % msg)
    except urllib.error.URLError as e:
        raise SystemExit("Fake-Conway nicht erreichbar (%s): %s" % (BASE, e.reason))


def read(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def write(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def cmd_sync(_a):
    pf = api("GET", "/v1/paper/portfolio")
    positions = [{"symbol": p["symbol"], "shares": p["quantity"]} for p in pf.get("positions", [])]
    write("trader/portfolio.json", {"cash": round(pf["cashUsd"], 2), "positions": positions,
                                    "source": "fake-conway paper simulation"})
    cfg_path = "trader/config.json"
    cfg = read(cfg_path)
    if cfg is None:
        cfg = read(os.path.join(HERE, "paper-config.json"), {})
    # Budget = aktueller Gesamtwert, abgerundet (der Skill rechnet Positionsgrößen davon)
    cfg["budget"] = max(int(pf["equityUsd"]), 0)
    write(cfg_path, cfg)
    print("Konto synchronisiert: Cash %.2f $, Gesamtwert %.2f $, %d Positionen. Budget in trader/config.json = %d $."
          % (pf["cashUsd"], pf["equityUsd"], len(positions), cfg["budget"]))
    return 0


def cmd_send(a):
    t = load_ticket()
    ns = argparse.Namespace(orders="trader/orders.json", config="trader/config.json",
                            risk="trader/state/risk.json", state="trader/state/broker.json",
                            now=getattr(a, "now", None), today=None)
    try:
        orders, cfg, risk, state, today, now = t._load(ns)
    except t.TicketError as e:
        raise SystemExit(str(e))
    picks = [(a.index, orders[a.index - 1])] if a.index else list(enumerate(orders, 1))
    sent = 0
    for idx, order in picks:
        ready, label, rv = t.status_of(order, risk, state, today)
        if not ready:
            print("Order %d (%s) NICHT gesendet: %s" % (idx, t.plain(order), label))
            continue
        body = t.tool_input(order)
        flat_by = (order.get("plan") or {}).get("flat_by") or cfg.get("flat_by")
        if flat_by:
            body["flat_by"] = flat_by
        res = api("POST", "/v1/paper/order", body)
        loss, stop = t.max_loss(order)
        base = {"at": t.ny_iso(now), "date": today, "index": idx, "fingerprint": t.fingerprint(order),
                "symbol": str(order.get("symbol", "")).upper(), "side": order.get("side"),
                "qty": order.get("qty"), "kind": t.kind_of(order, rv), "max_loss": loss, "stop": stop,
                "plain": t.plain(order), "paper": True, "broker": "fake-conway"}
        state.setdefault("orders", []).append(dict(base, status="approved",
                                                   reply="paper simulation: sent by paper_broker.py after a risk PASS"))
        state["orders"].append(dict(base, status="placed", broker_order_id=res.get("id")))
        t.write_json(ns.state, state)
        sent += 1
        print("Order %d ausgeführt: %s -> %s Stück zu %.4f $ (id %s)%s"
              % (idx, t.plain(order), res.get("filled_qty"), res.get("filled_avg_price", 0), res.get("id"),
                 ", Stop/Ziel werden von der Simulation überwacht" if res.get("bracket") else ""))
    cmd_sync(a)
    if not sent:
        print("Keine Order gesendet. Erst trader-risk (check.py) laufen lassen; nur ein PASS von heute ist READY.")
        return 1
    return 0


def cmd_flatten(a):
    pf = api("GET", "/v1/paper/portfolio")
    sym = a.symbol.upper()
    pos = next((p for p in pf.get("positions", []) if p["symbol"] == sym), None)
    if not pos:
        raise SystemExit("Keine Position in %s." % sym)
    res = api("POST", "/v1/paper/order", {"symbol": sym, "side": "sell", "qty": str(pos["quantity"])})
    tr = res.get("trade", {})
    print("%s glattgestellt: %s Stück zu %.4f $, Gewinn/Verlust %.2f $." % (sym, res.get("filled_qty"),
                                                                            res.get("filled_avg_price", 0),
                                                                            tr.get("pnlUsd", 0)))
    cmd_sync(a)
    return 0


def cmd_status(_a):
    m = api("GET", "/v1/paper/market")
    pf = api("GET", "/v1/paper/portfolio")
    ch = pf.get("challenge") or {}
    print("US-Börse: %s (New York %s)" % ("OFFEN" if m["open"] else "geschlossen", m["newYorkTime"]))
    print("Cash %.2f $, Gesamtwert %.2f $" % (pf["cashUsd"], pf["equityUsd"]))
    for p in pf.get("positions", []):
        print("  %s: %s Stück, Wert %.2f $, G/V %.2f $" % (p["symbol"], p["quantity"], p["valueUsd"], p["unrealizedPnlUsd"]))
    for o in pf.get("openOrders", []):
        print("  Stop/Ziel %s: %s Stück, Stop %s, Ziel %s, glattstellen %s NY" % (o["symbol"], o["qty"], o["stop"], o["target"], o["flatBy"]))
    if ch.get("enabled"):
        print("Monatsfrist: Periode %s, noch %.1f Tage, bisher %+.2f %%, Ziel %.2f $ (noch nötig %.2f $)"
              % (ch["period"], ch["daysLeft"], ch["periodReturnPercent"], ch["targetEquityUsd"], ch["stillNeededUsd"]))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sync")
    p = sub.add_parser("send")
    p.add_argument("--index", type=int)
    p.add_argument("--now", help=argparse.SUPPRESS)  # nur für Tests: New-York-Zeit festlegen
    p = sub.add_parser("flatten")
    p.add_argument("symbol")
    sub.add_parser("status")
    a = ap.parse_args(argv)
    return {"sync": cmd_sync, "send": cmd_send, "flatten": cmd_flatten, "status": cmd_status}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
