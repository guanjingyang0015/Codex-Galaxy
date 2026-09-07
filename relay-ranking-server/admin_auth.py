#!/usr/bin/env python3
import base64
import hashlib
import hmac
import json
import os
import secrets
import tempfile

ITERATIONS = 180000

def _encoded(value):
    return base64.urlsafe_b64encode(value).decode("ascii")

def _decoded(value):
    return base64.urlsafe_b64decode(str(value).encode("ascii"))

def build_record(username, password):
    user = str(username or "").strip()
    secret = str(password or "")
    if not user or len(user) > 80:
        raise ValueError("invalid username")
    if len(secret) < 8 or len(secret) > 256:
        raise ValueError("password must be 8-256 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt, ITERATIONS)
    return {
        "version": 1,
        "username": user,
        "salt": _encoded(salt),
        "iterations": ITERATIONS,
        "password_hash": _encoded(digest),
    }

def load_record(path):
    with open(path, "r", encoding="utf-8") as handle:
        record = json.load(handle)
    if not isinstance(record, dict):
        raise ValueError("invalid auth record")
    username = str(record.get("username") or "").strip()
    iterations = int(record.get("iterations") or 0)
    salt = _decoded(record.get("salt") or "")
    digest = _decoded(record.get("password_hash") or "")
    if not username or iterations < 100000 or len(salt) < 16 or len(digest) != 32:
        raise ValueError("invalid auth record")
    return {
        "version": int(record.get("version") or 1),
        "username": username,
        "salt": salt,
        "iterations": iterations,
        "password_hash": digest,
    }

def save_record(path, username, password):
    record = build_record(username, password)
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".admin-auth-", dir=parent, text=True)
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump({
                "version": record["version"],
                "username": record["username"],
                "salt": record["salt"],
                "iterations": record["iterations"],
                "password_hash": record["password_hash"],
            }, handle, ensure_ascii=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def verify_password(record, password):
    secret = str(password or "")
    digest = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), record["salt"], record["iterations"])
    return hmac.compare_digest(digest, record["password_hash"])
