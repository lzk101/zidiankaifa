/**
 * 数据层冒烟测试：验证 dict.db 上的核心查询（直接以 node 运行）
 *   node apps/sync-server/scripts/smoke.mjs
 */
import {
  bookAdd,
  bookList,
  bookRemove,
  bookUpdate,
  breakdownWord,
  countWords,
  lookupWord,
  openDatabase,
  suggest,
  syncMerge,
} from '@zidiankaifa/core/db';

const db = openDatabase('data/db/dict.db');

const log = (label, v) => console.log(`\n== ${label} ==\n${JSON.stringify(v, null, 2).slice(0, 1200)}`);

log('countWords', countWords(db));

for (const w of ['abandon', 'telephone', 'city', 'run', 'unbelievable', '你好']) {
  const d = lookupWord(db, w);
  log(`lookup(${w})`, d ? { word: d.word, phonetic: d.phonetic, translation: (d.translation ?? '').slice(0, 60), forms: d.forms.slice(0, 6), origin: d.origin, breakdown: d.breakdown, inBook: d.inBook } : null);
}

log('suggest(tele)', suggest(db, 'tele', 8));
log('suggest(城市)', suggest(db, '城市', 5));

log('breakdown(unbelievable)', breakdownWord(db, 'unbelievable'));
log('breakdown(telephone)', breakdownWord(db, 'telephone'));
log('breakdown(photograph)', breakdownWord(db, 'photograph'));
log('breakdown(abandon)', breakdownWord(db, 'abandon'));

// 生词本 + 同步合并
const b1 = bookAdd(db, 'abandon', ['四级']);
log('bookAdd', b1);
log('bookList', bookList(db).map((i) => ({ word: i.word, status: i.status, tags: i.tags, deleted: i.deleted })));
const merged = syncMerge(db, [
  { word: 'telephone', addedAt: Date.now(), updatedAt: Date.now(), status: 'learning', note: null, tags: [], reviewCount: 0, lastReviewedAt: null },
  { word: 'city', addedAt: Date.now(), updatedAt: Date.now(), status: 'mastered', note: '城市', tags: ['考试'], reviewCount: 3, lastReviewedAt: Date.now() },
]);
log('syncMerge pushed/pulled', { pushed: merged.pushed, pulled: merged.pulled });
log('bookList after merge', bookList(db).map((i) => ({ word: i.word, status: i.status, tags: i.tags })));
bookRemove(db, 'city');
log('bookList after remove(city)', bookList(db).map((i) => ({ word: i.word, deleted: i.deleted })));
const after = syncMerge(db, []);
log('syncMerge empty (pulled all incl tombstone)', { pushed: after.pushed, pulled: after.pulled });
bookUpdate(db, { word: 'abandon', addedAt: Date.now(), updatedAt: Date.now(), status: 'mastered', note: null, tags: [], reviewCount: 1, lastReviewedAt: Date.now() });
log('bookList final', bookList(db).map((i) => ({ word: i.word, status: i.status })));
console.log('\nSMOKE OK');
