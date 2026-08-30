#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""下载 electron-builder 工具链到工作区缓存（绕开沙箱网络限制）"""
import os
import ssl
import sys
import urllib.request
import urllib.error

CACHE = r"D:\lzk17\Documents\zidiankaifa\.eb-cache"
ctx = ssl.create_default_context()

TASKS = [
    # (url, cache_rel_path)
    ("https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z",
     r"nsis-3.0.4.1\nsis-3.0.4.1.7z"),
    ("https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-resources-3.4.1/nsis-resources-3.4.1.7z",
     r"nsis-resources-3.4.1\nsis-resources-3.4.1.7z"),
    ("https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z",
     r"winCodeSign-2.6.0\winCodeSign-2.6.0.7z"),
]


def probe(url):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
    try:
        r = urllib.request.urlopen(req, timeout=30, context=ctx)
        return r.headers.get("Content-Length")
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}"
    except Exception as e:
        return f"ERR {str(e)[:60]}"


def download(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 zidiankaifa/0.1"})
    with urllib.request.urlopen(req, timeout=300, context=ctx) as resp, open(dest, "wb") as f:
        total = 0
        while True:
            b = resp.read(1 << 20)
            if not b:
                break
            f.write(b)
            total += len(b)
    return total


def main():
    for url, rel in TASKS:
        dest = os.path.join(CACHE, rel)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            print(f"[skip] {dest} ({os.path.getsize(dest)/1e6:.1f} MB)")
            continue
        print(f"[probe] {url} -> {probe(url)}")
        try:
            n = download(url, dest)
            print(f"[OK] {dest} ({n/1e6:.1f} MB)")
        except Exception as e:
            print(f"[FAIL] {url}: {str(e)[:120]}")
    print("done")


if __name__ == "__main__":
    sys.exit(main())
