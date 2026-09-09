#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用 en.wiktionary 全量转储（wiktextract-all.jsonl.gz）增量补全俄语词条：
- words_i18n(lang='ru') 缺失的 forms（变格变位全 paradigm）/ phonetic / audio
- 重建 i18n_forms 反查表

数据源说明：en.wiktionary 俄语词条 forms 覆盖远高于 zh.wiktionary
（вода 49 / красный 83 / телефон 24 全 paradigm，zh 每词仅 1-2 个变格形）。
合并策略：以库中 zh 词表为主键，forms 按 (form, tags) 合并 en+zh 去重，其余字段缺失才补。
"""
import gzip
import json
import os
import sqlite3
import sys
import time

import build_db

ALL_GZ = os.path.join(build_db.RAW, "wiktextract-all.jsonl.gz")
DB_PATH = build_db.DB_PATH
RU_LANGS = {"ru", "rus", "russian"}
STRESS = "\u0301"
# kaikki 转储中的模板调试/占位 tags，无语法意义，剔除
NOISE_TAGS = {"table-tags", "inflection-template", "romanization", "canonical"}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def strip_stress(s):
    return s.replace(STRESS, "")


def norm_word(s):
    return strip_stress((s or "").strip().lower())


def clean_form(form, tags):
    """返回 (key, display, ok)。剔除噪声形式。"""
    form = (form or "").strip()
    if not form or form == "no-table-tags":
        return None
    tagset = set(tags or [])
    if tagset & {"table-tags", "inflection-template"}:
        return None
    if tagset == {"romanization"} or (len(tagset) == 1 and "romanization" in tagset):
        return None
    key = strip_stress(form)
    if not key:
        return None
    # 保留有意义 tags（去掉 canonical 本身也行，但 canonical 有展示价值）
    keep_tags = sorted(t for t in tagset if t not in NOISE_TAGS or t == "canonical")
    if not keep_tags:
        return None
    return (key, form, keep_tags)


def main():
    conn = sqlite3.connect(DB_PATH)
    if "--if-only" in sys.argv:
        # 仅重建 i18n_forms 反查表（跳过 en 转储全扫与 merge，用于快速迭代验证）
        n_if = rebuild_i18n_forms(conn)
        log(f"i18n_forms rebuilt: {n_if} rows")
        total = conn.execute("SELECT COUNT(*) FROM words_i18n WHERE lang='ru'").fetchone()[0]
        wf = conn.execute("SELECT COUNT(*) FROM words_i18n WHERE lang='ru' AND forms IS NOT NULL AND forms!=''").fetchone()[0]
        wp = conn.execute("SELECT COUNT(*) FROM words_i18n WHERE lang='ru' AND phonetic IS NOT NULL AND phonetic!=''").fetchone()[0]
        wa = conn.execute("SELECT COUNT(*) FROM words_i18n WHERE lang='ru' AND audio IS NOT NULL AND audio!=''").fetchone()[0]
        log(f"FINAL: ru_words={total} forms={wf} ({wf*100//total}%) phonetic={wp} ({wp*100//total}%) audio={wa} ({wa*100//total}%)")
        conn.close()
        return 0
    # 现有库词表与状态
    rows = conn.execute("SELECT word, phonetic, forms, audio FROM words_i18n WHERE lang='ru'").fetchall()
    cur_state = {w: {"phonetic": p, "forms": f, "audio": a} for w, p, f, a in rows}
    log(f"RU words in db: {len(cur_state)}")

    # 第一阶段：扫 en 转储，聚合俄语词条
    en_data = {}  # word -> {"forms": {key: (display, tags_json, [tags])}, "ipa": str|None, "audio": str|None}
    n_total = 0
    t0 = time.time()
    with gzip.open(ALL_GZ, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            n_total += 1
            if n_total % 2000000 == 0:
                log(f"  {n_total/1e6:.1f}M lines, en_data={len(en_data)}, {time.time()-t0:.0f}s")
            try:
                o = json.loads(line)
            except Exception:
                continue
            if (o.get("lang") or "").strip().lower() not in RU_LANGS:
                continue
            w = norm_word(o.get("word"))
            if not w or w not in cur_state:
                continue  # 只补库中已有词
            rec = en_data.setdefault(w, {"forms": {}, "ipa": None, "audio": None})
            # IPA
            if not rec["ipa"]:
                for s in o.get("sounds") or []:
                    ipa = (s.get("ipa") or "").strip()
                    if ipa:
                        rec["ipa"] = ipa
                        break
            # 音频
            if not rec["audio"]:
                for s in o.get("sounds") or []:
                    m = (s.get("mp3_url") or "").strip()
                    if m:
                        rec["audio"] = m
                        break
            # 词形
            for fo in o.get("forms") or []:
                cf = clean_form(fo.get("form"), fo.get("tags") or [])
                if not cf:
                    continue
                key, display, tags = cf
                tkey = json.dumps(tags, ensure_ascii=False)
                rec["forms"][key + "\x00" + tkey] = {"d": display, "t": tags}
    log(f"scan done: lines={n_total}, matched words={len(en_data)}, {time.time()-t0:.0f}s")

    # 第二阶段：合并回库
    n_upd_forms = n_upd_ipa = n_upd_audio = 0
    n_forms_total = 0
    buf = []
    t1 = time.time()

    def flush_updates():
        nonlocal n_upd_forms, n_upd_ipa, n_upd_audio, n_forms_total
        cur = conn.cursor()
        cur.execute("BEGIN")
        for w, rec in buf:
            old = cur_state[w]
            # 合并 forms：库中 zh forms 保留 + en forms 补入（键去重）
            merged = {}
            try:
                zh_forms = json.loads(old["forms"]) if old["forms"] else []
            except Exception:
                zh_forms = []
            for it in zh_forms:
                k = it.get("form", "")
                tk = json.dumps(sorted(it.get("tags") or []), ensure_ascii=False)
                merged[k + "\x00" + tk] = {"d": it.get("display", k), "t": sorted(it.get("tags") or [])}
            for k, v in rec["forms"].items():
                merged[k] = v  # en 覆盖同键
            forms_list = [{"form": k.split("\x00")[0], "display": v["d"], "tags": v["t"]} for k, v in merged.items()]
            forms_json = json.dumps(forms_list, ensure_ascii=False) if forms_list else None
            phonetic = old["phonetic"] or rec["ipa"]
            audio = old["audio"] or rec["audio"]
            changed = (forms_json != (old["forms"] or None)) or (phonetic != old["phonetic"]) or (audio != old["audio"])
            if changed:
                cur.execute(
                    "UPDATE words_i18n SET forms=?, phonetic=?, audio=? WHERE word=? AND lang='ru'",
                    (forms_json, phonetic, audio, w),
                )
                if forms_json and forms_json != (old["forms"] or None):
                    n_upd_forms += 1
                if phonetic and not old["phonetic"]:
                    n_upd_ipa += 1
                if audio and not old["audio"]:
                    n_upd_audio += 1
            n_forms_total += len(forms_list) if forms_list else 0
        cur.execute("COMMIT")
        buf.clear()

    for w, rec in en_data.items():
        buf.append((w, rec))
        if len(buf) >= 50000:
            flush_updates()
            log(f"  merged ~{w}, forms_done={n_upd_forms}")
    if buf:
        flush_updates()
    conn.commit()
    log(f"merge done: forms_updated={n_upd_forms} ipa_added={n_upd_ipa} audio_added={n_upd_audio} forms_total={n_forms_total} {time.time()-t1:.0f}s")
    n_if = rebuild_i18n_forms(conn)
    log(f"i18n_forms rebuilt: {n_if} rows")

    # 统计
    total = conn.execute("SELECT COUNT(*) FROM words_i18n WHERE lang='ru'").fetchone()[0]
    wf = conn.execute("SELECT COUNT(*) FROM words_i18n WHERE lang='ru' AND forms IS NOT NULL AND forms!=''").fetchone()[0]
    wp = conn.execute("SELECT COUNT(*) FROM words_i18n WHERE lang='ru' AND phonetic IS NOT NULL AND phonetic!=''").fetchone()[0]
    wa = conn.execute("SELECT COUNT(*) FROM words_i18n WHERE lang='ru' AND audio IS NOT NULL AND audio!=''").fetchone()[0]
    log(f"FINAL: ru_words={total} forms={wf} ({wf*100//total}%) phonetic={wp} ({wp*100//total}%) audio={wa} ({wa*100//total}%)")
    conn.close()
    return 0


def rebuild_i18n_forms(conn):
    """重建 i18n_forms 反查表：同 form+word 的多种 tags 变体聚合 union，
    避免 INSERT OR REPLACE 互相覆盖导致 case 标注丢失。返回插入行数。"""
    agg = {}  # (form, word) -> set(tags)
    for (w, forms_json) in conn.execute("SELECT word, forms FROM words_i18n WHERE lang='ru' AND forms IS NOT NULL"):
        try:
            fl = json.loads(forms_json)
        except Exception:
            continue
        for it in fl:
            k = it.get("form", "")
            if k and k != w:
                agg.setdefault((k, w), set()).update(it.get("tags") or [])
    conn.execute("DELETE FROM i18n_forms WHERE lang='ru'")
    cur = conn.cursor()
    n_if = 0
    for (k, w), tags in agg.items():
        cur.execute(
            "INSERT INTO i18n_forms (form, word, lang, tags) VALUES (?,?,?,?)",
            (k, w, "ru", json.dumps(sorted(tags), ensure_ascii=False)),
        )
        n_if += 1
    conn.commit()
    return n_if


if __name__ == "__main__":
    sys.exit(main())
