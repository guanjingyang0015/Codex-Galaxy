#!/usr/bin/env python3
import json
import os
import re
import sqlite3
import time
import calendar
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, urlparse

HOST = os.environ.get("RELAY_RANK_HOST", "127.0.0.1")
PORT = int(os.environ.get("RELAY_RANK_PORT", "18110"))
DB_PATH = os.environ.get("RELAY_RANK_DB", "/var/lib/codex-galaxy-relay-rank/rankings.sqlite3")
MAX_BODY = 64 * 1024
RATE_WINDOW = 3600
RATE_LIMIT = 30
RATE = {}

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""create table if not exists audits (
      id integer primary key autoincrement,
      created_at text not null,
      base_host text not null,
      provider_name text not null,
      homepage text,
      model text not null,
      score integer not null,
      assessment text not null,
      protocol_score integer not null,
      model_score integer not null,
      effort_score integer not null,
      stability_score integer not null,
      speed_score integer not null,
      models_count integer not null,
      model_listed integer not null,
      expected_model text,
      observed_model text,
      model_verdict text,
      matches_desired_model integer,
      reasoning_levels text not null,
      efforts_json text not null
    )""")
    conn.execute("""create table if not exists link_overrides (
      base_host text primary key,
      homepage text not null,
      updated_at text not null
    )""")
    for column, definition in (
        ("expected_model", "text"),
        ("observed_model", "text"),
        ("model_verdict", "text"),
        ("matches_desired_model", "integer"),
    ):
        try:
            conn.execute(f"alter table audits add column {column} {definition}")
        except sqlite3.OperationalError:
            pass
    conn.commit()
    return conn

def clean_text(value, limit=160):
    text = str(value or "").strip()
    return text[:limit]

def clean_host(value):
    host = clean_text(value, 255).lower()
    host = re.sub(r"[^a-z0-9.\-:\[\]]", "", host)
    return host

def clean_homepage(value):
    text = clean_text(value, 500)
    if not text:
        return ""
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
        return ""
    return text

def normalized_model(value):
    text = clean_text(value, 160).lower()
    return text.rsplit("/", 1)[-1]

def model_relation(expected, actual):
    left = normalized_model(expected)
    right = normalized_model(actual)
    if not left or not right:
        return "unknown"
    if left == right:
        return "exact"
    separators = ("-", "_", ".", ":", "@")
    if any(right.startswith(left + separator) for separator in separators) or any(left.startswith(right + separator) for separator in separators):
        return "compatible"
    left_gpt = re.match(r"^gpt[-_.]?(\d+(?:\.\d+)?)(?:$|[-_.:@])", left)
    right_gpt = re.match(r"^gpt[-_.]?(\d+(?:\.\d+)?)(?:$|[-_.:@])", right)
    if left_gpt and right_gpt and left_gpt.group(1) == right_gpt.group(1):
        return "compatible"
    return "mismatch"

def model_verdict(expected, observed, model_listed):
    if not expected:
        return "unspecified"
    relation = model_relation(expected, observed)
    if relation in ("exact", "compatible", "mismatch"):
        return relation
    return "listed-only" if model_listed else "unverified"

def fallback_homepage(base_host):
    host = clean_host(base_host)
    if not host:
        return ""
    return "https://" + host + "/"

def timestamp(value):
    try:
        return calendar.timegm(time.strptime(str(value or "")[:19], "%Y-%m-%dT%H:%M:%S"))
    except (TypeError, ValueError):
        return 0

def calculate_score(payload):
    models_ok = int(payload.get("models_status") or 0) in range(200, 300)
    model_listed = bool(payload.get("expected_model_listed") if "expected_model_listed" in payload else payload.get("model_listed"))
    efforts = payload.get("efforts") if isinstance(payload.get("efforts"), list) else []
    effort_ok = [x for x in efforts if isinstance(x, dict) and x.get("ok") and x.get("canary")]
    model_verdict_value = model_verdict(payload.get("expected_model"), payload.get("observed_model"), model_listed)
    protocol = 10 if models_ok else 0
    model = 40 if model_verdict_value == "exact" else 34 if model_verdict_value == "compatible" else 24 if model_verdict_value == "listed-only" else 20 if model_verdict_value == "unspecified" else 0
    effort = round(len(effort_ok) / max(1, len(efforts)) * 15)
    http_ok = [x for x in efforts if isinstance(x, dict) and x.get("ok")]
    timeouts = sum(1 for x in efforts if isinstance(x, dict) and int(x.get("status") or 0) == 0)
    stability = max(0, round(len(http_ok) / max(1, len(efforts)) * 10) - min(3, timeouts))
    elapsed = [float(x.get("elapsed_ms")) for x in effort_ok if isinstance(x.get("elapsed_ms"), (int, float))]
    average = sum(elapsed) / len(elapsed) if elapsed else float("inf")
    speed = 10 if average <= 3000 else 8 if average <= 6000 else 6 if average <= 10000 else 3 if average <= 15000 else 1 if elapsed else 0
    responses = (8 if http_ok else 0) + round(sum(1 for x in efforts if isinstance(x, dict) and x.get("has_response_id")) / max(1, len(efforts)) * 4) + round(sum(1 for x in efforts if isinstance(x, dict) and x.get("usage")) / max(1, len(efforts)) * 3)
    before_cap = protocol + model + responses + effort + stability + speed
    cap = 49 if model_verdict_value == "mismatch" else 59 if model_verdict_value == "unverified" else 79 if model_verdict_value == "listed-only" else 80 if model_verdict_value == "unspecified" else 100
    score = max(0, min(cap, before_cap))
    assessment = "conforming" if model_verdict_value in ("exact", "compatible") and score >= 85 and len(effort_ok) == len(efforts) else "suspicious" if model_verdict_value == "mismatch" or score < 50 else "inconclusive"
    return score, assessment, [protocol + responses, model, effort, stability, speed], model_verdict_value

def validate_audit(payload):
    if not isinstance(payload, dict):
        raise ValueError("invalid json")
    if payload.get("api_key") or payload.get("key") or payload.get("token") or payload.get("secret"):
        raise ValueError("secrets are not accepted")
    host = clean_host(payload.get("base_host"))
    model = clean_text(payload.get("model"), 160)
    if not host or not model:
        raise ValueError("base_host and model are required")
    efforts = payload.get("efforts") if isinstance(payload.get("efforts"), list) else []
    if len(efforts) > 4:
        raise ValueError("too many efforts")
    return {
        "base_host": host,
        "provider_name": clean_text(payload.get("provider_name") or host, 100),
        "homepage": fallback_homepage(host),
        "model": model,
        "expected_model": clean_text(payload.get("expected_model"), 160),
        "observed_model": clean_text(payload.get("observed_model"), 160),
        "model_verdict": clean_text(payload.get("model_verdict"), 24) or "unverified",
        "matches_desired_model": True if payload.get("matches_desired_model") is True else False if payload.get("matches_desired_model") is False else None,
        "models_status": int(payload.get("models_status") or 0),
        "model_listed": bool(payload.get("model_listed")),
        "expected_model_listed": bool(payload.get("expected_model_listed") if "expected_model_listed" in payload else payload.get("model_listed")),
        "reasoning_levels": json.dumps(payload.get("declared_reasoning_levels") or [], ensure_ascii=False),
        "efforts": efforts,
    }

class Handler(BaseHTTPRequestHandler):
    server_version = "CodexGalaxyRelayRank/1.0"
    def log_message(self, *_):
        return

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")

    def json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def allowed(self):
        key = self.client_address[0]
        now = time.time()
        entries = [x for x in RATE.get(key, []) if now - x < RATE_WINDOW]
        if len(entries) >= RATE_LIMIT:
            RATE[key] = entries
            return False
        entries.append(now)
        RATE[key] = entries
        return True

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            return self.json(200, {"ok": True, "service": "codex-galaxy-relay-rank"})
        if parsed.path == "/api/v1/rankings":
            query = parse_qs(parsed.query)
            sort = clean_text((query.get("sort") or ["overall"])[0], 20)
            model_filter = clean_text((query.get("model") or [""])[0], 160)
            conn = db()
            rows = [dict(row) for row in conn.execute("select * from audits order by id asc").fetchall()]
            overrides = {row["base_host"]: row["homepage"] for row in conn.execute("select base_host, homepage from link_overrides").fetchall()}
            conn.close()
            models = sorted(set(clean_text(row.get("expected_model") or row.get("model"), 160) for row in rows if row.get("expected_model") or row.get("model")))
            if model_filter:
                rows = [row for row in rows if normalized_model(row.get("expected_model") or row.get("model")) == normalized_model(model_filter)]
            now = time.time()
            cutoff_7d = now - 7 * 86400
            cutoff_90d = now - 90 * 86400
            grouped = {}
            for row in rows:
                model_key = normalized_model(row.get("expected_model") or row.get("model"))
                grouped.setdefault((row.get("base_host"), model_key), []).append(row)
            items = []
            for (base_host, _model_key), group_rows in grouped.items():
                latest = max(group_rows, key=lambda row: (timestamp(row.get("created_at")), int(row.get("id") or 0)))
                recent = [row for row in group_rows if timestamp(row.get("created_at")) >= cutoff_7d]
                candidates = recent or [latest]
                winner = max(candidates, key=lambda row: (int(row.get("score") or 0), timestamp(row.get("created_at")), int(row.get("id") or 0)))
                history_rows = [row for row in group_rows if timestamp(row.get("created_at")) >= cutoff_90d]
                history_90d_max = max([int(row.get("score") or 0) for row in history_rows] or [int(winner.get("score") or 0)])
                item = {
                    "base_host": base_host,
                    "provider_name": latest.get("provider_name") or base_host,
                    "homepage": clean_homepage(overrides.get(base_host)) or fallback_homepage(base_host),
                    "model": winner.get("expected_model") or winner.get("model"),
                    "expected_model": winner.get("expected_model"),
                    "observed_model": winner.get("observed_model"),
                    "model_verdict": winner.get("model_verdict"),
                    "matches_desired_model": winner.get("matches_desired_model"),
                    "score": int(winner.get("score") or 0),
                    "ranking_score": int(winner.get("score") or 0),
                    "history_90d_max": history_90d_max,
                    "samples": len(group_rows),
                    "recent_7d_samples": len(recent),
                    "last_test": latest.get("created_at"),
                    "winning_test": winner.get("created_at"),
                    "protocol_score": int(winner.get("protocol_score") or 0),
                    "model_score": int(winner.get("model_score") or 0),
                    "effort_score": int(winner.get("effort_score") or 0),
                    "stability_score": int(winner.get("stability_score") or 0),
                    "speed_score": int(winner.get("speed_score") or 0),
                    "assessment": winner.get("assessment") or "inconclusive",
                }
                items.append(item)
            if sort == "recent":
                items.sort(key=lambda item: (timestamp(item.get("last_test")), item.get("ranking_score", 0)), reverse=True)
            else:
                items.sort(key=lambda item: (item.get("ranking_score", 0), timestamp(item.get("last_test"))), reverse=True)
            for index, item in enumerate(items[:100]):
                item["rank"] = index + 1
            items = items[:100]
            history_90d_max = max([int(row.get("score") or 0) for row in rows if timestamp(row.get("created_at")) >= cutoff_90d] or [0])
            return self.json(200, {"items": items, "sort": sort, "model": model_filter, "models": models, "history_90d_max": history_90d_max})
        if parsed.path == "/":
            return self.json(200, {"service": "Codex Galaxy Relay Ranking", "endpoints": ["/health", "/api/v1/rankings", "/api/v1/audits"]})
        return self.json(404, {"error": "not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/api/v1/audits":
            return self.json(404, {"error": "not found"})
        if not self.allowed():
            return self.json(429, {"error": "rate limited"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise ValueError("invalid body size")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            data = validate_audit(payload)
            score, assessment, parts, verified_model_verdict = calculate_score(data)
            conn = db()
            conn.execute("""insert into audits
              (created_at,base_host,provider_name,homepage,model,score,assessment,
               protocol_score,model_score,effort_score,stability_score,speed_score,
               models_count,model_listed,expected_model,observed_model,model_verdict,matches_desired_model,reasoning_levels,efforts_json)
              values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                now_iso(), data["base_host"], data["provider_name"], data["homepage"], data["model"],
                score, assessment, *parts, int(payload.get("models_count") or 0),
                int(data["expected_model_listed"]), data["expected_model"], data["observed_model"], verified_model_verdict,
                1 if verified_model_verdict in ("exact", "compatible") else 0 if verified_model_verdict == "mismatch" else None,
                data["reasoning_levels"], json.dumps(data["efforts"], ensure_ascii=False)
            ))
            conn.commit()
            audit_id = conn.execute("select last_insert_rowid()").fetchone()[0]
            conn.close()
            return self.json(201, {"id": audit_id, "score": score, "assessment": assessment, "model_verdict": verified_model_verdict, "tested_at": now_iso()})
        except (ValueError, json.JSONDecodeError) as error:
            return self.json(400, {"error": clean_text(error, 180)})
        except Exception:
            return self.json(500, {"error": "server error"})

if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
