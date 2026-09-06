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
      expected_model text,
      observed_model text,
      model_verdict text,
      matches_desired_model integer,
      reasoning_levels text not null,
      efforts_json text not null
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

def site_key(hostname):
    parts = [part for part in str(hostname or "").lower().split(".") if part]
    if len(parts) < 2:
        return ".".join(parts)
    suffix = ".".join(parts[-2:])
    return ".".join(parts[-3:]) if suffix in ("com.cn", "net.cn", "org.cn", "co.uk", "com.au") and len(parts) >= 3 else suffix

def homepage_matches_host(homepage, base_host):
    parsed = urlparse(homepage)
    return bool(parsed.hostname and base_host and site_key(parsed.hostname) == site_key(str(base_host).split(":")[0]))

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
        "homepage": clean_homepage(payload.get("homepage")) if homepage_matches_host(clean_homepage(payload.get("homepage")), host) else fallback_homepage(host),
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
            order = "last_test desc, average_score desc" if sort == "recent" else "average_score desc, last_test desc"
            conn = db()
            rows = conn.execute("""select a.base_host,
              (select b.provider_name from audits b where b.base_host = a.base_host
                and coalesce(nullif(b.expected_model, ''), b.model) = coalesce(nullif(a.expected_model, ''), a.model)
                order by b.id desc limit 1) as provider_name,
              (select b.homepage from audits b where b.base_host = a.base_host
                and coalesce(nullif(b.expected_model, ''), b.model) = coalesce(nullif(a.expected_model, ''), a.model)
                order by b.id desc limit 1) as homepage,
              coalesce(nullif(a.expected_model, ''), a.model) as model,
              (select b.expected_model from audits b where b.base_host = a.base_host
                and coalesce(nullif(b.expected_model, ''), b.model) = coalesce(nullif(a.expected_model, ''), a.model)
                order by b.id desc limit 1) as expected_model,
              (select b.observed_model from audits b where b.base_host = a.base_host
                and coalesce(nullif(b.expected_model, ''), b.model) = coalesce(nullif(a.expected_model, ''), a.model)
                order by b.id desc limit 1) as observed_model,
              (select b.model_verdict from audits b where b.base_host = a.base_host
                and coalesce(nullif(b.expected_model, ''), b.model) = coalesce(nullif(a.expected_model, ''), a.model)
                order by b.id desc limit 1) as model_verdict,
              (select b.matches_desired_model from audits b where b.base_host = a.base_host
                and coalesce(nullif(b.expected_model, ''), b.model) = coalesce(nullif(a.expected_model, ''), a.model)
                order by b.id desc limit 1) as matches_desired_model,
              max(score) as score, count(*) as samples, max(created_at) as last_test,
              round(avg(score), 1) as average_score,
              sum(case when assessment = 'conforming' then 1 else 0 end) as conforming_tests,
              sum(case when assessment = 'suspicious' then 1 else 0 end) as suspicious_tests
              from audits a
              group by a.base_host, coalesce(nullif(a.expected_model, ''), a.model)
              order by %s limit 100""" % order).fetchall()
            conn.close()
            items = []
            for index, row in enumerate(rows):
                item = dict(row)
                item["rank"] = index + 1
                item["homepage"] = clean_homepage(item.get("homepage")) or fallback_homepage(item.get("base_host"))
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
