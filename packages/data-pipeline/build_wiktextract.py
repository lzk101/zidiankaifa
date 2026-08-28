#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""解析 wiktextract 转储 → word_etymology 表

用法：
  python build_wiktextract.py --sample <词>   # 先查看某词的 etymology 结构与模板（验证格式）
  python build_wiktextract.py                  # 全量解析（en 全量 + zh 补充）
"""
import gzip
import json
import os
import re
import sqlite3
import sys
import time

import build_db  # 复用 LANG_NAME 与路径常量

RAW = build_db.RAW
DB_PATH = build_db.DB_PATH
ALL_GZ = os.path.join(RAW, "wiktextract-all.jsonl.gz")
ZH_GZ = os.path.join(RAW, "wiktextract-zh.jsonl.gz")

# 结构化的派生/来源模板（参数约定：{{der|en|frm|abandouner}} 等）
STEP_TEMPLATES = {
    "der": 2, "der3": 2, "inh": 2, "inh3": 2, "bor": 2, "bor3": 2,
    "cal": 2, "clq": 2, "etyl": 1, "l": 1, "m": 1, "cog": 1, "ncog": 1,
    "translit": 1, "mention": 1,
}
# 组合/构词模板（同一语言内部构词，也记入链条）
COMPOUND_TEMPLATES = {"af", "pre", "suf", "con", "compound", "blend", "back-form", "backformation"}

WS_RE = re.compile(r"\s+")
WIKI_LINK_RE = re.compile(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]")
HTML_TAG_RE = re.compile(r"<[^>]+>")
TEMPLATE_RE = re.compile(r"\{\{[^{}]*\}\}")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def clean_text(s):
    if not s:
        return ""
    s = WIKI_LINK_RE.sub(r"\1", s)
    s = HTML_TAG_RE.sub("", s)
    s = TEMPLATE_RE.sub("", s)
    s = s.replace("'''", "").replace("''", "").replace("**", "")
    s = WS_RE.sub(" ", s)
    return s.strip()


def parse_chain(templates):
    """从 etymology_templates 提取结构化派生链。"""
    steps = []
    for t in templates or []:
        if not isinstance(t, dict):
            continue
        name = (t.get("name") or "").strip()
        args = t.get("args") or {}
        if name in STEP_TEMPLATES:
            lang_idx = STEP_TEMPLATES[name]
            lang = str(args.get(str(lang_idx), "")).strip()
            word = str(args.get(str(lang_idx + 1), "")).strip()
            if not lang and lang_idx == 2:
                lang = str(args.get("2", "")).strip()
                word = str(args.get("3", "")).strip()
            if lang:
                steps.append({
                    "lang": lang,
                    "langZh": build_db.LANG_NAME.get(lang, lang),
                    "word": word or None,
                    "kind": name,
                })
        elif name in COMPOUND_TEMPLATES:
            # {{af|en|tele|phone}} 等：记录构词成分（多词）
            comps = []
            for i in range(2, 8):
                w = str(args.get(str(i), "")).strip()
                if w and w not in ("en", "enm", "frm", "lat", "grc"):
                    comps.append(w)
            if comps:
                steps.append({"lang": "en", "langZh": "英语", "word": None, "parts": comps[:6], "kind": name})
    # 去重（相邻相同 step）
    out = []
    for s in steps:
        if out and out[-1] == s:
            continue
        out.append(s)
    return out


def derive_origin(chain, text_en, text_zh):
    """最深层来源语言：优先 chain 末步；否则从文本关键词推断。"""
    for s in reversed(chain or []):
        l = s.get("lang")
        if l and l != "en":
            return l
    text = (text_zh or text_en or "")
    if not text:
        return None
    # 常见语言关键词（中文优先）
    for code, zh, en_words in [
        ("lat", "拉丁语", ["Latin"]),
        ("grc", "古希腊语", ["Ancient Greek", "Greek"]),
        ("fro", "古法语", ["Old French"]),
        ("frm", "中古法语", ["Middle French"]),
        ("fra", "法语", ["French"]),
        ("ang", "古英语", ["Old English"]),
        ("enm", "中古英语", ["Middle English"]),
        ("deu", "德语", ["German"]),
        ("goh", "古高地德语", ["Old High German"]),
        ("gem", "原始日耳曼语", ["Proto-Germanic"]),
        ("ine", "原始印欧语", ["Proto-Indo-European"]),
        ("nld", "荷兰语", ["Dutch"]),
        ("ita", "意大利语", ["Italian"]),
        ("spa", "西班牙语", ["Spanish"]),
        ("por", "葡萄牙语", ["Portuguese"]),
        ("rus", "俄语", ["Russian"]),
        ("ara", "阿拉伯语", ["Arabic"]),
        ("heb", "希伯来语", ["Hebrew"]),
        ("san", "梵语", ["Sanskrit"]),
        ("hin", "印地语", ["Hindi"]),
        ("tur", "土耳其语", ["Turkish"]),
        ("per", "波斯语", ["Persian"]),
        ("jpn", "日语", ["Japanese"]),
        ("zho", "汉语", ["Chinese"]),
        ("kor", "韩语", ["Korean"]),
        ("swe", "瑞典语", ["Swedish"]),
        ("dan", "丹麦语", ["Danish"]),
        ("nor", "挪威语", ["Norwegian"]),
        ("pol", "波兰语", ["Polish"]),
        ("ces", "捷克语", ["Czech"]),
        ("ukr", "乌克兰语", ["Ukrainian"]),
    ]:
        for w in en_words:
            if w in text:
                return code
    return None


# 英文条目在各转储中的 lang 取值（en.wiktionary 用 "English"/"en"，zh.wiktionary 用 英語/英语）
EN_LANGS = {"en", "eng", "english", "英語", "英语", "en-us", "en-gb"}


def entry_word(obj):
    if (obj.get("lang") or "").strip().lower() not in EN_LANGS:
        return None
    w = (obj.get("word") or "").strip().lower()
    if not w:
        return None
    return w


def process_gz(path, word_set, conn, is_zh):
    if not os.path.exists(path):
        log(f"SKIP {path} missing")
        return 0, 0, 0
    n_total = n_in_set = n_etym = n_skipped = 0
    buf = {}
    t0 = time.time()
    last_in_dict_line = 0
    watermark = os.path.join(RAW, "parse-progress.txt")
    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            n_total += 1
            # 进度 tick 放在过滤器之前，保证每 10 万行必触发一次
            if n_total % 100000 == 0:
                msg = f"{os.path.basename(path)}: {n_total/1e6:.1f}M lines, in_dict={n_in_set}, with_etym={n_etym}, skipped={n_skipped}, buf={len(buf)}, {(time.time()-t0)/60:.1f}min"
                log(f"  {msg}")
                with open(watermark, "a", encoding="utf-8") as wf:
                    wf.write(f"{time.strftime('%H:%M:%S')} {msg}\n")
            # 跳过巨型条目（防止病态行拖慢解析）
            if len(line) > 200000:
                n_skipped += 1
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            w = entry_word(obj)
            if not w or w not in word_set:
                continue
            n_in_set += 1
            last_in_dict_line = n_total
            et = obj.get("etymology_text")
            etmpl = obj.get("etymology_templates")
            if not et and not etmpl:
                continue
            n_etym += 1
            rec = buf.setdefault(w, {"text_en": set(), "text_zh": set(), "steps": []})
            if et:
                t = clean_text(et)
                if t:
                    (rec["text_zh"] if is_zh else rec["text_en"]).add(t)
            if etmpl:
                for s in parse_chain(etmpl):
                    if s not in rec["steps"]:
                        rec["steps"].append(s)
            if len(buf) >= 100000:
                flush(buf, conn, is_zh)
                buf = {}
            # 目标语言区（转储按语言排序，英语区在最前）结束后即可停止
            if not is_zh and n_total - last_in_dict_line > 300000:
                log(f"  {os.path.basename(path)}: English section done at {n_total/1e6:.1f}M lines, stopping early")
                break
    if buf:
        flush(buf, conn, is_zh)
    return n_total, n_in_set, n_etym


def flush(buf, conn, is_zh):
    cur = conn.cursor()
    for w, rec in buf.items():
        text_en = " / ".join(sorted(rec["text_en"]))[:4000]
        text_zh = " / ".join(sorted(rec["text_zh"]))[:4000]
        chain = rec["steps"][:12]
        origin_code = derive_origin(chain, text_en, text_zh)
        origin_zh = build_db.LANG_NAME.get(origin_code, origin_code) if origin_code else None
        # 与库中已有记录合并（en 全量先跑，zh 补充 text_zh）
        old = cur.execute(
            "SELECT text_en, text_zh, chain, origin, origin_code, source FROM word_etymology WHERE word=?", (w,)
        ).fetchone()
        if old:
            o_en, o_zh, o_chain, o_origin, o_oc, o_src = old
            merged_en = (o_en or "") if (o_en or "") else text_en
            merged_zh = (o_zh or "") if (o_zh or "") else text_zh
            if is_zh:
                merged_zh = text_zh if text_zh else (o_zh or "")
            merged_chain = o_chain or json.dumps(chain, ensure_ascii=False)
            merged_origin = o_origin or origin_zh
            merged_oc = o_oc or origin_code
            src = "en+zh" if (merged_en and merged_zh) else ("zh" if merged_zh else "en")
            cur.execute(
                "UPDATE word_etymology SET text_en=?, text_zh=?, chain=?, origin=?, origin_code=?, source=? WHERE word=?",
                (merged_en or None, merged_zh or None, merged_chain, merged_origin, merged_oc, src, w),
            )
        else:
            src = "zh" if (is_zh and text_zh) else "en"
            cur.execute(
                "INSERT OR REPLACE INTO word_etymology (word, text_en, text_zh, chain, origin, origin_code, source) VALUES (?,?,?,?,?,?,?)",
                (w, text_en or None, text_zh or None, json.dumps(chain, ensure_ascii=False) if chain else None,
                 origin_zh, origin_code, src),
            )
    cur.execute("COMMIT")


def sample(word, n=5):
    """打印某词在转储中的 etymology 样例。"""
    found = 0
    for path, tag in [(ALL_GZ, "ALL"), (ZH_GZ, "ZH")]:
        if not os.path.exists(path):
            continue
        log(f"--- {tag} ---")
        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                if entry_word(obj) == word.lower():
                    found += 1
                    if found > n:
                        break
                    print(json.dumps({
                        "pos": obj.get("pos"),
                        "etymology_text": (obj.get("etymology_text") or "")[:400],
                        "etymology_templates": (obj.get("etymology_templates") or [])[:6],
                    }, ensure_ascii=False, indent=1)[:1500])
                    print("---")
        if found:
            break
    if not found:
        log(f"未在转储中找到 {word}")


def main():
    if "--sample" in sys.argv:
        i = sys.argv.index("--sample")
        word = sys.argv[i + 1] if len(sys.argv) > i + 1 else "abandon"
        sample(word)
        return 0

    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM word_etymology")
    conn.commit()
    word_set = {r[0] for r in conn.execute("SELECT word FROM words")}
    log(f"words in dict: {len(word_set)}")

    t0 = time.time()
    for path, is_zh in [(ALL_GZ, False), (ZH_GZ, True)]:
        n_total, n_in, n_e = process_gz(path, word_set, conn, is_zh)
        log(f"{os.path.basename(path)}: total={n_total} in_dict={n_in} with_etym={n_e}")
    n = conn.execute("SELECT COUNT(*) FROM word_etymology").fetchone()[0]
    srcs = conn.execute("SELECT source, COUNT(*) FROM word_etymology GROUP BY source").fetchall()
    conn.commit()
    conn.close()
    log(f"word_etymology rows: {n}  sources={dict(srcs)}  time={time.time()-t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
