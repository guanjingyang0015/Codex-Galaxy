#!/usr/bin/env python3
import argparse
import os
import sqlite3
from datetime import datetime, timezone
from urllib.parse import urlparse

DB_PATH = os.environ.get("RELAY_RANK_DB", "/opt/codex-galaxy-relay-rank/shared/rankings.sqlite3")

def valid_host(value):
    host = str(value or "").strip().lower()
    if not host or any(char not in "abcdefghijklmnopqrstuvwxyz0123456789.-:" for char in host):
        raise ValueError("invalid base host")
    return host

def valid_url(value):
    text = str(value or "").strip()
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("homepage must be a public http/https URL without credentials")
    return text

def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""create table if not exists link_overrides (
      base_host text primary key,
      homepage text not null,
      updated_at text not null
    )""")
    return conn

def main():
    parser = argparse.ArgumentParser(description="Owner-only ranking link overrides")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("list")
    set_parser = sub.add_parser("set")
    set_parser.add_argument("base_host")
    set_parser.add_argument("homepage")
    delete_parser = sub.add_parser("delete")
    delete_parser.add_argument("base_host")
    args = parser.parse_args()
    if not args.command:
        parser.error("a command is required")
    conn = connect()
    if args.command == "list":
        for host, homepage, updated_at in conn.execute("select base_host, homepage, updated_at from link_overrides order by base_host"):
            print(f"{host}\t{homepage}\t{updated_at}")
    elif args.command == "set":
        host = valid_host(args.base_host)
        homepage = valid_url(args.homepage)
        updated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        conn.execute("insert or replace into link_overrides (base_host, homepage, updated_at) values (?,?,?)", (host, homepage, updated_at))
        conn.commit()
        print(f"updated {host}")
    else:
        host = valid_host(args.base_host)
        conn.execute("delete from link_overrides where base_host = ?", (host,))
        conn.commit()
        print(f"deleted {host}")
    conn.close()

if __name__ == "__main__":
    main()
