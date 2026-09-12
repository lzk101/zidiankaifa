# ⚠️ DEPRECATED (2026-08-31): 本脚本停用。运行它会覆盖根目录需求管理文件的废弃横幅。
# 权威文档：docs/交接文档.md / docs/需求总结.md / AGENTS.md
# -*- coding: utf-8 -*-
"""
check_requirements.py — 需求管理自动化（每半小时由后台循环调用）

职责：
1. 读取 需求总结.md 的表格（编号/需求/优先级/状态/完成判定）
2. 自动判定：完成判定含 "dist-release" → 检查 dist-release/*.exe 是否存在；
   含 "origin/main" → 检查环境变量 GIT_AHEAD 是否为 "0"（git log origin/main..HEAD 为空）
3. 状态为「已完成」的行 → 追加写入 已完成需求.md（带本轮时间戳）
4. 剩余需求按优先级排序（高>中>低）→ 重写 任务排序.md
5. 重写 需求总结.md（仅保留未完成项）+ 追加运行记录到 运行日志.md

幂等：可重复运行，不会重复归档已归档的需求。
"""
import os
import sys
import re
import glob
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
SUMMARY = os.path.join(ROOT, "需求总结.md")
DONE = os.path.join(ROOT, "已完成需求.md")
SORTED = os.path.join(ROOT, "任务排序.md")
LOG = os.path.join(ROOT, "运行日志.md")

PRIO_ORDER = {"高": 0, "中": 1, "低": 2}
DONE_MARKS = {"已完成", "✅已完成", "done", "DONE"}


def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def parse_table(text):
    """提取 markdown 表格行：| a | b | c | d | e |"""
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 4:
            continue
        if cells[0].startswith("---") or cells[0] == "" or cells[0].startswith("编号"):
            continue
        rows.append(cells)
    return rows


def auto_status(rows):
    """按完成判定自动更新状态。返回 (rows, auto_done_ids)"""
    exe_exists = bool(glob.glob(os.path.join(ROOT, "dist-release", "*.exe")))
    git_ahead = os.environ.get("GIT_AHEAD", "")
    log_ok = os.path.exists(LOG) and os.path.getsize(LOG) > 0
    auto_done = []
    for r in rows:
        check = r[4] if len(r) >= 5 else ""
        if "dist-release" in check and exe_exists:
            if r[3] not in DONE_MARKS:
                auto_done.append(r[0])
            r[3] = "已完成"
        elif "origin/main" in check and git_ahead == "0":
            if r[3] not in DONE_MARKS:
                auto_done.append(r[0])
            r[3] = "已完成"
        elif "运行日志" in check and log_ok:
            if r[3] not in DONE_MARKS:
                auto_done.append(r[0])
            r[3] = "已完成"
    return rows, auto_done


def render_table(rows):
    lines = ["| 编号 | 需求 | 优先级 | 状态 | 完成判定 |",
             "|------|------|--------|------|----------|"]
    for r in rows:
        cells = (r + [""] * 5)[:5]
        lines.append("| {} | {} | {} | {} | {} |".format(*cells))
    return "\n".join(lines)


def main():
    if not os.path.exists(SUMMARY):
        print("[ERR] 需求总结.md 不存在，先创建后再运行")
        return 1

    with open(SUMMARY, encoding="utf-8-sig") as f:
        text = f.read()

    rows = parse_table(text)
    rows, auto_done = auto_status(rows)

    done = [r for r in rows if r[3] in DONE_MARKS]
    pending = [r for r in rows if r[3] not in DONE_MARKS]
    pending.sort(key=lambda r: PRIO_ORDER.get(r[2], 99))

    ts = now_str()

    # 1) 已完成需求.md：本轮新归档追加
    if done:
        with open(DONE, "a", encoding="utf-8") as f:
            if os.path.getsize(DONE) == 0:
                f.write("# 已完成需求记录\n\n> 每半小时自动归档，仅记录归档时刻状态。\n\n")
            f.write("## {}\n\n".format(ts))
            f.write(render_table(done) + "\n\n")

    # 2) 任务排序.md：剩余需求按优先级重排
    with open(SORTED, "w", encoding="utf-8") as f:
        f.write("# 任务排序（按优先级）\n\n")
        f.write("> 更新时间：{}\n\n".format(ts))
        f.write("剩余需求 {} 项（本轮自动判定：{}）\n\n".format(len(pending),
                                                          "，".join(auto_done) if auto_done else "无"))
        if pending:
            f.write(render_table(pending) + "\n\n")
            top = pending[0]
            f.write("## 下一步建议\n\n- 优先级最高：**{} {}**（状态：{}）\n".format(top[0], top[1], top[3]))
        else:
            f.write("🎉 所有需求均已完成！\n")

    # 3) 需求总结.md：仅保留未完成项
    with open(SUMMARY, "w", encoding="utf-8") as f:
        f.write("# 需求总结（zidiankaifa 电子辞典）\n\n")
        f.write("> 本文件由 `check_requirements.py` 每半小时自动维护：状态为「已完成」的需求会自动移入 `已完成需求.md`，"
                "剩余需求按优先级重排写入 `任务排序.md`，运行记录追加到 `运行日志.md`。\n")
        f.write("> 最后更新：{}\n\n".format(ts))
        if pending:
            f.write(render_table(pending) + "\n")
        else:
            f.write("🎉 全部需求已完成，本表已清空。\n")

    # 4) 运行日志.md
    with open(LOG, "a", encoding="utf-8") as f:
        if os.path.getsize(LOG) == 0:
            f.write("# 运行日志\n\n")
        f.write("- [{}] 本轮：表格 {} 项，已完成 {}（新归档 {}），剩余 {}\n".format(
            ts, len(rows), len(done), len(auto_done), len(pending)))

    print("[{}] OK: total={} done={} auto={} pending={}".format(ts, len(rows), len(done), len(auto_done), len(pending)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
