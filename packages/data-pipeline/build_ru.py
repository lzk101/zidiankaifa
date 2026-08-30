#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""解析 zh 转储中的俄语词条 → words_i18n + i18n_forms（lang='ru'）

数据来源：zh.wiktionary 转储（中文释义/IPA/变格变位/真人音频链接）
- 释义繁体转简体（OpenCC t2s）
- 词形去掉重音符号做反查键（столом → стол）
"""
import gzip
import json
import os
import sqlite3
import sys
import time

import build_db

# 沙箱内无法用 pip 装包，opencc 已解压到 data/py-deps
sys.path.insert(0, os.path.normpath(os.path.join(build_db.ROOT, "data", "py-deps")))

ZH_GZ = os.path.join(build_db.RAW, "wiktextract-zh.jsonl.gz")
DB_PATH = build_db.DB_PATH

RUS_LANGS = {"俄语", "俄語", "ru", "rus", "russian"}
STRESS = "\u0301"


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def strip_stress(s):
    return s.replace(STRESS, "")


def main():
    from opencc import OpenCC

    t2s = OpenCC("t2s")

    conn = sqlite3.connect(DB_PATH)
    with open(build_db.SCHEMA, encoding="utf-8") as f:
        conn.executescript(f.read())
    conn.execute("DELETE FROM words_i18n WHERE lang='ru'")
    conn.execute("DELETE FROM i18n_forms WHERE lang='ru'")
    conn.commit()

    n_lines = 0
    n_words = 0
    n_forms = 0
    buf = {}
    t0 = time.time()

    def flush():
        nonlocal n_words, n_forms
        cur = conn.cursor()
        cur.execute("BEGIN")
        for w, rec in buf.items():
            translation = t2s.convert("；".join(rec["glosses"]))[:3000] if rec["glosses"] else None
            pos = "/".join(sorted(rec["pos"])) if rec["pos"] else None
            forms = rec["forms"]
            cur.execute(
                "INSERT OR REPLACE INTO words_i18n (word, lang, phonetic, translation, definition, pos, forms, audio, source) VALUES (?,?,?,?,?,?,?,?,?)",
                (w, "ru", rec["ipa"] or None, translation, None, pos,
                 json.dumps(forms, ensure_ascii=False) if forms else None, rec["audio"] or None, "zh"),
            )
            for f in forms:
                key = f["form"]
                if key == w:
                    continue
                cur.execute(
                    "INSERT OR REPLACE INTO i18n_forms (form, word, lang, tags) VALUES (?,?,?,?)",
                    (key, w, "ru", json.dumps(f["tags"], ensure_ascii=False)),
                )
                n_forms += 1
            n_words += 1
        cur.execute("COMMIT")
        buf.clear()

    with gzip.open(ZH_GZ, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            n_lines += 1
            try:
                obj = json.loads(line)
            except Exception:
                continue
            lang = (obj.get("lang") or "").strip().lower()
            if lang not in RUS_LANGS:
                continue
            w = strip_stress((obj.get("word") or "").strip())
            if not w:
                continue
            rec = buf.setdefault(w, {"glosses": [], "pos": set(), "ipa": None, "forms": [], "audio": None, "seen_forms": set()})
            # 中文释义
            for s in obj.get("senses") or []:
                for g in s.get("glosses") or []:
                    g = g.strip()
                    if g and g not in rec["glosses"]:
                        rec["glosses"].append(g)
            # 词性
            p = (obj.get("pos") or "").strip()
            if p:
                rec["pos"].add(p)
            # IPA
            if not rec["ipa"]:
                for s in obj.get("sounds") or []:
                    ipa = (s.get("ipa") or "").strip()
                    if ipa:
                        rec["ipa"] = ipa
                        break
            # 音频
            if not rec["audio"]:
                for s in obj.get("sounds") or []:
                    m = (s.get("mp3_url") or "").strip()
                    if m:
                        rec["audio"] = m
                        break
            # 变格变位
            for fo in obj.get("forms") or []:
                form = (fo.get("form") or "").strip()
                if not form:
                    continue
                tags = fo.get("tags") or []
                key = strip_stress(form)
                if key in rec["seen_forms"]:
                    continue
                rec["seen_forms"].add(key)
                rec["forms"].append({"form": key, "display": form, "tags": tags})
            if len(buf) >= 100000:
                flush()
                log(f"  {n_lines/1e6:.1f}M lines, words={n_words}, forms={n_forms}")
    if buf:
        flush()
    conn.commit()
    conn.close()
    log(f"done: lines={n_lines} words={n_words} forms={n_forms} in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
