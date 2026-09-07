#!/usr/bin/env python3
import argparse
import getpass
import os
import sys

from admin_auth import save_record

DEFAULT_PATH = "/opt/codex-galaxy-relay-rank/shared/admin_auth.json"

def main():
    parser = argparse.ArgumentParser(description="Initialize or replace the ranking admin credential hash")
    parser.add_argument("--path", default=os.environ.get("RELAY_RANK_ADMIN_AUTH", DEFAULT_PATH))
    parser.add_argument("--username")
    parser.add_argument("--password-stdin", action="store_true")
    args = parser.parse_args()
    username = str(args.username or input("Admin username: ")).strip()
    if args.password_stdin:
        password = sys.stdin.readline().rstrip("\r\n")
        confirmation = sys.stdin.readline().rstrip("\r\n")
    else:
        password = getpass.getpass("Admin password: ")
        confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        raise SystemExit("passwords do not match")
    save_record(args.path, username, password)
    print("admin credential hash saved")

if __name__ == "__main__":
    main()
