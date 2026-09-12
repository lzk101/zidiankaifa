"""勘察：en 转储中俄语词条的构词模板 → 候选词素频次（用于扩充 roots_ru.json）

只读源数据，不改库。输出候选清单到 packages/data-pipeline/_ru_compound_candidates.json
"""
import sys, json, gzip, re, time, sqlite3
from collections import Counter

sys.path.insert(0, 'packages/data-pipeline')
import build_ru_etym as B

EN_GZ = B.EN_GZ
RU_LANGS = B.RU_LANGS
RU_LINE_RE = B.RU_LINE_RE
LANG_ARGS = {'ru', 'sla-pro', 'ine-pro', 'grc', 'la', 'orv', 'zle-ort', 'cu', 'got', 'en', 'de', 'fr'}

conn = sqlite3.connect('data/db/dict.db')
have = {r[0] for r in conn.execute("SELECT morpheme FROM morphemes WHERE lang='ru'")}
ru_words = {r[0] for r in conn.execute("SELECT word FROM words_i18n WHERE lang='ru'")}
conn.close()
print(f"库中俄语词条 {len(ru_words):,}，已有俄语词素 {len(have)}")

counter = Counter()
examples = {}
with_compound = 0
scanned = 0
t0 = time.time()
with gzip.open(EN_GZ, 'rt', encoding='utf-8', errors='replace') as f:
    for line in f:
        scanned += 1
        if not RU_LINE_RE.search(line):
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        if (o.get('lang') or '').strip().lower() not in RU_LANGS:
            continue
        w = (o.get('word') or '').strip()
        if not w:
            continue
        hit = False
        for t in (o.get('etymology_templates') or []):
            if not isinstance(t, dict):
                continue
            nm = (t.get('name') or '').strip()
            if nm not in ('af', 'pre', 'suf', 'prefix', 'suffix', 'compound', 'con'):
                continue
            args = t.get('args') or {}
            for i in range(2, 8):
                part = str(args.get(str(i), '')).strip()
                if not part or part in LANG_ARGS:
                    continue
                if not re.fullmatch(r'[\u0400-\u04FF-]{2,}', part):
                    continue
                counter[part] += 1
                hit = True
                ex = examples.setdefault(part, [])
                if len(ex) < 6 and w not in ex:
                    ex.append(w)
        if hit:
            with_compound += 1

print(f"扫描 {scanned:,} 行，{time.time()-t0:.0f}s；带构词模板的俄语词条 {with_compound:,}")
new = [(m, c) for m, c in counter.most_common() if m not in have]
print(f"构词模板词素 {len(counter):,} 个，其中库中已有 {len(counter)-len(new):,}，未收录候选 {len(new):,}")
print("\n未收录候选 TOP 40（频次 / 例词）:")
for m, c in new[:40]:
    print(f"  {m:18s} {c:5d}  {', '.join(examples[m][:4])}")

out = [{'morpheme': m, 'count': c, 'examples': examples[m]} for m, c in new[:300]]
with open('packages/data-pipeline/_ru_compound_candidates.json', 'w', encoding='utf-8') as fh:
    json.dump(out, fh, ensure_ascii=False, indent=1)
print(f"\n候选已写出: packages/data-pipeline/_ru_compound_candidates.json ({len(out)} 条)")
