#!/usr/bin/env python3
import json
import math
import os
import re
import sqlite3
import time
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
      reasoning_levels text not null,
      efforts_json text not null
    )""")
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

def site_key(hostname):
    parts = [part for part in str(hostname or "").lower().split(".") if part]
    if len(parts) < 2:
        return ".".join(parts)
    suffix = ".".join(parts[-2:])
    return ".".join(parts[-3:]) if suffix in ("com.cn", "net.cn", "org.cn", "co.uk", "com.au") and len(parts) >= 3 else suffix

def homepage_matches_host(homepage, base_host):
    parsed = urlparse(homepage)
    return bool(parsed.hostname and base_host and site_key(parsed.hostname) == site_key(str(base_host).split(":")[0]))

def calculate_score(payload):
    models_ok = int(payload.get("models_status") or 0) in range(200, 300)
    model_listed = bool(payload.get("model_listed"))
    efforts = payload.get("efforts") if isinstance(payload.get("efforts"), list) else []
    effort_ok = [x for x in efforts if isinstance(x, dict) and x.get("ok") and x.get("canary")]
    protocol = 25 if models_ok else 0
    model = 15 if model_listed else 0
    effort = round(len(effort_ok) / 4 * 25)
    stability = round(len(effort_ok) / max(1, len(efforts)) * 20)
    elapsed = [float(x.get("elapsed_ms")) for x in effort_ok if isinstance(x.get("elapsed_ms"), (int, float))]
    average = sum(elapsed) / len(elapsed) if elapsed else float("inf")
    speed = 15 if average <= 3000 else 12 if average <= 6000 else 8 if average <= 10000 else 4 if average <= 15000 else 1 if elapsed else 0
    score = max(0, min(100, protocol + model + effort + stability + speed))
    assessment = "conforming" if models_ok and model_listed and len(effort_ok) == len(efforts) == 4 else "inconclusive" if models_ok or effort_ok else "suspicious"
    return score, assessment, [protocol, model, effort, stability, speed]

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
        "homepage": clean_homepage(payload.get("homepage")) if homepage_matches_host(clean_homepage(payload.get("homepage")), host) else "",
        "model": model,
        "models_status": int(payload.get("models_status") or 0),
        "model_listed": bool(payload.get("model_listed")),
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
            order = "last_test desc, average_score desc" if sort == "recent" else "average_score desc, last_test desc"
            conn = db()
            rows = conn.execute("""select base_host, provider_name, homepage, model,
              max(score) as score, count(*) as samples, max(created_at) as last_test,
              round(avg(score), 1) as average_score,
              sum(case when assessment = 'conforming' then 1 else 0 end) as conforming_tests,
              sum(case when assessment = 'suspicious' then 1 else 0 end) as suspicious_tests
              from audits group by base_host, model order by %s limit 100""" % order).fetchall()
            conn.close()
            items = []
            for index, row in enumerate(rows):
                item = dict(row)
                item["rank"] = index + 1
                item["assessment"] = "conforming" if item["conforming_tests"] > item["suspicious_tests"] else "suspicious" if item["suspicious_tests"] > item["conforming_tests"] else "inconclusive"
                items.append(item)
            return self.json(200, {"items": items, "sort": sort})
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
            score, assessment, parts = calculate_score(data)
            conn = db()
            conn.execute("""insert into audits
              (created_at,base_host,provider_name,homepage,model,score,assessment,
               protocol_score,model_score,effort_score,stability_score,speed_score,
               models_count,model_listed,reasoning_levels,efforts_json)
              values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                now_iso(), data["base_host"], data["provider_name"], data["homepage"], data["model"],
                score, assessment, *parts, int(payload.get("models_count") or 0),
                int(data["model_listed"]), data["reasoning_levels"], json.dumps(data["efforts"], ensure_ascii=False)
            ))
            conn.commit()
            audit_id = conn.execute("select last_insert_rowid()").fetchone()[0]
            conn.close()
            return self.json(201, {"id": audit_id, "score": score, "assessment": assessment, "tested_at": now_iso()})
        except (ValueError, json.JSONDecodeError) as error:
            return self.json(400, {"error": clean_text(error, 180)})
        except Exception:
            return self.json(500, {"error": "server error"})

if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
