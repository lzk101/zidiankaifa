/**
 * 只读小探针：D1 修法的**跨语言暴露面**（index.ts:851 无 isRu 守卫）
 * 只读、幂等。用法：node scripts/probe_t15_lang_exposure.mjs
 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

for (const lang of ['ru', 'en']) {
  const rows = db
    .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang=?`)
    .all(lang)
    .map((r) => ({ raw: String(r.morpheme), stem: String(r.morpheme).replace(/^-+|-+$/g, ''), kind: String(r.kind) }));
  const p1 = rows.filter((r) => r.kind === 'prefix' && r.stem.length === 1);
  const p2 = rows.filter((r) => r.kind === 'prefix' && r.stem.length === 2);
  const total = db.prepare(`SELECT COUNT(1) AS n FROM words_i18n WHERE lang=?`).get(lang).n;
  console.log(
    `lang=${lang}  词条 ${total}  词素 ${rows.length}  单字符前缀 [${p1.map((r) => r.raw).join(' ')}] (${p1.length})  双字符前缀 ${p2.length}`,
  );
}

console.log('');
console.log('英语侧 1 字符前缀是否存在（决定英语 D1 词修法后放行还是拒绝）：');
const enP1 = db
  .prepare(`SELECT morpheme, kind FROM morphemes WHERE lang='en' AND kind='prefix'`)
  .all()
  .map((r) => String(r.morpheme));
console.log(`  en 全部前缀(${enP1.length}): ${enP1.join(' ')}`);
console.log(`  其中去连字符后长度为 1 的: ${enP1.filter((m) => m.replace(/^-+|-+$/g, '').length === 1).join(' ') || '（无）'}`);

db.close();
