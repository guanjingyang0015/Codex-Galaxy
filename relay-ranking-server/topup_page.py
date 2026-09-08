#!/usr/bin/env python3
import html
import json
import sqlite3
from datetime import datetime, timezone

DEFAULT_SETTINGS = {
    "badge": "CODEX GALAXY · GPT 代充",
    "title": "选择适合你的 GPT 套餐",
    "subtitle": "会员代充、Codex 相关服务和 API 额度集中展示。无需注册，先查看价格，再扫码咨询。",
    "notice": "本页面仅展示套餐与价格。请先与客服确认库存、适用账号和处理时间，再决定是否办理。",
    "qr_title": "扫码联系代充客服",
    "qr_caption": "扫码后发送套餐名称，客服会确认库存、账号要求和处理时间。",
    "footer_note": "价格与库存以本页面实时显示和客服最终确认为准。Codex Galaxy 不会在此页面收集账号密码。",
    "steps": ["选择需要的套餐", "扫描二维码添加客服", "发送套餐名称并确认充值信息"],
    "products": [
        {"name": "GPT Pro 20x", "price": "¥1250", "unit": "/月", "description": "适合高频创作、代码与研究场景", "status": "可咨询"},
        {"name": "GPT Pro 5x", "price": "¥750", "unit": "/月", "description": "适合中高频 AI 工作流", "status": "可咨询"},
        {"name": "GPT Plus", "price": "¥145", "unit": "/月", "description": "适合日常对话、写作与轻量代码", "status": "可咨询"},
        {"name": "Codex 手机号接码", "price": "¥10", "unit": "/60天", "description": "Codex 手机号接码相关服务", "status": "可咨询"},
        {"name": "API 50 美金额度", "price": "¥45", "unit": "/份", "description": "API 额度相关服务", "status": "暂时缺货"},
        {"name": "API 100 美金额度", "price": "¥90", "unit": "/份", "description": "API 额度相关服务", "status": "暂时缺货"},
    ],
}

MAX_PRODUCTS = 12


def esc(value):
    return html.escape(str(value or ""), quote=True)


def clean_text(value, limit):
    return str(value or "").strip()[:limit]


def normalized_settings(value):
    source = value if isinstance(value, dict) else {}
    products = []
    for item in source.get("products", []):
        if not isinstance(item, dict):
            continue
        product = {
            "name": clean_text(item.get("name"), 80),
            "price": clean_text(item.get("price"), 40),
            "unit": clean_text(item.get("unit"), 30),
            "description": clean_text(item.get("description"), 180),
            "status": clean_text(item.get("status"), 40),
        }
        if product["name"] and product["price"]:
            products.append(product)
        if len(products) >= MAX_PRODUCTS:
            break
    if not products:
        products = [dict(item) for item in DEFAULT_SETTINGS["products"]]
    steps = [clean_text(item, 100) for item in source.get("steps", [])]
    steps = [item for item in steps if item][:3]
    while len(steps) < 3:
        steps.append(DEFAULT_SETTINGS["steps"][len(steps)])
    return {
        "badge": clean_text(source.get("badge") or DEFAULT_SETTINGS["badge"], 80),
        "title": clean_text(source.get("title") or DEFAULT_SETTINGS["title"], 100),
        "subtitle": clean_text(source.get("subtitle") or DEFAULT_SETTINGS["subtitle"], 240),
        "notice": clean_text(source.get("notice") or DEFAULT_SETTINGS["notice"], 300),
        "qr_title": clean_text(source.get("qr_title") or DEFAULT_SETTINGS["qr_title"], 100),
        "qr_caption": clean_text(source.get("qr_caption") or DEFAULT_SETTINGS["qr_caption"], 220),
        "footer_note": clean_text(source.get("footer_note") or DEFAULT_SETTINGS["footer_note"], 240),
        "steps": steps,
        "products": products,
    }


def ensure_table(connection):
    connection.execute(
        """create table if not exists topup_settings (
          id integer primary key check (id = 1),
          payload text not null,
          updated_at text not null
        )"""
    )


def load_settings(db_path):
    connection = sqlite3.connect(db_path)
    try:
        ensure_table(connection)
        connection.commit()
        row = connection.execute("select payload from topup_settings where id = 1").fetchone()
        if not row:
            return normalized_settings(DEFAULT_SETTINGS)
        try:
            return normalized_settings(json.loads(row[0]))
        except (TypeError, ValueError):
            return normalized_settings(DEFAULT_SETTINGS)
    finally:
        connection.close()


def save_settings(db_path, form):
    products = []
    lines = str(form.get("topup_products") or "").splitlines()
    for index, line in enumerate(lines[:MAX_PRODUCTS]):
        if not line.strip():
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) != 5 or not parts[0] or not parts[1]:
            raise ValueError(f"第 {index + 1} 行套餐格式不正确")
        products.append({
            "name": clean_text(parts[0], 80),
            "price": clean_text(parts[1], 40),
            "unit": clean_text(parts[2], 30),
            "description": clean_text(parts[3], 180),
            "status": clean_text(parts[4], 40),
        })
    if not products:
        raise ValueError("至少保留一个套餐")
    settings = normalized_settings({
        "badge": form.get("topup_badge"),
        "title": form.get("topup_title"),
        "subtitle": form.get("topup_subtitle"),
        "notice": form.get("topup_notice"),
        "qr_title": form.get("topup_qr_title"),
        "qr_caption": form.get("topup_qr_caption"),
        "footer_note": form.get("topup_footer_note"),
        "steps": [form.get(f"topup_step_{index}") for index in range(3)],
        "products": products,
    })
    connection = sqlite3.connect(db_path)
    try:
        ensure_table(connection)
        payload = json.dumps(settings, ensure_ascii=False, separators=(",", ":"))
        updated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        connection.execute(
            "insert or replace into topup_settings (id, payload, updated_at) values (1, ?, ?)",
            (payload, updated_at),
        )
        connection.commit()
    finally:
        connection.close()
    return settings


PUBLIC_STYLE = """
:root{--bg:#050807;--panel:#0d1713;--line:#24483a;--text:#f1faf5;--muted:#a7bdb2;--green:#62f6af;--cyan:#69d9ff;--gold:#ffd27a}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 12% 8%,#123b2b 0,transparent 35%),radial-gradient(circle at 88% 0,#102c43 0,transparent 30%),var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;overflow-x:hidden}body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.17;background-image:linear-gradient(#62f6af14 1px,transparent 1px),linear-gradient(90deg,#62f6af14 1px,transparent 1px);background-size:44px 44px;mask-image:linear-gradient(to bottom,#000,transparent 75%)}
main{position:relative;width:min(1160px,calc(100% - 32px));margin:auto;padding:42px 0 40px}.signal-bar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:38px;padding:10px 14px;border:1px solid #234438;border-radius:12px;background:#09110ed9;color:#8fb5a4;font:700 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.09em}.signal-bar div{display:flex;gap:14px}.signal-dot{display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:var(--green);box-shadow:0 0 12px var(--green)}.hero{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(280px,.75fr);gap:28px;align-items:center;margin-bottom:38px}
.brand-stage{display:flex;align-items:center;gap:22px;width:max-content;max-width:100%;margin-bottom:22px;padding:18px 22px;border:1px solid #3b6453;border-radius:20px;background:linear-gradient(135deg,#f4f8f5 0,#dcebe4 100%);color:#07110d;box-shadow:0 18px 50px rgba(0,0,0,.25)}.openai-mark{width:82px;height:82px;flex:0 0 auto;fill:currentColor}.brand-copy{display:grid;gap:2px}.openai-name{font-size:25px;font-weight:800;letter-spacing:-.03em}.service-name{font:900 clamp(25px,4vw,42px)/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:-.06em}.service-name i{color:#258866;font-style:normal}.service-meta{margin-top:7px;color:#3d5c50;font:700 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.09em}.identity{display:flex;align-items:center;gap:12px}.identity-name{color:#dff8eb;font:800 13px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.16em}.badge{display:inline-flex;width:max-content;padding:7px 12px;border:1px solid #3a735a;border-radius:99px;background:#102a20;color:var(--green);font-size:12px;font-weight:800;letter-spacing:.12em}h1{max-width:720px;margin:18px 0 12px;font-size:clamp(36px,6vw,70px);line-height:1.05;letter-spacing:-.04em}.lead{max-width:720px;margin:0;color:#c4d8ce;font-size:18px}.notice{margin-top:22px;padding:14px 16px;border-left:3px solid var(--gold);border-radius:8px;background:#201d12;color:#f3ddb0}
.ai-tags{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0;padding:0;list-style:none}.ai-tags li{padding:6px 10px;border:1px solid #284d3e;border-radius:8px;background:#0b1813;color:#a7cbbc;font:700 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.08em}.ai-tags li:before{content:"›";margin-right:6px;color:var(--green)}.qr-card{position:relative;padding:18px;border:1px solid #376e57;border-radius:22px;background:linear-gradient(145deg,#183126,#0d1813);box-shadow:0 0 44px rgba(99,239,170,.12);text-align:center}.ai-core{position:absolute;right:-22px;top:-32px;width:90px;height:90px;border:1px solid #69d9ff66;border-radius:50%;box-shadow:0 0 40px #69d9ff22;animation:orbit 9s linear infinite}.ai-core:before,.ai-core:after{content:"";position:absolute;border-radius:50%}.ai-core:before{inset:15px;border:1px dashed #62f6af99}.ai-core:after{width:12px;height:12px;top:8px;left:10px;background:var(--cyan);box-shadow:0 0 16px var(--cyan)}@keyframes orbit{to{transform:rotate(360deg)}}.qr-card img{display:block;width:min(100%,360px);margin:auto;border-radius:16px;background:#fff}.qr-card h2{margin:15px 0 4px;font-size:22px}.qr-card p{margin:0;color:var(--muted);font-size:14px}
.section-title{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:34px 0 15px}.section-title h2{margin:0;font-size:27px}.section-title span{color:var(--muted);font-size:13px}.products{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.product-card{min-height:230px;padding:20px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(160deg,rgba(21,48,37,.96),rgba(11,24,19,.96));box-shadow:0 14px 34px rgba(0,0,0,.22)}.product-card.unavailable{opacity:.68}.product-top{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--green);font-size:10px;font-weight:800;letter-spacing:.09em}.product-top strong{padding:3px 8px;border-radius:99px;background:#203c30;color:#b9e8d0;letter-spacing:0}.product-card h2{margin:23px 0 7px;font-size:22px}.product-card p{min-height:50px;margin:0;color:var(--muted);font-size:14px}.price{display:flex;align-items:baseline;gap:7px;margin-top:20px}.price b{color:var(--gold);font-size:32px;line-height:1}.price small{color:var(--muted)}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:0;list-style:none}.steps li{display:flex;align-items:center;gap:12px;padding:16px;border:1px solid #29483b;border-radius:13px;background:#0e1e17}.steps span{display:grid;width:30px;height:30px;flex:0 0 auto;place-items:center;border-radius:50%;background:var(--green);color:#07120d;font-weight:900}.steps strong{font-size:14px}footer{margin-top:32px;padding-top:20px;border-top:1px solid #1f3a2e;color:var(--muted);font-size:13px;text-align:center}
@media(max-width:850px){.hero{grid-template-columns:1fr}.qr-card{max-width:480px}.products{grid-template-columns:repeat(2,1fr)}}@media(max-width:560px){main{padding-top:20px}.signal-bar{align-items:flex-start}.signal-bar div{display:grid;gap:6px}.brand-stage{gap:14px;padding:14px 16px}.openai-mark{width:58px;height:58px}.openai-name{font-size:19px}.service-name{font-size:27px}.service-meta{font-size:8px}.identity{align-items:flex-start;flex-wrap:wrap}.identity-name{font-size:11px}.badge{font-size:10px}.products,.steps{grid-template-columns:1fr}.product-card{min-height:0}h1{font-size:42px}}@media(prefers-reduced-motion:reduce){.ai-core{animation:none}}
"""


def product_card(item):
    status_class = " unavailable" if "缺货" in item["status"] else ""
    return f"""<article class="product-card{status_class}">
<div class="product-top"><span>GPT SERVICE</span><strong>{esc(item['status'] or '可咨询')}</strong></div>
<h2>{esc(item['name'])}</h2><p>{esc(item['description'])}</p>
<div class="price"><b>{esc(item['price'])}</b><small>{esc(item['unit'])}</small></div>
</article>"""


def public_page(settings):
    products = "".join(product_card(item) for item in settings["products"])
    steps = "".join(
        f"<li><span>{index + 1}</span><strong>{esc(text)}</strong></li>"
        for index, text in enumerate(settings["steps"])
    )
    return f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(settings['title'])} · Codex Galaxy</title><style>{PUBLIC_STYLE}</style></head><body><main>
<header class="signal-bar"><span><i class="signal-dot"></i>CODEX GALAXY / AI SERVICES</span><div><span>GPT READY</span><span>CODEX ONLINE</span><span>SECURE DISPLAY</span></div></header>
<section class="hero"><div>
<div class="brand-stage" aria-label="OpenAI GPT 与 Codex 服务">
<svg class="openai-mark" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>OpenAI</title><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>
<div class="brand-copy"><span class="openai-name">OpenAI</span><strong class="service-name">GPT <i>×</i> CODEX</strong><span class="service-meta">ACCOUNT TOP-UP · API CREDITS</span></div></div>
<div class="identity"><span class="identity-name">CODEX GALAXY</span><span class="badge">{esc(settings['badge'])}</span></div><h1>{esc(settings['title'])}</h1>
<p class="lead">{esc(settings['subtitle'])}</p><ul class="ai-tags"><li>GPT</li><li>CODEX</li><li>OPENAI API</li><li>AI WORKFLOW</li></ul><p class="notice">{esc(settings['notice'])}</p></div>
<aside class="qr-card"><span class="ai-core" aria-hidden="true"></span><img src="/topup/qr.svg" alt="Codex Galaxy 代充联系二维码">
<h2>{esc(settings['qr_title'])}</h2><p>{esc(settings['qr_caption'])}</p></aside></section>
<div class="section-title"><h2>套餐与价格</h2><span>清晰展示 · 无需注册 · 不收集账号信息</span></div>
<section class="products">{products}</section>
<div class="section-title"><h2>咨询流程</h2><span>三步完成确认</span></div><ol class="steps">{steps}</ol>
<footer>{esc(settings['footer_note'])}</footer></main></body></html>"""


def admin_editor(settings, csrf):
    product_lines = "\n".join(
        "|".join((item["name"], item["price"], item["unit"], item["description"], item["status"]))
        for item in settings["products"]
    )
    return f"""<div class="card"><h2>GPT 代充展示页</h2>
<p><small><a href="/topup/" target="_blank" rel="noreferrer">打开公开展示页</a>。所有介绍、流程、套餐和价格均可在这里修改。</small></p>
<form method="post" action="/admin/topup/save"><input type="hidden" name="csrf" value="{esc(csrf)}"><input type="hidden" name="active_panel" value="topup">
<div class="editor-grid">
<label>顶部标识<input name="topup_badge" value="{esc(settings['badge'])}" required></label>
<label>主标题<input name="topup_title" value="{esc(settings['title'])}" required></label>
<label class="wide">副标题<textarea name="topup_subtitle" required>{esc(settings['subtitle'])}</textarea></label>
<label class="wide">购买前提示<textarea name="topup_notice" required>{esc(settings['notice'])}</textarea></label>
<label>二维码标题<input name="topup_qr_title" value="{esc(settings['qr_title'])}" required></label>
<label>二维码说明<input name="topup_qr_caption" value="{esc(settings['qr_caption'])}" required></label>
<label>流程 1<input name="topup_step_0" value="{esc(settings['steps'][0])}" required></label>
<label>流程 2<input name="topup_step_1" value="{esc(settings['steps'][1])}" required></label>
<label>流程 3<input name="topup_step_2" value="{esc(settings['steps'][2])}" required></label>
<label class="wide">底部说明<textarea name="topup_footer_note" required>{esc(settings['footer_note'])}</textarea></label>
<label class="wide">套餐列表<textarea class="products-editor" name="topup_products" required>{esc(product_lines)}</textarea>
<small>每行一个套餐，格式：名称 | 价格 | 单位 | 介绍 | 状态。最多 {MAX_PRODUCTS} 个套餐；可新增、删除或调整顺序。</small></label>
</div><p><button>保存代充页面</button></p></form></div>"""
