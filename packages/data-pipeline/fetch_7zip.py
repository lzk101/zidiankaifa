#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""下载 7zip-win-x64 工具包并校验 sha256，解压出 7za.exe"""
import hashlib
import io
import os
import ssl
import sys
import tarfile
import urllib.request

CACHE = r"D:\lzk17\Documents\zidiankaifa\.eb-cache"
URL = "https://github.com/electron-userland/electron-builder-binaries/releases/download/7zip@1.0.0/7zip-win-x64.tar.gz"
EXPECTED = "be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3"
DEST = os.path.join(CACHE, "7zip@1.0.0", "7zip-win-x64.tar.gz")
ctx = ssl.create_default_context()


def main():
    os.makedirs(os.path.dirname(DEST), exist_ok=True)
    if not (os.path.exists(DEST) and os.path.getsize(DEST) > 0):
        print("downloading...")
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=300, context=ctx) as resp, open(DEST, "wb") as f:
            while True:
                b = resp.read(1 << 20)
                if not b:
                    break
                f.write(b)
    h = hashlib.sha256()
    with open(DEST, "rb") as f:
        while True:
            b = f.read(1 << 20)
            if not b:
                break
            h.update(b)
    digest = h.hexdigest()
    print("sha256:", digest)
    print("match:", digest == EXPECTED)
    # 解压出 7za.exe
    out = os.path.join(CACHE, "7zip-extracted")
    os.makedirs(out, exist_ok=True)
    with tarfile.open(DEST, "r:gz") as tf:
        tf.extractall(out, filter="data")
    exe = os.path.join(out, "bin", "7za.exe")
    print("7za.exe exists:", os.path.exists(exe))
    if not os.path.exists(exe):
        print("files:", [os.path.join(r, f) for r, _, fs in os.walk(out) for f in fs][:10])
    sys.exit(0 if digest == EXPECTED else 1)


if __name__ == "__main__":
    sys.exit(main())
