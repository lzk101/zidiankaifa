#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抽查词级演变链"""
import json
import sqlite3

conn = sqlite3.connect("data/db/dict.db")
for w in ["city", "telephone", "run", "water", "education", "democracy", "abandon", "hello"]:
    r = conn.execute("SELECT origin, lineage_words, depth FROM word_origins WHERE word=?", (w,)).fetchone()
    if r:
        lw = json.loads(r[1]) if r[1] else []
        chain = " ← ".join(f"{s['w']}({s['lz']})" for s in lw)
        print(f"{w} => {r[0]} | {chain} | depth {r[2]}")
    else:
        print(f"{w} => None")
