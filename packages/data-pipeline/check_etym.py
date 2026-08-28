#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""验证 core lookup 返回 etymology"""
import json
import sqlite3

conn = sqlite3.connect("data/db/dict.db")
# 直接模拟 core 查询
for w in ["abandon", "telephone", "city", "education", "democracy"]:
    r = conn.execute(
        "SELECT text_en, chain, origin, origin_code, source FROM word_etymology WHERE word=?", (w,)
    ).fetchone()
    if not r:
        print(f"[{w}] no etymology row")
        continue
    text_en, chain, origin, oc, src = r
    print(f"[{w}] origin={origin}({oc}) src={src}")
    print(f"   chain: {json.loads(chain)[0]['langZh'] if chain else '-'} ...")
    print(f"   text: {(text_en or '')[:100]}")
print()
n = conn.execute("SELECT COUNT(*) FROM word_etymology").fetchone()[0]
print("word_etymology total:", n)
