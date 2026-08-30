#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""绕过 pip：从 PyPI 下载 opencc-python-reimplemented 纯 Python wheel 并解压到 data/py-deps"""
import json
import os
import ssl
import sys
import urllib.request
import zipfile

ctx = ssl.create_default_context()
TARGET = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "py-deps"))
os.makedirs(TARGET, exist_ok=True)


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "zidiankaifa/0.1"})
    return urllib.request.urlopen(req, timeout=timeout, context=ctx).read()


def main():
    info = json.loads(fetch("https://pypi.org/pypi/opencc-python-reimplemented/json"))
    ver = info["info"]["version"]
    wheel = None
    for f in info["releases"][ver]:
        if f["filename"].endswith(".whl") and "py3-none-any" in f["filename"]:
            wheel = f
            break
    if not wheel:
        print("no wheel found"); return 1
    print("download:", wheel["filename"])
    data = fetch(wheel["url"], timeout=180)
    wpath = os.path.join(TARGET, wheel["filename"])
    with open(wpath, "wb") as f:
        f.write(data)
    with zipfile.ZipFile(wpath) as z:
        z.extractall(TARGET)
    os.remove(wpath)
    sys.path.insert(0, TARGET)
    try:
        from opencc import OpenCC
        c = OpenCC("t2s")
        print("opencc OK:", c.convert("說話，講話；談論"))
    except Exception as e:
        print("opencc import FAIL:", e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
