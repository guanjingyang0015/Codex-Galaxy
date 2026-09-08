#!/usr/bin/env python3
import html
import http.cookies
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse
from socketserver import ThreadingMixIn

from admin_auth import load_record, verify_password
import topup_page

DB_PATH = os.environ.get("RELAY_RANK_DB", "/var/lib/codex-galaxy-relay-rank/rankings.sqlite3")
AUTH_PATH = os.environ.get("RELAY_RANK_ADMIN_AUTH", "/opt/codex-galaxy-relay-rank/shared/admin_auth.json")
SESSION_TTL = 8 * 60 * 60
LOGIN_WINDOW = 15 * 60
LOGIN_LIMIT = 8
SESSION_COOKIE = "__Host-cg_admin"
SESSIONS = {}
LOGIN_ATTEMPTS = {}
ADMIN_PATHS = {"/admin", "/admin/", "/admin/login", "/admin/set", "/admin/delete", "/admin/topup/save", "/admin/logout"}

def esc(value):
    return html.escape(str(value or ""), quote=True)

def clean_host(value):
    text = str(value or "").strip().lower()
    if not text or len(text) > 255:
        return ""
    if any(char not in "abcdefghijklmnopqrstuvwxyz0123456789.-:" for char in text):
        return ""
    return text

def clean_url(value):
    text = str(value or "").strip()
    parsed = urlparse(text)
    if len(text) > 500 or parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    if parsed.username or parsed.password:
        return ""
    return text

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""create table if not exists link_overrides (
      base_host text primary key,
      homepage text not null,
      updated_at text not null
    )""")
    conn.commit()
    return conn

def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def ranking_sites():
    conn = db()
    audits = conn.execute(
        """select a.base_host, a.provider_name, a.model, a.expected_model, a.created_at,
                  count(distinct coalesce(nullif(b.expected_model, ''), b.model)) as model_count
           from audits a
           inner join (
             select base_host, coalesce(nullif(expected_model, ''), model) as model_key, max(id) as id
             from audits
             group by base_host, coalesce(nullif(expected_model, ''), model)
           ) latest on latest.id = a.id
           left join audits b on b.base_host = a.base_host
           group by a.base_host, a.provider_name, a.model, a.expected_model, a.created_at
           order by lower(coalesce(a.provider_name, a.base_host)), a.base_host"""
    ).fetchall()
    overrides = {
        row["base_host"]: row["homepage"]
        for row in conn.execute("select base_host, homepage from link_overrides").fetchall()
    }
    conn.close()
    hosts = {row["base_host"] for row in audits}
    for host in overrides:
        if host not in hosts:
            audits.append({
                "base_host": host,
                "provider_name": host,
                "model": "",
                "expected_model": "",
                "created_at": "",
                "model_count": 0,
            })
    return [
        {
            "base_host": row["base_host"],
            "provider_name": row["provider_name"] or row["base_host"],
            "model": row["expected_model"] or row["model"] or "",
            "model_count": int(row["model_count"] or 0),
            "created_at": row["created_at"] or "",
            "customized": row["base_host"] in overrides,
            "homepage": overrides.get(row["base_host"]) or "https://" + row["base_host"] + "/",
        }
        for row in audits
    ]

def site_row(row, csrf):
    status_class = "custom" if row["customized"] else "default"
    status_text = "已自定义" if row["customized"] else "使用默认链接"
    model_text = ""
    if row["model_count"] > 1:
        model_text = f"<br><small>本站共 {row['model_count']} 个模型，链接共用</small>"
    elif row["model"]:
        model_text = f"<br><small>{esc(row['model'])}</small>"
    restore = "<small>尚未自定义</small>"
    if row["customized"]:
        restore = (
            "<form method='post' action='/admin/delete'>"
            f"<input type='hidden' name='csrf' value='{esc(csrf)}'>"
            "<input type='hidden' name='active_panel' value='ranking'>"
            f"<input type='hidden' name='base_host' value='{esc(row['base_host'])}'>"
            "<button>恢复默认</button></form>"
        )
    return (
        f"<tr><td><strong>{esc(row['provider_name'])}</strong><br><code>{esc(row['base_host'])}</code>{model_text}</td>"
        f"<td><span class='status {status_class}'>{status_text}</span>"
        "<form method='post' action='/admin/set'>"
        f"<input type='hidden' name='csrf' value='{esc(csrf)}'>"
        "<input type='hidden' name='active_panel' value='ranking'>"
        f"<input type='hidden' name='base_host' value='{esc(row['base_host'])}'>"
        f"<input name='homepage' type='url' value='{esc(row['homepage'])}' required>"
        "<button>保存</button></form></td>"
        f"<td><a href='{esc(row['homepage'])}' target='_blank' rel='noreferrer'>{esc(row['homepage'])}</a></td>"
        f"<td>{restore}</td></tr>"
    )

def page(csrf="", message="", error="", active_panel="ranking"):
    try:
        rows = ranking_sites()
    except sqlite3.Error:
        rows = []
        error = "数据库暂时不可用"
    rows_html = "".join(site_row(row, csrf) for row in rows)
    try:
        topup_editor = topup_page.admin_editor(topup_page.load_settings(DB_PATH), csrf)
    except sqlite3.Error:
        topup_editor = '<div class="card"><h2>GPT 代充展示页</h2><p class="err">展示页配置暂时不可用</p></div>'
    active_panel = "topup" if active_panel == "topup" else "ranking"
    ranking_checked = " checked" if active_panel == "ranking" else ""
    topup_checked = " checked" if active_panel == "topup" else ""
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codex Galaxy 管理后台</title>
<style>
body{{font:15px system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1015;color:#e8edf2;margin:0;padding:32px}}
main{{max-width:1080px;margin:auto}}h1{{font-size:24px;margin-bottom:6px}}
.card{{background:#141b22;border:1px solid #2b3742;border-radius:12px;padding:20px;margin:18px 0}}
label{{display:block;margin:10px 0 5px;color:#aebbc7}}
input,textarea{{box-sizing:border-box;width:100%;padding:10px;border:1px solid #3a4855;border-radius:7px;background:#0d1319;color:#fff;font:inherit}}
textarea{{min-height:84px;resize:vertical}}.products-editor{{min-height:180px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}}
button{{padding:9px 13px;border:0;border-radius:7px;background:#67d39b;color:#07120d;font-weight:700;cursor:pointer}}
table{{width:100%;border-collapse:collapse}}th,td{{text-align:left;padding:11px 8px;border-bottom:1px solid #2b3742;vertical-align:top}}
td form{{display:flex;gap:7px;margin-top:8px}}td form input{{min-width:0;flex:1}}td form button{{white-space:nowrap}}
.editor-grid{{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}}.editor-grid .wide{{grid-column:1/-1}}
.panel-radio{{position:absolute;opacity:0;pointer-events:none}}.panel-switcher{{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:24px 0 4px}}
.panel-tab{{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 16px;border:1px solid #33414e;border-radius:12px;background:#121920;color:#b9c5ce;cursor:pointer;transition:.18s ease}}
.panel-tab strong{{display:block;color:#eef4f7;font-size:16px}}.panel-tab small{{white-space:nowrap}}.panel-tab:hover{{border-color:#4c6b60;background:#17221e}}
#panel-ranking:checked~.panel-switcher label[for=panel-ranking],#panel-topup:checked~.panel-switcher label[for=panel-topup]{{border-color:#67d39b;background:linear-gradient(135deg,#183228,#14241e);box-shadow:0 0 0 1px #67d39b33,0 10px 28px #0004}}
#panel-ranking:checked~.panel-switcher label[for=panel-ranking] strong,#panel-topup:checked~.panel-switcher label[for=panel-topup] strong{{color:#87efb6}}
.panel-content{{display:none}}#panel-ranking:checked~.panels .ranking-panel,#panel-topup:checked~.panels .topup-panel{{display:block}}.table-wrap{{overflow-x:auto}}
.status{{display:inline-block;padding:3px 7px;border-radius:99px;font-size:12px;font-weight:700}}
.status.custom{{background:#264b3b;color:#8ef0b5}}.status.default{{background:#303b47;color:#c4d0da}}
a{{color:#79b7ff;overflow-wrap:anywhere}}code{{color:#d9e2ea}}.ok{{color:#67d39b}}.err{{color:#ff8e8e}}small{{color:#9ba8b4}}
@media(max-width:680px){{body{{padding:18px}}.panel-switcher{{grid-template-columns:1fr}}.panel-tab small{{white-space:normal}}.editor-grid{{grid-template-columns:1fr}}.editor-grid .wide{{grid-column:auto}}}}
</style></head><body><main>
<h1>Codex Galaxy 管理后台</h1>
<p><small>选择一个板块进行管理，无需滚动查找另一项功能。</small></p>
{f'<p class="ok">{esc(message)}</p>' if message else ''}
{f'<p class="err">{esc(error)}</p>' if error else ''}
<input class="panel-radio" type="radio" name="admin_panel" id="panel-ranking"{ranking_checked}>
<input class="panel-radio" type="radio" name="admin_panel" id="panel-topup"{topup_checked}>
<div class="panel-switcher" role="tablist" aria-label="管理板块">
<label class="panel-tab" for="panel-ranking" role="tab"><strong>API 排行榜</strong><small>站点与跳转链接</small></label>
<label class="panel-tab" for="panel-topup" role="tab"><strong>GPT 代充展示页</strong><small>文案、流程与价格</small></label>
</div><div class="panels"><section class="panel-content ranking-panel">
<div class="card"><h2>新增或修改链接</h2>
<form method="post" action="/admin/set">
<input type="hidden" name="csrf" value="{esc(csrf)}">
<input type="hidden" name="active_panel" value="ranking">
<label>Base host</label><input name="base_host" placeholder="例如 api.example.com" required>
<label>跳转网址</label><input name="homepage" type="url" placeholder="https://example.com/" required>
<p><button>保存链接</button></p></form></div>
<div class="card"><h2>排行榜网站链接</h2>
<p><small>这里会显示所有已经出现在排行榜中的站点和模型条目。绿色“已自定义”表示当前使用的是你设置的链接；灰色表示仍使用默认 API 域名。同一网站的多个模型共用同一个跳转链接。</small></p>
<div class="table-wrap"><table><thead><tr><th>网站 / 模型</th><th>状态与编辑</th><th>当前生效链接</th><th>恢复</th></tr></thead>
<tbody>{rows_html or '<tr><td colspan="4"><small>排行榜暂时没有网站记录。</small></td></tr>'}</tbody>
</table></div></div></section><section class="panel-content topup-panel">{topup_editor}</section></div>
<form method="post" action="/admin/logout">
<input type="hidden" name="csrf" value="{esc(csrf)}"><button>退出登录</button>
</form></main></body></html>"""

def login_page(error=""):
    return f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codex Galaxy 管理后台登录</title>
<style>body{{font:15px system-ui;background:#0b1015;color:#e8edf2;margin:0;padding:32px}}
main{{max-width:420px;margin:10vh auto;background:#141b22;border:1px solid #2b3742;border-radius:12px;padding:24px}}
label{{display:block;margin:12px 0 5px;color:#aebbc7}}
input{{box-sizing:border-box;width:100%;padding:10px;background:#0d1319;color:#fff;border:1px solid #3a4855;border-radius:7px}}
button{{margin-top:16px;padding:10px 14px;border:0;border-radius:7px;background:#67d39b;font-weight:700}}
.err{{color:#ff8e8e}}</style></head><body><main>
<h1>Codex Galaxy 管理后台登录</h1>{f'<p class="err">{esc(error)}</p>' if error else ''}
<form method="post" action="/admin/login">
<label>用户名</label><input name="username" autocomplete="username" required>
<label>密码</label><input name="password" type="password" autocomplete="current-password" required>
<button>登录</button></form></main></body></html>"""

def send_html(handler, body, status=200, cookie=None, clear_cookie=False):
    encoded = body.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(encoded)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Pragma", "no-cache")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("X-Frame-Options", "DENY")
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.send_header("Strict-Transport-Security", "max-age=31536000")
    handler.send_header(
        "Content-Security-Policy",
        "default-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    )
    if cookie:
        handler.send_header(
            "Set-Cookie",
            f"{SESSION_COOKIE}={cookie}; Path=/; Max-Age={SESSION_TTL}; HttpOnly; Secure; SameSite=Strict",
        )
    if clear_cookie:
        handler.send_header(
            "Set-Cookie",
            f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
        )
    handler.end_headers()
    handler.wfile.write(encoded)

def redirect(handler, location, cookie=None, clear_cookie=False):
    handler.send_response(303)
    if cookie:
        handler.send_header(
            "Set-Cookie",
            f"{SESSION_COOKIE}={cookie}; Path=/; Max-Age={SESSION_TTL}; HttpOnly; Secure; SameSite=Strict",
        )
    if clear_cookie:
        handler.send_header(
            "Set-Cookie",
            f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
        )
    handler.send_header("Location", location)
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()

def read_form(handler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        length = 0
    if length <= 0 or length > 65536:
        raise ValueError("请求无效")
    return {
        key: values[0]
        for key, values in parse_qs(
            handler.rfile.read(length).decode("utf-8"), keep_blank_values=True
        ).items()
    }

def client_ip(handler):
    forwarded = str(handler.headers.get("CF-Connecting-IP") or "").strip()
    if re.fullmatch(r"[0-9a-fA-F:.]{3,64}", forwarded):
        return forwarded
    return handler.client_address[0]

def session_for(handler):
    now = time.time()
    for token, session in list(SESSIONS.items()):
        if session["expires"] <= now:
            SESSIONS.pop(token, None)
    cookies = http.cookies.SimpleCookie()
    cookies.load(handler.headers.get("Cookie", ""))
    token = cookies.get(SESSION_COOKIE)
    if not token or token.value not in SESSIONS:
        return None
    session = SESSIONS[token.value]
    session["expires"] = now + SESSION_TTL
    return session

def csrf_ok(form, session):
    return secrets.compare_digest(str(form.get("csrf") or ""), session["csrf"])

def handle_get(handler):
    path = urlparse(handler.path).path
    if path in ("/topup", "/topup/"):
        send_html(handler, topup_page.public_page(topup_page.load_settings(DB_PATH)))
        return True
    if path == "/topup/qr.svg":
        asset_path = os.path.join(os.path.dirname(__file__), "topup-qr.svg")
        try:
            body = open(asset_path, "rb").read()
        except OSError:
            send_html(handler, "not found", 404)
            return True
        handler.send_response(200)
        handler.send_header("Content-Type", "image/svg+xml")
        handler.send_header("Content-Length", str(len(body)))
        handler.send_header("Cache-Control", "public, max-age=3600")
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.send_header("Content-Security-Policy", "default-src 'none'; img-src data:")
        handler.end_headers()
        handler.wfile.write(body)
        return True
    if path not in ("/admin", "/admin/"):
        return False
    session = session_for(handler)
    query = parse_qs(urlparse(handler.path).query)
    active_panel = "topup" if query.get("panel", [""])[0] == "topup" else "ranking"
    send_html(handler, page(csrf=session["csrf"], active_panel=active_panel) if session else login_page())
    return True

def handle_post(handler):
    path = urlparse(handler.path).path
    if path not in ADMIN_PATHS:
        return False
    if path == "/admin/login":
        try:
            form = read_form(handler)
        except ValueError as error:
            send_html(handler, login_page(str(error)), 400)
            return True
        ip = client_ip(handler)
        now = time.time()
        attempts = [stamp for stamp in LOGIN_ATTEMPTS.get(ip, []) if now - stamp < LOGIN_WINDOW]
        if len(attempts) >= LOGIN_LIMIT:
            send_html(handler, login_page("登录尝试过多，请稍后再试"), 429)
            return True
        try:
            record = load_record(AUTH_PATH)
            username_valid = secrets.compare_digest(
                str(form.get("username") or ""), record["username"]
            )
            password_valid = verify_password(record, form.get("password"))
            valid = username_valid and password_valid
        except Exception:
            valid = False
        if not valid:
            attempts.append(now)
            LOGIN_ATTEMPTS[ip] = attempts
            send_html(handler, login_page("用户名或密码错误"), 401)
            return True
        LOGIN_ATTEMPTS.pop(ip, None)
        token = secrets.token_urlsafe(32)
        SESSIONS[token] = {"csrf": secrets.token_urlsafe(24), "expires": now + SESSION_TTL}
        redirect(handler, "/admin/", cookie=token)
        return True

    session = session_for(handler)
    if not session:
        send_html(handler, login_page("登录已失效，请重新登录"), 401)
        return True
    try:
        form = read_form(handler)
        active_panel = "topup" if form.get("active_panel") == "topup" else "ranking"
        if not csrf_ok(form, session):
            raise ValueError("会话校验失败")
        if path == "/admin/set":
            host = clean_host(form.get("base_host"))
            homepage = clean_url(form.get("homepage"))
            if not host or not homepage:
                raise ValueError("Base host 或网址格式不正确")
            conn = db()
            conn.execute(
                "insert or replace into link_overrides (base_host, homepage, updated_at) values (?,?,?)",
                (host, homepage, now_iso()),
            )
            conn.commit()
            conn.close()
            send_html(handler, page(csrf=session["csrf"], message="链接已保存", active_panel="ranking"))
            return True
        if path == "/admin/delete":
            host = clean_host(form.get("base_host"))
            if not host:
                raise ValueError("Base host 格式不正确")
            conn = db()
            conn.execute("delete from link_overrides where base_host = ?", (host,))
            conn.commit()
            conn.close()
            send_html(handler, page(csrf=session["csrf"], message="已恢复默认链接", active_panel="ranking"))
            return True
        if path == "/admin/topup/save":
            topup_page.save_settings(DB_PATH, form)
            send_html(handler, page(csrf=session["csrf"], message="代充展示页已保存", active_panel="topup"))
            return True
        if path == "/admin/logout":
            cookies = http.cookies.SimpleCookie()
            cookies.load(handler.headers.get("Cookie", ""))
            token = cookies.get(SESSION_COOKIE)
            if token:
                SESSIONS.pop(token.value, None)
            redirect(handler, "/admin/", clear_cookie=True)
            return True
        send_html(handler, "not found", 404)
        return True
    except ValueError as error:
        send_html(handler, page(csrf=session["csrf"], error=str(error), active_panel=locals().get("active_panel", "ranking")), 400)
        return True
    except Exception:
        send_html(handler, page(csrf=session["csrf"], error="操作失败", active_panel=locals().get("active_panel", "ranking")), 500)
        return True

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        return

    def do_GET(self):
        if not handle_get(self):
            send_html(self, "not found", 404)

    def do_POST(self):
        if not handle_post(self):
            send_html(self, "not found", 404)

if __name__ == "__main__":
    host = os.environ.get("RELAY_RANK_ADMIN_HOST", "127.0.0.1")
    port = int(os.environ.get("RELAY_RANK_ADMIN_PORT", "18111"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()
