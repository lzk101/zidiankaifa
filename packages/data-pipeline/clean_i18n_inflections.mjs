/**
 * 清理 words_i18n 中的「纯屈折说明」词条（zh 转储把变格/变位形建成了独立词条）。
 *
 * 安全策略：
 *  1) 仅删除「纯屈折说明」且「词形在 i18n_forms 中可反查」且「反查主词条存在于 words_i18n」的条目
 *  2) 删除前整行复制到备份表 words_i18n_inflection_backup（可整表还原）
 *  3) 默认 dry-run，需显式 --apply 才写库
 *
 * 用法: node _clean_inflection_entries.mjs [--apply]
 */
import { DatabaseSync } from 'node:sqlite';

const APPLY = process.argv.includes('--apply');
const db = new DatabaseSync('data/db/dict.db');

const isInf = (text) => {
  const t = (text ?? '').trim();
  if (!t) return false;
  const parts = t.split(/[；;]/).map(s => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(p => /的[^，。；]{0,8}(格|数|时|式|体)/.test(p));
};

const all = db.prepare("SELECT word, lang, phonetic, translation, definition, pos, forms, audio, source FROM words_i18n WHERE lang='ru'").all();
const exists = db.prepare("SELECT 1 FROM words_i18n WHERE word=? AND lang='ru'");
const formOf = db.prepare("SELECT word FROM i18n_forms WHERE form=? AND lang='ru'");

const doomed = [];
const keptNoReverse = [];
const keptNoBase = [];
for (const r of all) {
  if (!isInf(r.translation)) continue;
  const bases = formOf.all(r.word).map(x => String(x.word));
  if (!bases.length) { keptNoReverse.push(r); continue; }
  if (!bases.some(b => exists.get(b))) { keptNoBase.push({ r, bases }); continue; }
  doomed.push(r);
}

console.log(`俄语词条 ${all.length}`);
console.log(`纯屈折说明 ${all.length ? '' : ''}→ 待删 ${doomed.length}；保留（不可反查）${keptNoReverse.length}；保留（反查主词条缺失）${keptNoBase.length}`);
if (keptNoBase.length) console.log('  反查主词条缺失样例:', keptNoBase.slice(0, 10).map(x => `${x.r.word}→${x.bases.join('/')}`).join('  '));

if (!APPLY) {
  console.log('\n[dry-run] 未写库。加 --apply 执行。');
  db.close();
  process.exit(0);
}

db.exec(`CREATE TABLE IF NOT EXISTS words_i18n_inflection_backup AS
  SELECT * FROM words_i18n WHERE 1=0`);
db.exec(`CREATE TABLE IF NOT EXISTS _inflection_cleanup_log (
  word TEXT PRIMARY KEY, lang TEXT, translation TEXT, cleaned_at TEXT)`);

const insBackup = db.prepare(`INSERT INTO words_i18n_inflection_backup
  (word, lang, phonetic, translation, definition, pos, forms, audio, source)
  VALUES (?,?,?,?,?,?,?,?,?)`);
const del = db.prepare("DELETE FROM words_i18n WHERE word=? AND lang='ru'");
const log = db.prepare("INSERT OR REPLACE INTO _inflection_cleanup_log VALUES (?,?,?,?)");
const now = new Date().toISOString();

db.exec('BEGIN');
try {
  for (const r of doomed) {
    insBackup.run(r.word, r.lang, r.phonetic, r.translation, r.definition, r.pos, r.forms, r.audio, r.source);
    del.run(r.word);
    log.run(r.word, r.lang, r.translation, now);
  }
  db.exec('COMMIT');
  console.log(`\n已删除 ${doomed.length} 条（备份表 words_i18n_inflection_backup + 日志 _inflection_cleanup_log）`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('回滚:', e.message);
  process.exit(1);
}

const after = db.prepare("SELECT COUNT(*) c FROM words_i18n WHERE lang='ru'").get().c;
const backup = db.prepare("SELECT COUNT(*) c FROM words_i18n_inflection_backup").get().c;
console.log(`清理后俄语词条: ${after}（备份 ${backup} 条）`);
db.close();
