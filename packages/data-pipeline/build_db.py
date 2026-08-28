#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构建 data/db/dict.db：
1) ECDICT csv -> words 表（76万词条，含音标/释义/词频/考试标签）
2) exchange 字段 -> word_forms 词形演变表（双向）
3) etymwn 词源图 -> word_origins 词源分类表（最长祖先链，取最深层非英语语言为语源）
4) roots.json -> morphemes 词根词缀库
"""
import csv
import json
import os
import re
import sqlite3
import sys
import time
import zipfile
from collections import Counter, defaultdict

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
RAW = os.path.join(ROOT, "data", "raw")
DB_PATH = os.path.join(ROOT, "data", "db", "dict.db")
SCHEMA = os.path.join(ROOT, "packages", "core", "schema.sql")
ROOTS_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "roots.json")

WORDS_COLS = 12

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

def open_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    with open(SCHEMA, encoding="utf-8") as f:
        conn.executescript(f.read())
    return conn

# ---------------- words ----------------

def build_words(conn):
    csvp = os.path.join(RAW, "ecdict.csv")
    if not os.path.exists(csvp):
        log("SKIP words: ecdict.csv missing (run download.py first)")
        return
    log("building words ...")
    cur = conn.cursor()
    n = 0
    with open(csvp, encoding="utf-8", newline="") as f:
        r = csv.reader(f)
        header = next(r)
        col = {name: i for i, name in enumerate(header)}
        rows = []
        def flush():
            cur.executemany(
                "INSERT OR REPLACE INTO words (word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,audio)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
            rows.clear()
        for row in r:
            if len(row) < len(header):
                row += [""] * (len(header) - len(row))
            def g(name):
                v = row[col[name]]
                return v if v else None
            def gi(name):
                v = row[col[name]]
                try:
                    return int(v) if v else None
                except ValueError:
                    return None
            rows.append((g("word"), g("phonetic"), g("definition"), g("translation"),
                         g("pos"), gi("collins"), gi("oxford"), g("tag"),
                         gi("bnc"), gi("frq"), g("exchange"), g("audio")))
            n += 1
            if len(rows) >= 30000:
                flush()
        if rows:
            flush()
    conn.commit()
    log(f"words: {n}")

# ---------------- word_forms ----------------

EXCHANGE_MAP = {
    "p": "past", "d": "done", "i": "ing", "3": "third",
    "r": "comp", "t": "super", "s": "plural", "0": "base", "1": "base",
}

def build_forms(conn):
    log("building word_forms from exchange ...")
    cur = conn.cursor()
    # 先物化查询结果，避免在同一连接上边迭代边写
    rows = conn.execute(
        "SELECT word, exchange FROM words WHERE exchange IS NOT NULL"
    ).fetchall()
    cur.execute("BEGIN")
    n = 0
    for word, exchange in rows:
        for part in exchange.split("/"):
            if ":" not in part:
                continue
            key, _, val = part.partition(":")
            val = val.strip()
            if not val:
                continue
            ftype = EXCHANGE_MAP.get(key, "variant")
            # (word -> form) 主方向；form 反查原型由 idx_forms_form 索引提供
            cur.execute("INSERT OR REPLACE INTO word_forms (word, form, form_type) VALUES (?,?,?)",
                        (word, val.lower(), ftype))
            n += 1
    cur.execute("COMMIT")
    log(f"word_forms: {n}")

# ---------------- word_origins ----------------

LANG_NAME = {
    "eng": "英语", "enm": "中古英语", "ang": "古英语", "sco": "低地苏格兰语",
    "fra": "法语", "fro": "古法语", "frm": "中古法语",
    "lat": "拉丁语", "grc": "古希腊语", "ell": "现代希腊语",
    "deu": "德语", "gmh": "中古高地德语", "goh": "古高地德语", "gem": "原始日耳曼语",
    "ine": "原始印欧语", "cel": "凯尔特语族", "sla": "斯拉夫语族", "bal": "波罗的语族",
    "spa": "西班牙语", "ita": "意大利语", "por": "葡萄牙语", "cat": "加泰罗尼亚语",
    "nld": "荷兰语", "dum": "中古荷兰语", "odt": "古荷兰语",
    "dan": "丹麦语", "swe": "瑞典语", "nor": "挪威语", "isl": "冰岛语",
    "fin": "芬兰语", "hun": "匈牙利语", "est": "爱沙尼亚语",
    "pol": "波兰语", "ces": "捷克语", "slk": "斯洛伐克语", "ukr": "乌克兰语",
    "rus": "俄语", "bul": "保加利亚语", "srp": "塞尔维亚语", "hrv": "克罗地亚语",
    "ron": "罗马尼亚语", "lit": "立陶宛语", "lav": "拉脱维亚语",
    "ara": "阿拉伯语", "heb": "希伯来语", "arc": "阿拉米语",
    "tur": "土耳其语", "per": "波斯语", "fas": "波斯语", "san": "梵语",
    "hin": "印地语", "urd": "乌尔都语", "ben": "孟加拉语", "tam": "泰米尔语",
    "tel": "泰卢固语", "kan": "卡纳达语", "mal": "马拉雅拉姆语", "mar": "马拉地语",
    "guj": "古吉拉特语", "pan": "旁遮普语", "sin": "僧伽罗语", "nep": "尼泊尔语",
    "zho": "汉语", "jpn": "日语", "kor": "韩语", "vie": "越南语", "tha": "泰语",
    "khm": "高棉语", "lao": "老挝语", "msa": "马来语", "may": "马来语", "ind": "印尼语",
    "tgl": "他加禄语", "fil": "菲律宾语", "swa": "斯瓦希里语",
    "amh": "阿姆哈拉语", "som": "索马里语", "yor": "约鲁巴语", "hau": "豪萨语",
    "zul": "祖鲁语", "afr": "南非荷兰语", "sot": "塞索托语",
    "eus": "巴斯克语", "gle": "爱尔兰语", "cym": "威尔士语", "gla": "苏格兰盖尔语",
    "bre": "布列塔尼语", "alb": "阿尔巴尼亚语", "sqi": "阿尔巴尼亚语",
    "arm": "亚美尼亚语", "hye": "亚美尼亚语", "geo": "格鲁吉亚语", "kat": "格鲁吉亚语",
    "aze": "阿塞拜疆语", "kaz": "哈萨克语", "uzb": "乌兹别克语", "mon": "蒙古语",
    "uig": "维吾尔语", "tib": "藏语", "bod": "藏语", "bur": "缅甸语", "mya": "缅甸语",
    "nav": "纳瓦霍语", "iku": "因纽特语", "moh": "莫霍克语", "oji": "奥吉布瓦语",
    "nah": "纳瓦特尔语", "que": "克丘亚语", "aym": "艾马拉语", "grn": "瓜拉尼语",
    "smi": "萨米语", "fry": "弗里西亚语", "cym": "威尔士语",
}

REL_ANCESTOR = {
    # 行格式: [A, rel, B]；得到"祖先边" descendant -> ancestor
    "etymological_origin_of": ("B", "A"),  # A 是 B 的词源
    "etymology": ("A", "B"),               # A 的词源是 B
    "is_derived_from": ("A", "B"),         # A 派生自 B
    "as_derived_form": ("A", "B"),         # A 是 B 的派生形式
    "has_derived_form": ("B", "A"),        # A 有派生形式 B
}

WORD_RE = re.compile(r"^[A-Za-z][A-Za-z' -]*$")

def norm_word(w):
    w = w.strip().strip("'\"")
    if not WORD_RE.match(w):
        return None
    return w.lower()

def parse_node(s):
    # "eng: abandon" -> (lang, word)
    if ": " not in s and ":" not in s:
        return None
    lang, _, word = s.partition(":")
    lang = lang.strip()
    word = norm_word(word)
    if len(lang) < 2 or len(lang) > 3 or not lang.isalpha() or word is None:
        return None
    return (lang, word)

def build_origins(conn):
    zipp = os.path.join(RAW, "etymwn-20130208.zip")
    if not os.path.exists(zipp):
        log("SKIP origins: etymwn zip missing")
        return
    log("scanning etymwn (pass 1: language frequency) ...")
    z = zipfile.ZipFile(zipp)
    member = "etymwn.tsv"
    freq = Counter()
    with z.open(member) as f:
        for line in f:
            parts = line.rstrip(b"\n").split(b"\t")
            if len(parts) != 3:
                continue
            rel = parts[1][4:].decode("ascii", "replace") if parts[1].startswith(b"rel:") else parts[1].decode("ascii", "replace")
            if rel not in REL_ANCESTOR:
                continue
            left = parse_node(parts[0].decode("utf-8", "replace"))
            right = parse_node(parts[2].decode("utf-8", "replace"))
            if left is None or right is None:
                continue
            freq[left[0]] += 1
            freq[right[0]] += 1

    keep_langs = {lang for lang, c in freq.items() if c >= 2000}
    keep_langs.add("eng")
    log(f"etymwn langs kept: {len(keep_langs)} (total {len(freq)})")

    log("building origin graph (pass 2) ...")
    graph = defaultdict(list)  # descendant node -> [ancestor nodes]
    with z.open(member) as f:
        for line in f:
            parts = line.rstrip(b"\n").split(b"\t")
            if len(parts) != 3:
                continue
            rel = parts[1][4:].decode("ascii", "replace") if parts[1].startswith(b"rel:") else parts[1].decode("ascii", "replace")
            d = REL_ANCESTOR.get(rel)
            if d is None:
                continue
            left = parse_node(parts[0].decode("utf-8", "replace"))
            right = parse_node(parts[2].decode("utf-8", "replace"))
            if left is None or right is None:
                continue
            desc, anc = (left, right) if d == ("A", "B") else (right, left)
            if desc[0] not in keep_langs and anc[0] not in keep_langs:
                continue
            if desc[0] == anc[0] and desc[1] == anc[1]:
                continue  # 自环
            graph[desc].append(anc)
    log(f"origin graph nodes: {len(graph)}")

    # 只对 ECDICT 中的英文词计算
    log("computing origins (memoized DFS) ...")
    words = [r[0] for r in conn.execute("SELECT word FROM words")]
    eng_nodes = set()
    for w in words:
        nw = norm_word(w)
        if nw:
            eng_nodes.add(("eng", nw))
    eng_nodes &= set(graph.keys())

    MAX_DEPTH = 10
    memo = {}
    visiting = set()

    def origin(node, depth):
        if node in memo:
            return memo[node]
        if depth >= MAX_DEPTH or node in visiting:
            return (node[0], [node[0]], 1)
        visiting.add(node)
        best = (node[0], [node[0]], 1)  # (origin_lang, langs_path, depth)
        for anc in graph.get(node, ()):
            r = origin(anc, depth + 1)
            cand = (r[0], [node[0]] + r[1], r[2] + 1)
            if cand[2] > best[2] or (cand[2] == best[2] and cand[0] != "eng" and best[0] == "eng"):
                best = cand
        visiting.discard(node)
        memo[node] = best
        return best

    cur = conn.cursor()
    cur.execute("BEGIN")
    n = 0
    for node in eng_nodes:
        res = origin(node, 0)
        lang = res[0]
        lineage = [LANG_NAME.get(l, l) for l in res[1]]
        cur.execute(
            "INSERT OR REPLACE INTO word_origins (word, origin, origin_code, lineage, depth) VALUES (?,?,?,?,?)",
            (node[1], LANG_NAME.get(lang, lang), lang, json.dumps(lineage, ensure_ascii=False), res[2]))
        n += 1
    cur.execute("COMMIT")
    log(f"word_origins: {n}")

# ---------------- morphemes ----------------

def build_morphemes(conn):
    if not os.path.exists(ROOTS_JSON):
        log("SKIP morphemes: roots.json missing")
        return
    log("building morphemes ...")
    with open(ROOTS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    cur = conn.cursor()
    cur.execute("BEGIN")
    n = 0
    for m in data:
        cur.execute(
            "INSERT OR REPLACE INTO morphemes (morpheme, kind, meaning_zh, meaning_en, origin, examples) VALUES (?,?,?,?,?,?)",
            (m["morpheme"], m["kind"], m.get("meaningZh", ""), m.get("meaningEn"),
             m.get("origin"), json.dumps(m.get("examples", []), ensure_ascii=False)))
        n += 1
    cur.execute("COMMIT")
    log(f"morphemes: {n}")

# ---------------- main ----------------

def verify(conn):
    log("=== verify ===")
    for w in ("abandon", "telephone", "city", "run", "hello"):
        row = conn.execute("SELECT word, phonetic, translation, tag, bnc, frq FROM words WHERE word=?", (w,)).fetchone()
        print("  word:", row)
        fms = conn.execute("SELECT form, form_type FROM word_forms WHERE word=? ORDER BY form", (w,)).fetchall()
        print("  forms:", fms[:8])
        og = conn.execute("SELECT origin, lineage, depth FROM word_origins WHERE word=?", (w,)).fetchone()
        print("  origin:", og)
    stats = {
        "words": conn.execute("SELECT COUNT(*) FROM words").fetchone()[0],
        "word_forms": conn.execute("SELECT COUNT(*) FROM word_forms").fetchone()[0],
        "word_origins": conn.execute("SELECT COUNT(*) FROM word_origins").fetchone()[0],
        "morphemes": conn.execute("SELECT COUNT(*) FROM morphemes").fetchone()[0],
        "db_size_mb": round(os.path.getsize(DB_PATH) / 1e6, 1),
    }
    print("  stats:", stats)

def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    t0 = time.time()
    conn = open_db()
    if only is None or only == "words":
        build_words(conn)
    if only is None or only == "forms":
        build_forms(conn)
    if only is None or only == "origins":
        build_origins(conn)
    if only is None or only == "morphemes":
        build_morphemes(conn)
    conn.execute("PRAGMA optimize")
    conn.commit()
    verify(conn)
    conn.close()
    log(f"done in {time.time()-t0:.0f}s -> {DB_PATH}")

if __name__ == "__main__":
    sys.exit(main())
