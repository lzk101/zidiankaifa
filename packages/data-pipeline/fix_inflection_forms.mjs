/**
 * 补全 i18n_forms：为「纯屈折说明但无 i18n_forms 记录」的词形补建反查记录
 *
 * 这些词形的释义形如「а̀виакосми́ческий (àviakosmíčeskij) 的阴性主格单数」，
 * 主词条与语法标签都在文本里，可解析后写入 i18n_forms，使其也能反查到主词条。
 *
 * 用法: node packages/data-pipeline/fix_inflection_forms.mjs [--apply]
 * 注意：须从**仓库根**运行（`data/db/dict.db` 为相对仓库根的路径）。
 */
import { DatabaseSync } from 'node:sqlite';
import { RUS_TAG_LABEL } from '../../packages/core/dist/lang.js';

const APPLY = process.argv.includes('--apply');
const db = new DatabaseSync('data/db/dict.db');

const isInf = (text) => {
  const t = (text ?? '').trim();
  if (!t) return false;
  const parts = t.split(/[；;]/).map(s => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(p => /的[^，。；]{0,8}(格|数|时|式|体)/.test(p));
};
/** 去重音符号（组合符）与括号注音 */
const stripStress = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ё/g, 'ё').trim();

const tagZh2En = Object.fromEntries(Object.entries(RUS_TAG_LABEL).map(([en, zh]) => [zh, en]));
const ZH_TAGS = Object.keys(tagZh2En).sort((a, b) => b.length - a.length);

const rows = db.prepare(`SELECT w.word, w.translation FROM words_i18n w
  WHERE w.lang='ru' AND NOT EXISTS (SELECT 1 FROM i18n_forms f WHERE f.form=w.word AND f.lang='ru')`).all();
const infRows = rows.filter(r => isInf(r.translation));
console.log(`无 i18n_forms 记录的词条 ${rows.length}；其中纯屈折说明 ${infRows.length}`);

const existsBase = db.prepare("SELECT 1 FROM words_i18n WHERE word=? AND lang='ru'");
const insert = db.prepare("INSERT OR REPLACE INTO i18n_forms (form, word, lang, tags) VALUES (?,?,?,?)");

const plan = [];
let noBase = 0, noTags = 0, badParse = 0;
for (const r of infRows) {
  const t = String(r.translation ?? '');
  // 取首个「；」段解析：<主词条> 的 <维度>
  const seg = t.split(/[；;]/)[0].trim();
  const m = seg.match(/^(.+?)\s*的\s*(.+)$/);
  if (!m) { badParse++; continue; }
  const head = m[1].replace(/\([^)]*\)/g, ' ').trim().split(/\s+/)[0];
  const base = stripStress(head);
  const dims = m[2];
  const tags = [];
  for (const zh of ZH_TAGS) if (dims.includes(zh)) tags.push(tagZh2En[zh]);
  if (!tags.length) { noTags++; continue; }
  if (!existsBase.get(base)) { noBase++; continue; }
  plan.push({ form: r.word, base, tags: [...new Set(tags)].sort() });
}

console.log(`可补建 ${plan.length}（主词条不存在 ${noBase}；无可用标签 ${noTags}；解析失败 ${badParse}）`);
console.log('\n样例:');
for (const p of plan.slice(0, 12)) console.log(`  ${p.form.padEnd(22)} → ${p.base.padEnd(20)} [${p.tags.join(', ')}]`);

if (!APPLY) { console.log('\n[dry-run] 未写库。加 --apply 执行。'); db.close(); process.exit(0); }

db.exec(`CREATE TABLE IF NOT EXISTS i18n_forms_fix_backup AS SELECT * FROM i18n_forms WHERE 1=0`);
db.exec('BEGIN');
try {
  for (const p of plan) insert.run(p.form, p.base, 'ru', JSON.stringify(p.tags));
  db.exec('COMMIT');
  console.log(`\n已补建 ${plan.length} 条 i18n_forms 记录`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('回滚:', e.message);
  process.exit(1);
}
const left = db.prepare(`SELECT COUNT(1) c FROM words_i18n w
  WHERE w.lang='ru' AND NOT EXISTS (SELECT 1 FROM i18n_forms f WHERE f.form=w.word AND f.lang='ru')`).get().c;
console.log(`剩余无反查记录的词条: ${left}`);
db.close();
