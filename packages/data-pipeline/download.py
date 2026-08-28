#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download dictionary data sources into data/raw/ (resumable via .part files)."""
import os
import sys
import ssl
import time
import urllib.request

RAW = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "raw"))
os.makedirs(RAW, exist_ok=True)

ctx = ssl.create_default_context()
ctx_insecure = ssl._create_unverified_context()  # let.rug.nl has an incomplete chain


def download(url, dest, expected_size=None, insecure=False, retries=3, chunk=1 << 20):
    tmp = dest + ".part"
    ctx_use = ctx_insecure if insecure else ctx
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 zidiankaifa/0.1"})
            with urllib.request.urlopen(req, timeout=90, context=ctx_use) as resp, open(tmp, "wb") as f:
                total = 0
                while True:
                    b = resp.read(chunk)
                    if not b:
                        break
                    f.write(b)
                    total += len(b)
            if expected_size is not None and total != expected_size:
                raise IOError(f"size mismatch: got {total}, expected {expected_size}")
            os.replace(tmp, dest)
            print(f"[OK] {url} -> {dest} ({total/1e6:.1f} MB)", flush=True)
            return True
        except Exception as e:  # noqa: BLE001
            print(f"[retry {attempt}/{retries}] {url}: {e}", flush=True)
            time.sleep(2 * attempt)
    return False


def main():
    tasks = [
        ("https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv",
         os.path.join(RAW, "ecdict.csv"), 65933428, False),
        ("https://archive.org/download/etymwn-20130208/etymwn-20130208.zip",
         os.path.join(RAW, "etymwn-20130208.zip"), 27504275, True),
    ]
    ok = True
    for url, dest, size, insecure in tasks:
        if os.path.exists(dest) and (size is None or os.path.getsize(dest) == size):
            print(f"[skip] {dest} already present", flush=True)
            continue
        ok = download(url, dest, size, insecure) and ok
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
