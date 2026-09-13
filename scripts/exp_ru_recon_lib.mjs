/** 只读勘察：俄语词素库内容（回答「补哪些词素」的前置事实） */
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/db/dict.db', { readOnly: true });

const all = db.prepare(`SELECT morpheme, kind, length(morpheme) AS n FROM morphemes WHERE lang='ru'`).all();
const byKind = { prefix: [], suffix: [], root: [] };
for (const m of all) (byKind[m.kind] ??= []).push(String(m.morpheme));

for (const k of ['prefix', 'suffix', 'root']) {
  const list = byKind[k].sort();
  console.log(`\n===== ru ${k} (${list.length}) =====`);
  console.log(list.join(' '));
}

const probe = ['-ский', '-ный', '-изм', '-ист', '-ия', '-очка', '-истый', '-ость', '-ать', '-ние', '-ься', '-ство', '-ция', '-ов', '-тель', '-ник', '-щик', '-ец', '-ка', '-ина'];
const set = new Set(all.map((m) => String(m.morpheme)));
console.log('\n===== 主管举例候选是否存在 =====');
for (const p of probe) {
  console.log(`  ${p.padEnd(10)} ${set.has(p) ? '已在库' : '★不在库'}`);
}
db.close();
