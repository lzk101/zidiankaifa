/**
 * 修正 word_etymology 的 origin 标注（俄语词条）
 *
 * 问题：source='en'（来自英文维基词典转储）的词条被统一标成 origin='英语'，
 *       把「资料出处」当成了「语源语言」——солнце「继承自古东斯拉夫语」也显示「源自 英语」。
 *
 * 判定顺序（仅处理 lang='ru' 且 origin='英语' 的条目）：
 *   1) chain 对象数组（含 langZh）中的首个非英语语言
 *   2) 中文详解中的已知语言名（最长匹配）
 *   3) 英文详解中的已知语言名（最长匹配）
 *   4) 中文详解「借自/源自 英语」→ 保留 '英语'（确实借自英语）
 *   5) 构词描述（以 来自/源自 开头且含 +）→ '构词'
 *   6) 其余 → 置空（宁可不标，也不错标）
 *
 * 用法: node _fix_etym_origin.mjs [--apply]
 */
import { DatabaseSync } from 'node:sqlite';

const APPLY = process.argv.includes('--apply');
const db = new DatabaseSync('data/db/dict.db');

/** 英文语言名 → 中文（覆盖转储中出现的常见语源语言） */
const EN_ZH = {
  'Old East Slavic': '古东斯拉夫语', 'Proto-Slavic': '原始斯拉夫语', 'Old Church Slavonic': '古教会斯拉夫语',
  'Church Slavonic': '教会斯拉夫语', 'Proto-Indo-European': '原始印欧语', 'Proto-Balto-Slavic': '原始波罗的-斯拉夫语',
  'Middle High German': '中古高地德语', 'Old High German': '古高地德语', 'Low German': '低地德语',
  'Middle Dutch': '中古荷兰语', 'Middle French': '中古法语', 'Old French': '古法语', 'Middle English': '中古英语',
  'Old English': '古英语', 'Old Norse': '古诺斯语', 'Ancient Greek': '古希腊语', 'Proto-Germanic': '原始日耳曼语',
  'Serbo-Croatian': '塞尔维亚-克罗地亚语', 'Norwegian Bokmål': '书面挪威语', 'Proto-Turkic': '原始突厥语',
  'Latin': '拉丁语', 'Greek': '希腊语', 'German': '德语', 'French': '法语', 'English': '英语', 'Dutch': '荷兰语',
  'Italian': '意大利语', 'Spanish': '西班牙语', 'Portuguese': '葡萄牙语', 'Polish': '波兰语', 'Czech': '捷克语',
  'Slovak': '斯洛伐克语', 'Bulgarian': '保加利亚语', 'Ukrainian': '乌克兰语', 'Belarusian': '白俄罗斯语',
  'Turkic': '突厥语族', 'Turkish': '土耳其语', 'Tatar': '鞑靼语', 'Arabic': '阿拉伯语', 'Persian': '波斯语',
  'Hebrew': '希伯来语', 'Yiddish': '意第绪语', 'Finnish': '芬兰语', 'Swedish': '瑞典语', 'Norwegian': '挪威语',
  'Danish': '丹麦语', 'Japanese': '日语', 'Chinese': '汉语', 'Korean': '韩语', 'Sanskrit': '梵语', 'Hindi': '印地语',
  'Lithuanian': '立陶宛语', 'Latvian': '拉脱维亚语', 'Estonian': '爱沙尼亚语', 'Hungarian': '匈牙利语',
  'Romanian': '罗马尼亚语', 'Georgian': '格鲁吉亚语', 'Armenian': '亚美尼亚语', 'Azerbaijani': '阿塞拜疆语',
  'Kazakh': '哈萨克语', 'Mongolian': '蒙古语', 'Vietnamese': '越南语', 'Thai': '泰语', 'Icelandic': '冰岛语',
  'Irish': '爱尔兰语', 'Welsh': '威尔士语', 'Gaelic': '苏格兰盖尔语', 'Basque': '巴斯克语', 'Albanian': '阿尔巴尼亚语',
  'Catalan': '加泰罗尼亚语', 'Occitan': '奥克语', 'Slovene': '斯洛文尼亚语', 'Macedonian': '马其顿语',
  'Croatian': '克罗地亚语', 'Serbian': '塞尔维亚语', 'Gothic': '哥特语', 'Coptic': '科普特语', 'Aramaic': '阿拉米语',
  'Malay': '马来语', 'Indonesian': '印尼语', 'Esperanto': '世界语', 'Sumerian': '苏美尔语', 'Akkadian': '阿卡德语',
  'Egyptian': '埃及语', 'Finnic': '芬兰语族', 'Samoyedic': '萨莫耶德语族',
};
const EN_KEYS = Object.keys(EN_ZH).sort((a, b) => b.length - a.length);

/** 中文语源语言名（供从中文详解中提取；长名在前以便最长匹配） */
const ZH_LANGS = [
  '原始波罗的-斯拉夫语', '原始印欧语', '原始斯拉夫语', '原始日耳曼语', '原始突厥语', '原始东斯拉夫语',
  '古教会斯拉夫语', '教会斯拉夫语', '古东斯拉夫语', '中古高地德语', '古高地德语', '低地德语', '中古荷兰语',
  '中古法语', '古法语', '中古英语', '古英语', '古诺斯语', '古希腊语', '古普鲁士语', '塞尔维亚-克罗地亚语',
  '塞尔维亚语', '克罗地亚语', '斯洛文尼亚语', '马其顿语', '书面挪威语', '拉丁语', '希腊语', '德语', '法语',
  '英语', '荷兰语', '意大利语', '西班牙语', '葡萄牙语', '波兰语', '捷克语', '斯洛伐克语', '保加利亚语',
  '乌克兰语', '白俄罗斯语', '突厥语族', '土耳其语', '鞑靼语', '阿拉伯语', '波斯语', '希伯来语', '意第绪语',
  '芬兰语', '瑞典语', '挪威语', '丹麦语', '冰岛语', '日语', '汉语', '官话', '韩语', '梵语', '巴利语',
  '印地语', '立陶宛语', '拉脱维亚语', '爱沙尼亚语', '匈牙利语', '罗马尼亚语', '格鲁吉亚语', '亚美尼亚语',
  '阿塞拜疆语', '哈萨克语', '蒙古语', '越南语', '泰语', '爱尔兰语', '威尔士语', '苏格兰盖尔语', '巴斯克语',
  '阿尔巴尼亚语', '加泰罗尼亚语', '奥克语', '哥特语', '科普特语', '阿拉米语', '马来语', '印尼语', '世界语',
  '苏美尔语', '阿卡德语', '埃及语', '萨莫耶德语族', '芬兰语族', '斯拉夫语', '罗曼语族', '日耳曼语族',
];

/** 中文语言名候选：库中既有 origin 值（含汉字）+ 手写表 */
const ZH_KEYS = [...new Set([
  ...ZH_LANGS,
  ...db.prepare("SELECT DISTINCT origin FROM word_etymology WHERE lang='ru' AND origin IS NOT NULL AND origin NOT IN ('英语','构词','中文')")
    .all().map(r => String(r.origin)).filter(k => /[\u4e00-\u9fff]/.test(k) && k.length >= 2),
])].sort((a, b) => b.length - a.length);

const parseChain = (raw) => {
  try {
    const p = JSON.parse(raw ?? 'null');
    if (Array.isArray(p) && p.length && p[0] && typeof p[0] === 'object' && p[0].langZh) return p;
  } catch { /* ignore */ }
  return null;
};
const firstIn = (text, keys) => { for (const k of keys) if (text.includes(k)) return k; return null; };
/** 仅当语言名紧跟来源标记时才算（避免把同源词 cognate with Sanskrit 误判为语源） */
const ZH_PREFIX = '继承自|来自|源自|借自|源于|出自|经由';
const EN_PREFIX = 'Inherited from|Borrowed from|Derived from';
const firstAfter = (text, keys, prefixRe) => {
  for (const k of keys) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:${prefixRe})\\s*${esc}`).test(text)) return k;
  }
  return null;
};

const rows = db.prepare("SELECT word, lang, origin, origin_code, source, chain, text_zh, text_en FROM word_etymology WHERE lang='ru' AND origin='英语'").all();

const plan = { chain: 0, fromZh: 0, fromEn: 0, keepEn: 0, compound: 0, clear: 0 };
const updates = [];
for (const r of rows) {
  const zh = String(r.text_zh ?? '').trim();
  const en = String(r.text_en ?? '').trim();
  let next = null;

  const foreign = parseChain(r.chain)?.find(s => s.langZh && s.langZh !== '英语' && /[\u4e00-\u9fff]/.test(s.langZh));
  if (foreign) { next = { origin: foreign.langZh, code: foreign.lang ?? null }; plan.chain++; }
  else if (/借自\s*英语|源自\s*英语/.test(zh)) { next = 'KEEP'; plan.keepEn++; }
  else if (zh.includes('+')) { next = { origin: '构词', code: null }; plan.compound++; }
  else {
    const zhHit = firstAfter(zh, ZH_KEYS, ZH_PREFIX);
    const enHit = firstAfter(en, EN_KEYS, EN_PREFIX);
    if (zhHit) { next = { origin: zhHit, code: null }; plan.fromZh++; }
    else if (enHit && enHit !== 'English') { next = { origin: EN_ZH[enHit], code: null }; plan.fromEn++; }
    else { next = { origin: null, code: null }; plan.clear++; }
  }
  updates.push({ word: r.word, next });
}

console.log(`待处理 ${rows.length} 条：`);
console.log(`  chain 取真实语源: ${plan.chain}`);
console.log(`  中文详解提取: ${plan.fromZh}`);
console.log(`  英文详解提取: ${plan.fromEn}`);
console.log(`  确有借自英语（保留）: ${plan.keepEn}`);
console.log(`  构词描述 → '构词': ${plan.compound}`);
console.log(`  无依据 → 置空: ${plan.clear}`);
console.log('\n修正样例:');
let shown = 0;
for (const u of updates) {
  if (u.next === 'KEEP' || !u.next.origin || u.next.origin === '构词') continue;
  console.log(`  ${u.word.padEnd(18)} 英语 → ${u.next.origin}`);
  if (++shown >= 12) break;
}
console.log('\n置空样例:', updates.filter(u => u.next !== 'KEEP' && !u.next.origin).slice(0, 10).map(u => u.word).join(' '));

if (!APPLY) { console.log('\n[dry-run] 未写库。加 --apply 执行。'); db.close(); process.exit(0); }

db.exec(`CREATE TABLE IF NOT EXISTS word_etymology_origin_backup AS
  SELECT word, lang, origin, origin_code FROM word_etymology WHERE 1=0`);
const insB = db.prepare('INSERT INTO word_etymology_origin_backup VALUES (?,?,?,?)');
const upd = db.prepare("UPDATE word_etymology SET origin=?, origin_code=? WHERE word=? AND lang='ru'");

db.exec('BEGIN');
try {
  for (const r of rows) insB.run(r.word, r.lang, r.origin, r.origin_code);
  for (const u of updates) { if (u.next !== 'KEEP') upd.run(u.next.origin, u.next.code, u.word); }
  db.exec('COMMIT');
  console.log(`\n已修正 ${updates.filter(u => u.next !== 'KEEP').length} 条（原值备份在 word_etymology_origin_backup）`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('回滚:', e.message);
  process.exit(1);
}
db.close();
