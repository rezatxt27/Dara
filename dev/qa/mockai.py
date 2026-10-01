# Mock OpenAI-compatible AI + a fake "Talayin" holdings page for end-to-end tests.
import json, re, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGE = """<!doctype html><html lang=fa dir=rtl><meta charset=utf-8><title>پلتفرم طلای نمونه — کیف دارایی من</title>
<body><h1>داشبورد حساب کاربری</h1><p>شماره کارت: 6037 9918 1234 5678</p>
<div>موجودی طلای آب‌شده: ۴۲٫۱۵ گرم</div><div>ارزش تقریبی: ۱٬۰۶۸٬۹۰۰٬۰۰۰ تومان</div>
<div>کیف پول تومانی: ۱۲٬۵۰۰٬۰۰۰ تومان</div><div>قیمت لحظه‌ای خرید هر گرم: ۲۵٬۴۰۰٬۰۰۰ تومان</div></body></html>"""

BROKER = """<!doctype html><html lang=fa dir=rtl><meta charset=utf-8><title>کارگزاری نمونه — پرتفوی</title>
<body><h1>پرتفوی نمونه</h1><table><tr><th>نماد</th><th>تعداد</th><th>قیمت سربه‌سر</th></tr>
<tr><td>زر</td><td>1,200</td><td>150,000</td></tr><tr><td>شستا</td><td>5,000</td><td>1,200</td></tr><tr><td>عسکه5</td><td>10</td><td>2,000,000</td></tr></table>
<div>قدرت خرید: 3,000,000 ریال</div></body></html>"""

def openai_reply(content=None, tool_calls=None):
    msg = {"role": "assistant", "content": content}
    if tool_calls: msg["tool_calls"] = tool_calls
    return {"id": "x", "object": "chat.completion", "model": "mock-model-1", "choices": [{"index": 0, "message": msg, "finish_reason": "tool_calls" if tool_calls else "stop"}]}

def tc(name, args, i=0):
    return {"id": f"call_{name}_{i}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, ctype="application/json"):
        data = obj.encode() if isinstance(obj, str) else json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Access-Control-Allow-Origin", "*"); self.end_headers(); self.wfile.write(data)
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "*"); self.end_headers()
    def do_GET(self):
        if self.path.startswith("/talayin"): return self._send(200, PAGE, "text/html; charset=utf-8")
        if self.path.startswith("/broker"): return self._send(200, BROKER, "text/html; charset=utf-8")
        if self.path.endswith("/models"): return self._send(200, {"data": [{"id": "mock-model-1"}, {"id": "mock-mini"}]})
        self._send(404, {"error": {"message": "not found"}})
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or b"{}")
        if self.headers.get("Authorization") != "Bearer test-key":
            return self._send(401, {"error": {"message": "Invalid API key"}})
        msgs = body.get("messages", []); tools = body.get("tools") or []
        last = msgs[-1] if msgs else {}
        text = last.get("content") or ""
        if isinstance(text, list): text = " ".join(p.get("text", "") for p in text)
        tool_names = {t["function"]["name"] for t in tools}
        if "Reply with" in text: return self._send(200, openai_reply("OK"))
        if "Call the ping tool" in text: return self._send(200, openai_reply(None, [tc("ping", {})]) if "ping" in tool_names else openai_reply("cannot"))
        if "currency_unit" in text and "پرتفوی نمونه" in text:
            # The model returns every row but matches none, like a real model often does.
            items = [{"label": "زر", "kind": "quantity", "amount": 1200, "unit": "واحد", "type": "stock", "symbol": "زر", "avg_cost": 150000, "match_id": None, "confidence": 0.99},
                     {"label": "شستا", "kind": "quantity", "amount": 5000, "unit": "سهم", "type": "stock", "symbol": "شستا", "avg_cost": 1200, "match_id": None, "confidence": 0.97},
                     {"label": "عسکه5", "kind": "quantity", "amount": 10, "unit": "واحد", "type": "coin", "symbol": "عسکه5", "avg_cost": 2000000, "match_id": None, "confidence": 0.93},
                     {"label": "قدرت خرید", "kind": "balance", "amount": 3000000, "unit": "ریال", "type": "cash", "symbol": None, "avg_cost": None, "match_id": None, "confidence": 0.99}]
            return self._send(200, openai_reply(json.dumps({"site": "کارگزاری نمونه", "currency_unit": "rial", "items": items}, ensure_ascii=False)))
        if "currency_unit" in text:
            m = re.search(r"\(برای تطبیق\):\n(\[.*?\])\n", text, re.S)
            ids = json.loads(m.group(1)) if m else []
            gold = next((a["id"] for a in ids if "آب" in a["name"]), None)
            items = [{"label": "طلای آب‌شده", "kind": "quantity", "amount": 42.15, "unit": "گرم", "match_id": gold, "confidence": 0.96},
                     {"label": "کیف پول تومانی", "kind": "balance", "amount": 12500000, "unit": "تومان", "match_id": None, "confidence": 0.82}]
            leaked = "6037 9918 1234 5678" in text
            print("CARD_LEAKED" if leaked else "CARD_MASKED", flush=True)
            return self._send(200, openai_reply("```json\n" + json.dumps({"site": "talayin", "currency_unit": "toman", "items": items, "leaked_card": leaked}, ensure_ascii=False) + "\n```"))
        if "گزارش هفتگی" in text:
            return self._send(200, openai_reply("**خلاصه:** ارزش خالص در هفته گذشته کمی کاهش یافت.\n\n**چه چیزی تغییر داد**\n- طلا: رشد قیمت\n- واریز پاداش به حساب بانکی\n\n**هفته پیش رو**\n- واریز حقوق\n\n**یک نکته:** تمرکز روی یک دارایی بالاست."))
        # chat with tools
        tool_msgs = [m for m in msgs if m.get("role") == "tool"]
        users = [m for m in msgs if m.get("role") == "user"]
        q = users[-1]["content"] if users else ""
        last_user_idx = max(i for i, m in enumerate(msgs) if m.get("role") == "user")
        has_results = any(m.get("role") == "tool" for m in msgs[last_user_idx:])
        if tools and not has_results:
            calls = [tc("get_overview", {}, 0)]
            if "دلار" in q: calls.append(tc("simulate_scenario", {"usd_pct": 30, "gold_ounce_pct": -10}, 1))
            if "ثبت کن" in q: calls = [tc("list_assets", {"query": "حساب بانکی ب"}, 0)]
            return self._send(200, openai_reply("", calls))
        if tools and "ثبت کن" in q and not any("propose" in (m.get("tool_call_id") or "") for m in msgs[last_user_idx:]):
            res = json.loads(tool_msgs[-1]["content"])
            aid = res[0]["id"] if isinstance(res, list) and res else "?"
            return self._send(200, openai_reply("", [tc("propose_update", {"asset_id": aid, "field": "balance", "new_value": 15000000, "reason": "طبق گفته کاربر"}, 9)]))
        parts = []
        for m in msgs[last_user_idx:]:
            if m.get("role") == "tool":
                try: d = json.loads(m["content"])
                except Exception: continue
                if isinstance(d, dict) and "change_pct" in d: parts.append(f"در این سناریو ارزش خالص **{d['change_pct']}٪** تغییر می‌کند و بر حسب دلار {d.get('in_usd_terms_change_pct')}٪.")
                if isinstance(d, dict) and "categories" in d: parts.append("بزرگ‌ترین دسته: " + d["categories"][0]["name"] + f" ({d['categories'][0]['share_pct']}٪).")
                if isinstance(d, dict) and d.get("ok"): parts.append("پیشنهاد به‌روزرسانی آماده شد؛ لطفاً تأیید کن.")
        return self._send(200, openai_reply("\n".join(parts) or "پاسخ آزمایشی"))

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
