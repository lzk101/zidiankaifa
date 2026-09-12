# -*- coding: utf-8 -*-
"""俄语词源与词根词缀数据入库

- zh 转储俄语词条：etymology_texts（中文，繁体）→ 简体 → word_etymology.text_zh
  并从中文文本解析结构化派生链（链步骤 = 语言名 + 可选词形）→ chain / origin
- en 转储俄语词条：etymology_text（英文）→ text_en；etymology_templates → chain（结构化，优先）
- roots_ru.json → morphemes(lang='ru')

用法：
  python build_ru_etym.py            # zh + en + roots 全量
  python build_ru_etym.py --zh-only  # 仅中文词源
  python build_ru_etym.py --en-only  # 仅英文词源/模板链
  python build_ru_etym.py --roots-only
"""
import gzip
import io
import json
import os
import re
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_db

sys.path.insert(0, os.path.normpath(os.path.join(build_db.ROOT, "data", "py-deps")))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ZH_GZ = os.path.join(build_db.RAW, "wiktextract-zh.jsonl.gz")
EN_GZ = os.path.join(build_db.RAW, "wiktextract-all.jsonl.gz")
DB_PATH = build_db.DB_PATH
ROOTS_RU_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "roots_ru.json")
OUT_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_ru_etym_stats.json")

RU_LANGS = {"ru", "rus", "russian", "俄语", "俄語"}
STRESS = "\u0301"

# 词源文本中的语言名（简体，t2s 之后匹配）；长名优先
ZH_LANGS = [
    "原始波羅的-斯拉夫語", "原始印歐語", "原始斯拉夫語", "原始日耳曼語", "原始波羅的語",
    "古東斯拉夫語", "古教會斯拉夫語", "教會斯拉夫語", "塞爾維亞-克羅地亞語", "中古英語",
    "古普魯士語", "古諾斯語", "古希臘語", "古英語", "古法語", "古高地德語",
    "突厥語族", "斯拉夫語", "日耳曼語", "凱爾特語", "波羅的語",
    "拉丁語", "梵語", "波斯語", "阿拉伯語", "德語", "法語", "英語", "意大利語",
    "波蘭語", "烏克蘭語", "白俄羅斯語", "保加利亞語", "芬蘭語", "荷蘭語", "西班牙語",
    "日語", "漢語", "俄語", "立陶宛語", "拉脫維亞語", "哥特語", "阿爾巴尼亞語",
    "亞美尼亞語", "愛爾蘭語", "威爾士語", "希臘語", "瑞典語", "丹麥語", "挪威語",
    "捷克語", "斯洛伐克語", "斯洛文尼亞語", "馬其頓語", "土耳其語", "蒙古語",
    "芬蘭-烏戈爾語", "烏拉爾語", "閃米特語", "希伯來語", "意第緒語",
]
# t2s 后使用（build_db 里的简体形式）
ZH_LANGS_SIMP = None  # 运行时用 t2s 转换

LANG_CODE = {
    "原始印欧语": "ine-pro", "原始斯拉夫语": "sla-pro", "原始波罗的-斯拉夫语": "ine-bsl-pro",
    "原始日耳曼语": "gem-pro", "原始波罗的语": "bat-pro", "古东斯拉夫语": "orv",
    "古教会斯拉夫语": "cu", "教会斯拉夫语": "cu", "斯拉夫语": "sla", "中古英语": "enm",
    "古英语": "ang", "古希腊语": "grc", "古希腊语": "grc", "希腊语": "el",
    "拉丁语": "la", "古法语": "fro", "法语": "fr", "德语": "de", "古高地德语": "goh",
    "英语": "en", "突厥语族": "trk", "古突厥语": "otk", "梵语": "sa", "波斯语": "fa",
    "阿拉伯语": "ar", "意大利语": "it", "波兰语": "pl", "乌克兰语": "uk",
    "白俄罗斯语": "be", "保加利亚语": "bg", "芬兰语": "fi", "荷兰语": "nl",
    "西班牙语": "es", "日语": "ja", "汉语": "zh", "俄语": "ru", "立陶宛语": "lt",
    "拉脱维亚语": "lv", "哥特语": "got", "阿尔巴尼亚语": "sq", "亚美尼亚语": "hy",
    "爱尔兰语": "ga", "威尔士语": "cy", "瑞典语": "sv", "丹麦语": "da", "挪威语": "no",
    "捷克语": "cs", "斯洛伐克语": "sk", "斯洛文尼亚语": "sl", "马其顿语": "mk",
    "土耳其语": "tr", "蒙古语": "mn", "希伯来语": "he", "意第绪语": "yi",
    "古诺斯语": "non", "古普鲁士语": "prg", "塞尔维亚-克罗地亚语": "sh",
    "古普рус语": "prg",
}
# 词形 token：西里尔 / 希腊 / 拉丁 / 星号重构形
WORD_RE = r"\*?[\w\u0400-\u04FF\u0370-\u03FF\u0100-\u024F\u1E00-\u1EFF'’\u0301-]{1,40}"
# en 转储的 lang 值是 "Russian"/"ru" 等（不是字符串 '"lang": "ru"'），需正则宽松匹配；
# 用字面串过滤会漏掉全部词条（曾只剩 3 条）
RU_LINE_RE = re.compile(r'"lang"\s*:\s*"(?:ru|rus|russian|俄语|俄語)"', re.IGNORECASE)


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def strip_stress(s):
    return s.replace(STRESS, "")


def ensure_columns(conn):
    """老库补 lang 列"""
    for table in ("word_etymology", "morphemes"):
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
        if not cols:
            continue
        if "lang" not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'")
            log(f"migrated {table}: added lang column")
    conn.commit()


def build_chain_regex(t2s):
    global ZH_LANGS_SIMP
    ZH_LANGS_SIMP = sorted({t2s.convert(x) for x in ZH_LANGS}, key=len, reverse=True)
    return re.compile(
        "(" + "|".join(re.escape(x) for x in ZH_LANGS_SIMP) + r")\s*" + f"({WORD_RE})?"
    )


def parse_zh_chain(text, lang_re):
    """从中文词源文本解析派生链（语言名 + 可选词形），按出现顺序去重。

    同源比较（「与…同源」整句）不是来源链，标记 kind='cognate' 且不参与 origin 计算——
    否则 вода 会被判成「源自英语 water」（末尾出现「与…英语 whisky/water 同源」）。
    判定按【句子】粒度：含「同源」的句子内所有语言名均为 cognate。
    """
    steps = []
    for sent in re.split(r"[。；\n]", text or ""):
        if not sent.strip():
            continue
        sent_cognate = "同源" in sent
        for m in lang_re.finditer(sent):
            name = m.group(1)
            word = (m.group(2) or "").strip()
            if word and word in ZH_LANGS_SIMP:  # 相邻语言名，跳过后半
                word = ""
            if word and ("同源" in word or len(word) > 20):  # 「与英语 whisky和water同源」这类说明不是词形
                word = ""
            prefix = sent[max(0, m.start() - 4):m.start()]
            is_cognate = sent_cognate or any(ch in prefix for ch in ("与", "與", "和", "同源"))
            step = {
                "lang": LANG_CODE.get(name, name),
                "langZh": name,
                "word": word or None,
                "kind": "cognate" if is_cognate else "inh",
            }
            if steps and steps[-1]["langZh"] == step["langZh"] and steps[-1]["word"] == step["word"]:
                continue
            steps.append(step)
    return steps[:14]


def chain_origin(chain):
    """最深层真实来源：链中最后一个非同源（cognate）步骤"""
    for s in reversed(chain or []):
        if s.get("kind") != "cognate":
            return s
    return None


def collect_zh(t2s, lang_re, ru_words):
    """zh 转储：俄语词条中文词源"""
    out = {}
    n = 0
    with gzip.open(ZH_GZ, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            n += 1
            if '"lang"' not in line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            if (o.get("lang") or "").strip().lower() not in RU_LANGS:
                continue
            w = strip_stress((o.get("word") or "").strip().lower())
            if w not in ru_words:
                continue
            texts = o.get("etymology_texts")
            raw = ""
            if isinstance(texts, list) and texts:
                raw = "\n".join(str(t) for t in texts if t)
            elif o.get("etymology_text"):
                raw = str(o["etymology_text"])
            if not raw.strip():
                continue
            zh = t2s.convert(strip_stress(raw)).strip()
            if not zh:
                continue
            prev = out.get(w)
            if prev and len(prev["text_zh"]) >= len(zh):
                continue
            chain = parse_zh_chain(zh, lang_re)
            deep = chain_origin(chain)
            out[w] = {
                "text_zh": zh[:4000],
                "chain": chain,
                "origin": deep["langZh"] if deep else None,
                "origin_code": deep["lang"] if deep else None,
            }
    log(f"zh dump: {n:,} lines scanned, 俄语中文词源 {len(out):,} 条")
    return out


def collect_en(ru_words):
    """en 转储：俄语词条英文词源 + 模板链 + 构词模板（用于词素库校验）"""
    from build_wiktextract import parse_chain

    out = {}
    compound = {}   # morpheme -> count（从 {{af|ru|...}} 等模板提取）
    n = 0
    t0 = time.time()
    with gzip.open(EN_GZ, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            n += 1
            if not RU_LINE_RE.search(line):
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            if (o.get("lang") or "").strip().lower() not in RU_LANGS:
                continue
            w = strip_stress((o.get("word") or "").strip().lower())
            if w not in ru_words:
                continue
            text_en = strip_stress(o.get("etymology_text") or "").strip()
            tmpls = o.get("etymology_templates") or []
            chain = parse_chain(tmpls)
            for t in tmpls:
                if not isinstance(t, dict):
                    continue
                nm = (t.get("name") or "").strip()
                if nm not in ("af", "pre", "suf", "prefix", "suffix", "compound", "con"):
                    continue
                args = t.get("args") or {}
                for i in range(2, 8):
                    part = str(args.get(str(i), "")).strip()
                    if part and part not in ("ru", "sla-pro", "ine-pro", "grc", "la"):
                        compound[part] = compound.get(part, 0) + 1
            if not text_en and not chain:
                continue
            prev = out.get(w)
            if prev and (prev.get("text_en") or "") and text_en:
                continue
            out[w] = {"text_en": text_en[:4000] or None, "chain": chain}
            if len(out) % 20000 == 0:
                log(f"  en ru entries: {len(out):,} ({time.time()-t0:.0f}s)")
    log(f"en dump: {n:,} lines scanned, 俄语词源 {len(out):,} 条, 构词模板词素 {len(compound):,} 个")
    return out, compound


def upsert_etym(conn, zh_map, en_map):
    """合并写入：只覆盖本次提供的字段，未提供的保留库中原值。

    zh-only / en-only 分开跑时若用整行 REPLACE 会互相清空（en 跑完 text_zh 归零），
    故先读旧行做字段级合并。
    """
    cur = conn.cursor()
    cur.execute("BEGIN")
    n_ins = n_upd = 0
    words = set(zh_map) | set(en_map)
    for w in words:
        z = zh_map.get(w)
        e = en_map.get(w)
        old = cur.execute(
            "SELECT text_en, text_zh, chain, origin, origin_code, source FROM word_etymology WHERE word=? AND lang='ru'",
            (w,),
        ).fetchone()
        o_en, o_zh, o_chain, o_org, o_orgc, o_src = old if old else (None, None, None, None, None, None)

        text_zh = (z["text_zh"] if z else None) or o_zh
        text_en = (e["text_en"] if e else None) or o_en

        # 链优先级：中文文本链（已做同源 cognate 判定、经抽样验证）> 库中已有链 > en 模板链。
        # en 模板链由 parse_chain 生成，cog/ncog（同源）步骤未标注，作 origin 会把
        # 「与英语同源」误判成「源自英语」（вода→en、стол→en 的回归即此因）。
        new_chain = None
        if z and z["chain"]:
            new_chain = z["chain"]
        elif not o_chain and e and e["chain"]:
            new_chain = e["chain"]
        if new_chain:
            for s in new_chain:
                if s.get("kind") in ("cog", "ncog"):
                    s["kind"] = "cognate"
            chain = new_chain
        elif o_chain:
            try:
                chain = json.loads(o_chain)
            except Exception:
                chain = []
        else:
            chain = []

        deep = chain_origin(chain)
        if deep:
            origin_zh, origin_code = deep.get("langZh"), deep.get("lang")
        elif chain and chain[-1].get("langZh"):
            origin_zh, origin_code = chain[-1]["langZh"], chain[-1].get("lang")
        else:
            origin_zh = (z["origin"] if z else None) or o_org
            origin_code = (z["origin_code"] if z else None) or o_orgc

        if text_en and text_zh:
            src = "en+zh"
        elif text_zh:
            src = "zh"
        elif text_en:
            src = "en"
        else:
            src = o_src

        cur.execute(
            "INSERT OR REPLACE INTO word_etymology (word, lang, text_en, text_zh, chain, origin, origin_code, source) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (w, "ru", text_en, text_zh,
             json.dumps(chain, ensure_ascii=False) if chain else None,
             origin_zh, origin_code, src),
        )
        if old:
            n_upd += 1
        else:
            n_ins += 1
    cur.execute("COMMIT")
    log(f"word_etymology[ru]: 新增 {n_ins:,} / 合并更新 {n_upd:,}（本次词条 {len(words):,}）")


def build_roots_ru(conn):
    if not os.path.exists(ROOTS_RU_JSON):
        log("SKIP roots_ru.json missing")
        return 0
    with open(ROOTS_RU_JSON, encoding="utf-8") as f:
        data = json.load(f)
    cur = conn.cursor()
    cur.execute("BEGIN")
    for m in data:
        cur.execute(
            "INSERT OR REPLACE INTO morphemes (morpheme, lang, kind, meaning_zh, meaning_en, origin, examples) VALUES (?,?,?,?,?,?,?)",
            (m["morpheme"], "ru", m["kind"], m.get("meaningZh", ""), m.get("meaningEn"),
             m.get("origin"), json.dumps(m.get("examples", []), ensure_ascii=False)),
        )
    cur.execute("COMMIT")
    kinds = {}
    for m in data:
        kinds[m["kind"]] = kinds.get(m["kind"], 0) + 1
    log(f"morphemes[ru]: {len(data)} ({kinds})")
    return len(data)


def main():
    argv = sys.argv[1:]
    only_zh = "--zh-only" in argv
    only_en = "--en-only" in argv
    only_roots = "--roots-only" in argv

    from opencc import OpenCC

    t2s = OpenCC("t2s")
    lang_re = build_chain_regex(t2s)

    conn = sqlite3.connect(DB_PATH)
    ensure_columns(conn)
    ru_words = {r[0] for r in conn.execute("SELECT word FROM words_i18n WHERE lang='ru'")}
    log(f"库中俄语词条: {len(ru_words):,}")

    zh_map = en_map = {}
    compound = {}
    if only_roots:
        pass
    elif only_zh:
        zh_map = collect_zh(t2s, lang_re, ru_words)
        upsert_etym(conn, zh_map, {})
    elif only_en:
        en_map, compound = collect_en(ru_words)
        upsert_etym(conn, {}, en_map)
    else:
        zh_map = collect_zh(t2s, lang_re, ru_words)
        en_map, compound = collect_en(ru_words)
        upsert_etym(conn, zh_map, en_map)

    if not (only_zh or only_en):
        build_roots_ru(conn)

    # 统计
    stats = {
        "ru_words": len(ru_words),
        "zh_etym": len(zh_map),
        "en_etym": len(en_map),
        "with_chain": int(conn.execute("SELECT COUNT(*) FROM word_etymology WHERE lang='ru' AND chain IS NOT NULL").fetchone()[0]),
        "total_ru_etym": int(conn.execute("SELECT COUNT(*) FROM word_etymology WHERE lang='ru'").fetchone()[0]),
        "morphemes_ru": int(conn.execute("SELECT COUNT(*) FROM morphemes WHERE lang='ru'").fetchone()[0]),
        "morphemes_en": int(conn.execute("SELECT COUNT(*) FROM morphemes WHERE lang='en'").fetchone()[0]),
    }
    if compound:
        top = sorted(compound.items(), key=lambda kv: -kv[1])[:60]
        stats["template_morphemes_top"] = top
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=1)
    log(f"STATS: {json.dumps({k: v for k, v in stats.items() if k != 'template_morphemes_top'}, ensure_ascii=False)}")

    # 抽样验证
    for w in ("вода", "телефон", "стол", "читать", "хороший", "книга", "человек"):
        r = conn.execute("SELECT text_zh, origin, source FROM word_etymology WHERE word=? AND lang='ru'", (w,)).fetchone()
        if r:
            log(f"  {w}: origin={r[1]} src={r[2]} | {(r[0] or '')[:90]}")
    conn.commit()
    conn.close()
    log("DONE")


if __name__ == "__main__":
    main()
