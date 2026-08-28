#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""后处理 word_etymology：
1) 语源判定改为「词源文本关键词优先、模板链兜底」（文本最可靠）
2) 用扩充后的 LANG_NAME 重新映射 chain 中每个 step 的中文语言名
"""
import json
import sqlite3
import sys

import build_db

DB = build_db.DB_PATH
LANG_NAME = build_db.LANG_NAME

# 语言关键词表（中文文本/英文文本）
LANG_KEYWORDS = [
    ("lat", "拉丁语", ["Latin"]),
    ("grc", "古希腊语", ["Ancient Greek"]),
    ("ell", "希腊语", ["Modern Greek", "Greek"]),
    ("fro", "古法语", ["Old French"]),
    ("frm", "中古法语", ["Middle French"]),
    ("fra", "法语", ["French"]),
    ("ang", "古英语", ["Old English"]),
    ("enm", "中古英语", ["Middle English"]),
    ("deu", "德语", ["German"]),
    ("goh", "古高地德语", ["Old High German"]),
    ("gmh", "中古高地德语", ["Middle High German"]),
    ("gem", "原始日耳曼语", ["Proto-Germanic"]),
    ("gem-pro", "原始日耳曼语", ["Proto-Germanic"]),
    ("ine", "原始印欧语", ["Proto-Indo-European"]),
    ("ine-pro", "原始印欧语", ["Proto-Indo-European"]),
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
    ("osx", "古撒克逊语", ["Old Saxon"]),
    ("non", "古诺尔斯语", ["Old Norse"]),
    ("sga", "古爱尔兰语", ["Old Irish"]),
    ("frk", "法兰克语", ["Frankish"]),
    ("cel", "凯尔特语", ["Celtic"]),
    ("sla", "斯拉夫语", ["Slavic"]),
    ("ita", "意大利语", ["Italian"]),
    ("cat", "加泰罗尼亚语", ["Catalan"]),
]


def origin_from_text(text):
    if not text:
        return None
    for code, _zh, words in LANG_KEYWORDS:
        for w in words:
            if w in text:
                return code
    return None


def origin_from_chain(chain):
    for s in reversed(chain or []):
        l = (s.get("lang") or "")
        if l and l != "en":
            return l
    return None


def main():
    conn = sqlite3.connect(DB)
    rows = conn.execute(
        "SELECT word, text_en, text_zh, chain FROM word_etymology"
    ).fetchall()
    n = 0
    for word, text_en, text_zh, chain_json in rows:
        try:
            chain = json.loads(chain_json) if chain_json else []
        except Exception:
            chain = []
        text = (text_zh or text_en or "")
        code = origin_from_text(text) or origin_from_chain(chain) or None
        origin_zh = LANG_NAME.get(code, code) if code else None
        # 重映射 chain 语言名
        for s in chain:
            l = s.get("lang")
            if l:
                s["langZh"] = LANG_NAME.get(l, l)
        conn.execute(
            "UPDATE word_etymology SET origin=?, origin_code=?, chain=? WHERE word=?",
            (origin_zh, code, json.dumps(chain, ensure_ascii=False), word),
        )
        n += 1
    conn.commit()
    conn.close()
    print(f"updated {n} rows")


if __name__ == "__main__":
    sys.exit(main())
