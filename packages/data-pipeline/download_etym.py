#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""下载 wiktextract 全量转储 + zh 转储（支持断点续传，进度日志）"""
import os
import ssl
import sys
import time
import urllib.request

RAW = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "raw"))
os.makedirs(RAW, exist_ok=True)
ctx = ssl.create_default_context()

TASKS = [
    ("https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz",
     os.path.join(RAW, "wiktextract-all.jsonl.gz")),
    ("https://kaikki.org/dictionary/downloads/zh/zh-extract.jsonl.gz",
     os.path.join(RAW, "wiktextract-zh.jsonl.gz")),
]


def download_resume(url, dest):
    tmp = dest + ".part"
    headers = {"User-Agent": "Mozilla/5.0 zidiankaifa/0.1"}
    # 总大小
    req = urllib.request.Request(url, method="HEAD", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=40, context=ctx) as r:
            total = int(r.headers.get("Content-Length") or 0)
    except Exception:
        total = 0
    have = os.path.getsize(tmp) if os.path.exists(tmp) else 0
    if total and have >= total:
        os.replace(tmp, dest)
        print(f"[skip] {dest} ({total/1e9:.2f} GB)", flush=True)
        return True
    if have > 0:
        headers["Range"] = f"bytes={have}-"
        print(f"[resume] {url} from {have/1e6:.0f} MB", flush=True)
    t0 = time.time()
    last_log = t0
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=120, context=ctx) as resp, open(tmp, "ab") as f:
            while True:
                b = resp.read(1 << 20)
                if not b:
                    break
                f.write(b)
                have += len(b)
                now = time.time()
                if now - last_log >= 20:
                    spd = have / 1e6 / (now - t0)
                    pct = f"{have/total*100:.1f}%" if total else "?"
                    print(f"  {pct}  {have/1e9:.2f}/{total/1e9:.2f} GB  {spd:.1f} MB/s", flush=True)
                    last_log = now
        if total and have != total:
            print(f"[warn] size mismatch got {have} want {total}", flush=True)
            return False
        os.replace(tmp, dest)
        print(f"[OK] {url} -> {dest} ({have/1e9:.2f} GB)", flush=True)
        return True
    except Exception as e:
        print(f"[fail] {url}: {e}", flush=True)
        return False


def main():
    ok = True
    for url, dest in TASKS:
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            print(f"[skip] {dest} already present", flush=True)
            continue
        ok = download_resume(url, dest) and ok
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
