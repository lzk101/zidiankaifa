/**
 * zidiankaifa 数据库访问层（node:sqlite，Node >= 22.13）
 * 供 Electron 主进程与同步服务共用；浏览器端不引用本模块。
 */
export * from './lexicon.js';

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  BookItem,
  BookStatus,
  BreakdownPart,
  EtymologyLink,
  EtymologyStep,
  I18nForm,
  I18nWord,
  LangMode,
  Morpheme,
  MorphemeGroup,
  MorphemeKind,
  OriginStep,
  SuggestItem,
  WordDetail,
  WordEntry,
  WordEtymology,
  WordForm,
  WordOrigin,
} from '../types.js';
import { isCjk, isCyrillic, I18N_LANG_NAME } from '../lang.js';
import { groupBookByMorphemeData } from '../graph.js';
import { SCHEMA_SQL, BOOK_TABLE_SQL } from './schema.js';

export { SCHEMA_SQL };

/* ---------------- 行类型（snake_case，来自 SQLite） ---------------- */

interface WordRow {
  word: string;
  phonetic: string | null;
  definition: string | null;
  translation: string | null;
  pos: string | null;
  collins: number | null;
  oxford: number | null;
  tag: string | null;
  bnc: number | null;
  frq: number | null;
  exchange: string | null;
  audio: string | null;
}

interface OriginRow {
  word: string;
  origin: string | null;
  origin_code: string | null;
  lineage: string | null;
  lineage_words: string | null;
  depth: number | null;
}

interface EtymologyRow {
  word: string;
  text_en: string | null;
  text_zh: string | null;
  chain: string | null;
  origin: string | null;
  origin_code: string | null;
  source: string | null;
}

interface I18nRow {
  word: string;
  lang: string;
  phonetic: string | null;
  translation: string | null;
  definition: string | null;
  pos: string | null;
  forms: string | null;
  audio: string | null;
  source: string | null;
}

interface I18nFormRow {
  form: string;
  word: string;
  tags: string | null;
}

interface FormRow {
  word: string;
  form: string;
  form_type: string;
}

interface MorphemeRow {
  morpheme: string;
  kind: string;
  meaning_zh: string | null;
  meaning_en: string | null;
  origin: string | null;
  examples: string | null;
}

interface BookRow {
  word: string;
  lang: string | null;
  added_at: number;
  updated_at: number;
  status: string;
  note: string | null;
  tags: string;
  review_count: number;
  last_reviewed_at: number | null;
  deleted: number;
}

interface SuggestRow {
  word: string;
  bnc: number | null;
  frq: number | null;
  tag: string | null;
  lang: string | null;
}

/* ---------------- 打开 ---------------- */

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA_SQL);
  // 迁移顺序不可颠倒：先 ADD COLUMN lang（老库没有该列），再升级为 (word, lang) 复合主键
  migrateBookLang(db);
  migrateBookCompositeKey(db);
  // ★★ T48（采纳需求 agent T47 异议 1）：后置校验**必须放在这里**，不能放在 `migrateBookCompositeKey` 内。
  //
  // 为什么：`migrateBookCompositeKey` 内部有**两条位于 try 内的早期 `return`**，会绕过该函数末尾的任何校验：
  //   ① `:207` 取不到主库文件路径（如内存/共享库）⇒ `return`
  //   ② `:236` 备份写不出（`SQLITE_FULL` 磁盘满 / `EACCES` 只读）⇒ `return`
  // 这两条路径下 `book` 仍是 `PRIMARY KEY (word)`，而 `upsertBook` 用 `ON CONFLICT(word, lang)`
  // ⇒ **4/4 写入全部抛** `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`，
  //   而 `bookList`/`bookListAll` 正常 ⇒ 回到「能打开、列表正常、但一条也加不进去」的静默故障
  //   （受控实验 scripts/_tmp/probe_sup_degraded_write2.mjs，夹具由 BOOK_COLUMNS_SQL 派生）。
  // 放在本函数出口处，才对**所有**返回路径生效（含上述两条早期 return）。
  assertBookCompositeOrThrow(db);
  migrateAddColumn(db, 'word_etymology', 'lang', "ALTER TABLE word_etymology ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'");
  migrateAddColumn(db, 'morphemes', 'lang', "ALTER TABLE morphemes ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'");
  return db;
}

/**
 * T48：`book` 表必须是 `(word, lang)` 复合主键，否则**响亮失败**。
 *
 * 为什么必须抛错而不是 `console.warn` 后继续：降级态下生词本的**读取正常、写入全失败**
 * （实测 4/4：`bookAdd(en)` / `bookAdd(ru)` / `bookRemove` / `bookUpdate` 均抛
 * `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`），
 * 对用户表现为「能打开、列表正常、但一条也加不进去」—— 属静默故障，不是可用状态。
 * 另叠加静默语义错误：老结构下 en/ru 同形词互相覆盖（本迭代正是要消除它）。
 * 取舍依据 `DEC-002`：正确性 > 可用性表象。桌面端在 `apps/desktop/src/main.mjs` 捕获本错误并**弹窗告知**。
 *
 * 表不存在时**跳过**（此时 `SCHEMA_SQL` 会建出复合主键新表，正常不会走到）。
 */
function assertBookCompositeOrThrow(db: DatabaseSync): void {
  const pk = bookPkCols(db);
  if (!pk.length) return; // 表不存在 ⇒ 无需校验
  if (pk.length === 2 && pk.includes('word') && pk.includes('lang')) return;
  throw new Error(
    `book 表未能迁移到 (word, lang) 复合主键（当前主键列 = ${JSON.stringify(pk)}）：` +
      '继续运行会导致生词本写入全部失败（ON CONFLICT 不匹配）且同形词跨语言互相覆盖。' +
      '请确认磁盘空间充足、数据库未被其他进程占用后重试（迁移前已生成 .bak-<ISO> 一致性快照备份）。'
  );
}

/** 老库迁移：book 表补 lang 列（默认 'en'） */
function migrateBookLang(db: DatabaseSync): void {
  migrateAddColumn(db, 'book', 'lang', "ALTER TABLE book ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'");
}

/**
 * v0.10.0 迁移：book 表主键 word → **(word, lang) 复合主键**（生词本语言分离）。
 *
 * 为什么需要真迁移而不是"展示层过滤"：老库 `PRIMARY KEY(word)` 意味着英文 `book` 与俄文 `book`
 * 只能存一条，`ON CONFLICT(word)` 会把另一语言的记录**覆盖**掉 —— 语言分离必须在存储层解决。
 *
 * 幂等：先读 `PRAGMA table_info(book)` 的主键列，已是 (word, lang) 则直接返回。
 * 安全：① 迁移前按项目惯例备份 `.bak-<ISO 时间戳>`；② 全程事务，失败 ROLLBACK；
 *      ③ 迁移前后比对行数，行数变少视为数据丢失 → 抛错回滚。
 * 注意：SQLite 标准 12 步法的子集（无外键引用 book，故 foreign_keys 开关仅作规范动作）。
 */
/**
 * 读 `book` 表的主键列（按 pk 序号排序）。表不存在时返回 `[]`。
 * T45 抽出：主键判据此前只写在 `migrateBookCompositeKey` 内，现被「迁移前置判据」与
 * 「迁移后置校验」共用，避免两处判据漂移。
 */
function bookPkCols(db: DatabaseSync): string[] {
  const cols = db.prepare('PRAGMA table_info(book)').all() as unknown as { name: string; pk: number }[];
  return cols
    .filter((c) => Number(c.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map((c) => c.name);
}

/** 表存在则删除；返回是否已删除（不存在也算成功，便于调用方判断"可以重试"） */
function dbTryDropTable(db: DatabaseSync, table: string): boolean {
  try {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * T49：迁移前一致性快照。返回 `true` = 可继续迁移；`false` = **放弃迁移**（数据优先）。
 *
 * ★ 复用已有备份（采纳需求 agent T47 异议 4）：`book_new` 残留触发的**重试**会再次调用本函数。
 *   若不加判断，一次自愈会落**两个**备份 —— 桌面端库约 494 MB ⇒ 约 1 GB 磁盘占用。
 *   故：只有当「`.bak-<ISO>` 形态的备份**已存在且非空**」时才复用它，不新建。
 *   ⚠ 刻意**不**判断该文件是否为上一次迁移的备份（无从判断）：只在「目标文件已存在」这一条上复用，
 *     失败则回落到正常新建路径。这是磁盘卫生的优化，不改变正确性。
 *
 * 备份必须是一致性快照 —— 为什么不能用 `fs.copyFileSync(主库文件)`：
 *   本库恒为 WAL 模式（`packages/core/src/db/schema.ts:29` 的 `PRAGMA journal_mode = WAL`），
 *   **已提交但尚未并回主库的事务只存在于 `-wal`**，只复制主库会静默漏掉它们
 *   （受控实验 `scripts/_tmp/probe_sup_wal_snapshot2.mjs`：「主库 12288 B + `-wal` 8272 B、
 *   写连接仍打开、表内 4 行」⇒ 副本只有 3 行，**用户刚加的生词不在备份里**）。
 *
 * 为什么不用「先 `wal_checkpoint(TRUNCATE)` 再复制」（T41 首版方案 A）：那个方案引入
 * **一条新的降级路径** —— checkpoint 若有并发读者/写者则返回 `busy !== 0`，只能放弃迁移，
 * 而**放弃迁移的后果极其严重**：库里 `book` 仍是 `word` 单主键，而 `upsertBook` 用的是
 * `ON CONFLICT(word, lang)` ⇒ 实测（`scripts/_tmp/probe_sup_degraded_write2.mjs`，夹具由
 * `BOOK_COLUMNS_SQL` 派生）**4/4 写入操作全部抛**
 * `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`
 * ⇒ 生词本对用户表现为「能打开、列表正常、但一条也加不进去」的静默故障。
 *
 * `VACUUM INTO` 是 SQLite 官方的一致性快照导出：在**单个读事务**内完成、**没有 busy 分支**
 * （要么得到一致快照、要么抛错），因此不存在「迁移被跳过」这条降级路径。
 * 代价：备份不是主库的逐字节副本（页布局重排、`journal_mode=delete`）⇒ 断言比较
 * **逻辑内容**而非字节（SQLite 打开该备份后内容与迁移前完全一致，可直接作为回退库）。
 */
function ensurePreMigrationBackup(db: DatabaseSync, st: MigrationState, isRetry: boolean): boolean {
  const main = db.prepare('PRAGMA database_list').all() as unknown as { name: string; file: string }[];
  const file = main.find((d) => d.name === 'main')?.file;
  if (!file || !fs.existsSync(file)) {
    console.warn('[zidiankaifa] book 复合主键迁移：取不到主库文件路径，放弃迁移（数据优先）');
    return false;
  }
  // ★★ 复用判据（T49 引入 → T51 收紧）：**只复用「同一次迁移调用内、本次刚刚创建并验证过」的那一份**。
  //
  // 为什么不扫目录找 `.bak-*`（T49 首版做法）—— 测试 agent 在 T50 用两个受控场景证明它**过宽**：
  //   ① **第二道防线落空**：用户/清理工具删掉了 `.bak-<ISO>` 主文件，但 SQLite 打开过该备份时生成的
  //      sidecar（`<db>.bak-<ISO>-wal`）还在。前缀匹配会命中 sidecar 并打印「复用已有迁移前备份」，
  //      **不再新建** ⇒ 磁盘上没有可用快照，而迁移照常完成 ⇒ AC-12⑧ 的「与事务并列的第二道独立防线」失效。
  //   ② **回退点数据不匹配**：目录里存在**上一代**库留下的 `.bak-<ISO>`（用户还原/替换过 dict.db）时，
  //      复用会把「另一个库的快照」当作本次迁移的回退点（实测回退点内容 = 陈旧库的行，≠ 本次迁移前的行）。
  //
  // 用 `st.bak`（本函数上一次调用时记录、且当时 `statSync` 成功且非空）作为判据，两个问题同时消除：
  //   sidecar 永不会被记录为 `st.bak`；跨代陈旧文件不在 `st` 里 ⇒ 一律新建。
  // 而 T49 要解决的体积问题（一次自愈落两份 494 MB 快照 ≈ 1 GB）依然成立 —— 重试复用同一份。
  const bak = st.bak ?? `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (st.bak) {
    // 仍做一次存在性/非空校验：万一被外部删掉，则回落到重新创建
    try {
      if (fs.statSync(st.bak).size > 0) {
        console.log(`[zidiankaifa] 复用本次迁移已创建的快照：${path.basename(st.bak)}`);
        return true;
      }
    } catch {
      /* 已被删除 ⇒ 走下面的新建路径 */
    }
    st.bak = null;
  }
  try {
    db.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`);
    // 记录前先验证：文件确实存在且非空，才允许后续重试复用它（防止把 0 字节/失败产物当回退点）
    if (fs.statSync(bak).size > 0) st.bak = bak;
    return true;
  } catch (e) {
    console.warn(
      `[zidiankaifa] book 复合主键迁移：备份失败（${(e as Error)?.message}），放弃迁移（数据优先）`
    );
    return false;
  }
}

/** 单次 `openDatabase()` 内的迁移状态（T51：仅用于把「本次已创建的快照」传给重试，见 `ensurePreMigrationBackup`） */
interface MigrationState {
  bak: string | null;
}

function migrateBookCompositeKey(db: DatabaseSync, st: MigrationState = { bak: null }, isRetry = false): void {
  try {
    const cols = db.prepare('PRAGMA table_info(book)').all() as unknown as {
      name: string;
      pk: number;
    }[];
    if (!cols.length) return; // 表不存在（SCHEMA_SQL 已建新表，正常不会走到）
    const pkCols = cols
      .filter((c) => Number(c.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((c) => c.name);
    const isComposite = pkCols.length === 2 && pkCols.includes('word') && pkCols.includes('lang');
    if (isComposite) return; // 已是新结构 ⇒ 幂等返回

    // 迁移前备份（AC-12 第 8 条：与事务并列的第二道独立防线）
    // ★ 备份失败 ⇒ **放弃迁移**（宁可暂不迁移，也不在无备份的情况下动用户数据）
    // ★ 备份只在「真迁移」时发生**一次**：已是复合主键时上一行的 `if (isComposite) return` 已提前返回，
    //   故幂等重跑（第二次 openDatabase）既不迁移、也不重复备份。
    //   唯一例外是下方的 `book_new` 残留重试 —— 那条路径**复用首次备份**，不落第二个文件（见 `ensurePreMigrationBackup`）。
    // ★ 体积提醒：桌面端目标库是 userData 下的 dict.db（约 494 MB），一次性快照可接受。
    if (!ensurePreMigrationBackup(db, st, isRetry)) return;

    const before = Number(
      (db.prepare('SELECT COUNT(1) AS n FROM book').get() as unknown as { n: number }).n
    );
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      // 表结构复用 schema.ts 的唯一定义（只换表名），避免两处结构漂移
      db.exec(BOOK_TABLE_SQL.replace('CREATE TABLE IF NOT EXISTS book', 'CREATE TABLE book_new'));
      // 显式列名（含墓碑 deleted 与 lang）；老数据 lang 为空按 'en' 归位
      db.exec(`INSERT OR REPLACE INTO book_new
        (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted)
        SELECT word, COALESCE(NULLIF(lang, ''), 'en'), added_at, updated_at, status, note, tags,
               review_count, last_reviewed_at, deleted
        FROM book`);
      const after = Number(
        (db.prepare('SELECT COUNT(1) AS n FROM book_new').get() as unknown as { n: number }).n
      );
      if (after < before) throw new Error(`book 迁移行数减少：${before} → ${after}`);
      db.exec('DROP TABLE book');
      db.exec('ALTER TABLE book_new RENAME TO book');
      db.exec('CREATE INDEX IF NOT EXISTS idx_book_updated ON book(updated_at)');
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* 已回滚 */
      }
      throw e;
    } finally {
      try {
        db.exec('PRAGMA foreign_keys = ON');
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    // ★ 有界重试（T45）：迁移失败最常见的原因是上一轮留下了残留的 `book_new` 表
    //   （`CREATE TABLE book_new` 报 `table book_new already exists`）。该残留可安全清除后重试一次。
    //   注意：真正的崩溃不会留下它 —— 整个迁移在 `BEGIN IMMEDIATE` 事务内（`book_new` 随事务回滚），
    //   故本分支只处理「非事务方式写入的残留」，属恢复性动作而非兜底正常路径。
    const msg = (e as Error)?.message ?? String(e);
    if (isRetry) {
      // 重试后仍失败 ⇒ 不再递归；由本函数末尾的后置校验统一抛出
      console.warn(`[zidiankaifa] book 表向 (word, lang) 复合主键迁移重试仍失败：${msg}`);
    } else if (/book_new/.test(msg) && dbTryDropTable(db, 'book_new')) {
      console.warn(`[zidiankaifa] 检测到残留的 book_new 表，已清除并重试一次迁移`);
      // 重试走 isRetry=true 分支 ⇒ 再失败时只告警、不再递归（有界，杜绝无限重试）
      // `st` 携带本次已创建的快照 ⇒ 重试复用同一份，不落第二个 494 MB 文件（T49，判据见 T51 收紧说明）
      migrateBookCompositeKey(db, st, true);
      return;
    } else {
      console.warn(`[zidiankaifa] book 表向 (word, lang) 复合主键迁移失败：${msg}`);
    }
  }

  // T48：后置校验**已上移到 `openDatabase()` 出口**（`assertBookCompositeOrThrow`）。
  // 为什么不能留在本函数末尾：本函数内有两条位于 try 内的早期 `return`（`:240` 取不到主库路径、
  // `:268` 备份失败）会绕过它；且本函数的递归重试路径也会绕过。放 `openDatabase()` 出口才对所有路径生效。
  assertBookCompositeOrThrow(db);
}

/** 通用列迁移：列不存在则 ALTER TABLE ADD COLUMN */
function migrateAddColumn(db: DatabaseSync, table: string, column: string, ddl: string): void {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
      name: string;
    }[];
    if (cols.some((c) => c.name === column)) return;
    db.exec(ddl);
  } catch {
    /* 表不存在或已迁移则忽略 */
  }
}

export function countWords(db: DatabaseSync): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM words').get() as unknown as { n: number };
  return Number(r.n);
}

/* ---------------- 转换 ---------------- */

function rowToEntry(r: WordRow): WordEntry {
  return {
    word: r.word,
    phonetic: r.phonetic,
    definition: r.definition,
    translation: r.translation,
    pos: r.pos,
    collins: r.collins,
    oxford: r.oxford,
    tag: r.tag,
    bnc: r.bnc,
    frq: r.frq,
    exchange: r.exchange,
    audio: r.audio,
  };
}

function rowToOrigin(r: OriginRow): WordOrigin {
  let lineage: string[] = [];
  try {
    const p = JSON.parse(r.lineage ?? '[]');
    if (Array.isArray(p)) lineage = p.map(String);
  } catch {
    /* ignore */
  }
  let lineageWords: OriginStep[] = [];
  try {
    const p = JSON.parse(r.lineage_words ?? '[]');
    if (Array.isArray(p)) {
      lineageWords = p
        .filter((s: unknown) => s && typeof s === 'object')
        .map((s: Record<string, unknown>) => ({
          w: String(s.w ?? ''),
          l: String(s.l ?? ''),
          lz: String(s.lz ?? s.l ?? ''),
        }));
    }
  } catch {
    /* ignore */
  }
  return {
    word: r.word,
    origin: r.origin ?? '未知',
    originCode: r.origin_code ?? '',
    lineage,
    lineageWords,
    depth: r.depth ?? 0,
  };
}

function rowToEtymology(r: EtymologyRow): WordEtymology {
  let chain: EtymologyStep[] = [];
  try {
    const p = JSON.parse(r.chain ?? '[]');
    if (Array.isArray(p)) {
      chain = p
        .filter((s: unknown) => s && typeof s === 'object')
        .map((s: Record<string, unknown>) => ({
          lang: String(s.lang ?? ''),
          langZh: String(s.langZh ?? s.lang ?? ''),
          word: s.word ? String(s.word) : null,
          parts: Array.isArray(s.parts) ? s.parts.map(String) : undefined,
          kind: s.kind ? String(s.kind) : undefined,
        }));
    }
  } catch {
    /* ignore */
  }
  return {
    word: r.word,
    textEn: r.text_en,
    textZh: r.text_zh,
    chain,
    origin: r.origin,
    originCode: r.origin_code,
    source: r.source,
  };
}

function rowToBook(r: BookRow): BookItem {
  let tags: string[] = [];
  try {
    const p = JSON.parse(r.tags);
    if (Array.isArray(p)) tags = p.map(String);
  } catch {
    /* ignore */
  }
  return {
    word: r.word,
    lang: r.lang ?? 'en',
    addedAt: r.added_at,
    updatedAt: r.updated_at,
    status: (r.status as BookStatus) || 'new',
    note: r.note,
    tags,
    reviewCount: r.review_count,
    lastReviewedAt: r.last_reviewed_at,
    deleted: r.deleted === 1,
  };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

function normalizeWord(w: string): string {
  return w.trim().toLowerCase();
}

/**
 * 大小写宽容候选：原词形优先 → 全小写 → 首字母大写。
 * 俄语专名（Китай/Москва）在词源表里按原词形存储，而查询侧常被小写化；
 * SQLite 的 COLLATE NOCASE 只折叠 ASCII，对西里尔字母无效，故在查询层手工兜底。
 */
function caseVariants(word: string): string[] {
  const w = word.trim();
  if (!w) return [];
  const out = [w];
  const lower = w.toLowerCase();
  if (!out.includes(lower)) out.push(lower);
  const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
  if (!out.includes(cap)) out.push(cap);
  return out;
}

/** 按候选词形依次查一行；命中即返回 */
function getByVariants<T>(
  db: DatabaseSync,
  sql: string,
  word: string,
  rest: (string | number)[] = [],
): T | undefined {
  const stmt = db.prepare(sql);
  for (const v of caseVariants(word)) {
    const r = stmt.get(v, ...rest) as unknown as T | undefined;
    if (r) return r;
  }
  return undefined;
}

/* ---------------- 查词 ---------------- */

export function listForms(db: DatabaseSync, word: string): WordForm[] {
  const rows = db
    .prepare('SELECT form, form_type FROM word_forms WHERE word = ? ORDER BY form')
    .all(word) as unknown as FormRow[];
  return rows.map((r) => ({ form: r.form, type: r.form_type as WordForm['type'] }));
}

export function getOrigin(db: DatabaseSync, word: string): WordOrigin | null {
  const r = getByVariants<OriginRow>(db, 'SELECT * FROM word_origins WHERE word = ?', word);
  return r ? rowToOrigin(r) : null;
}

/* ---------------- 词源相关词（把词源详解里的生词变成可点链接） ---------------- */

/**
 * 英语词源文本里不宜当作词条链接的词：功能词 + 语言学叙述常用词。
 * 不排除的话，`the/from/latin/derived` 之类在 77 万词库中同样可查，会把词源详解糊满无意义链接。
 */
const ETYM_STOP_EN = new Set([
  'the', 'and', 'from', 'with', 'that', 'this', 'which', 'have', 'has', 'had', 'been', 'was', 'were', 'are',
  'its', 'his', 'her', 'their', 'they', 'them', 'these', 'those', 'when', 'where', 'while', 'also', 'more',
  'most', 'such', 'some', 'other', 'into', 'than', 'then', 'only', 'even', 'well', 'very', 'both', 'each',
  'does', 'did', 'done', 'being', 'because', 'about', 'after', 'before', 'between', 'during', 'through',
  'under', 'over', 'against', 'could', 'would', 'should', 'might', 'must', 'shall', 'will', 'can', 'may',
  'one', 'two', 'three', 'like', 'same', 'used', 'using', 'form', 'forms', 'formed', 'formation', 'word',
  'words', 'name', 'term', 'see', 'first', 'later', 'early', 'modern', 'english', 'german', 'latin',
  'greek', 'french', 'russian', 'spanish', 'italian', 'dutch', 'swedish', 'polish', 'czech', 'old', 'new',
  'middle', 'proto', 'indo', 'european', 'germanic', 'slavic', 'romance', 'celtic', 'saxon', 'norwegian',
  'danish', 'icelandic', 'ukrainian', 'belarusian', 'bulgarian', 'serbian', 'croatian', 'means', 'meaning',
  'sense', 'senses', 'derived', 'borrowed', 'inherited', 'ultimately', 'probably', 'perhaps', 'possibly',
  'related', 'cognate', 'doublet', 'equivalent', 'compound', 'prefix', 'suffix', 'root', 'stem', 'verb',
  'noun', 'adjective', 'adverb', 'participle', 'plural', 'singular', 'genitive', 'dative', 'accusative',
  'nominative', 'instrumental', 'prepositional', 'compare', 'variant', 'diminutive', 'augmentative',
  'verbal', 'reflexive', 'present', 'past', 'future', 'tense', 'case', 'number', 'gender', 'feminine',
  'masculine', 'neuter', 'person', 'third', 'second', 'unknown', 'origin', 'source', 'attested', 'appears',
  'found', 'shows', 'given', 'takes', 'made', 'makes', 'attested', 'uncertain', 'unclear', 'instead',
  'without', 'within', 'being', 'having', 'there', 'their', 'whose', 'whom', 'what', 'than', 'thus',
]);

const RU_LINK_TOKEN = /[\u0400-\u04FF]{3,}/g;
/** 英语构词表达里的词素：带连字符的前缀/后缀形式，如 `un-` `-able` `photo-` */
const EN_MORPH_HYPHEN = /(?:^|[\s(+.])([a-z]{2,}-|-[a-z]{2,})(?=[\s+),.]|$)/g;
/** 英语构词表达里 `+` 两侧的裸词，如 `un- + believe + -able` 中的 believe */
const EN_MORPH_PLUS = /(?:^|\+)\s*([a-z]{3,})\s*(?=\+|$)/g;

/**
 * 从词源文本提取「本词典可查的相关词」，用于在词源详解里生成可点链接。
 * - 俄语文本里的西里尔词天然与中文说明区隔，直接提取，几乎无噪声
 * - 英语文本须过滤功能词与语言学常用词，只保留长度 ≥5 的实词
 * @returns 按文中出现顺序去重的关联词（最多 24 条）
 */
export function etymologyLinks(
  db: DatabaseSync,
  self: string,
  lang: string,
  textZh: string | null,
  textEn: string | null,
): EtymologyLink[] {
  const sRu = db.prepare("SELECT translation FROM words_i18n WHERE lang = 'ru' AND word = ? LIMIT 1");
  const sEn = db.prepare('SELECT translation FROM words WHERE word = ? LIMIT 1');
  const out: EtymologyLink[] = [];
  const seen = new Set<string>([self.toLowerCase()]);

  const take = (tok: string, tlang: string): void => {
    const key = tok.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const stmt = tlang === 'ru' ? sRu : sEn;
    for (const v of caseVariants(tok)) {
      const r = stmt.get(v) as { translation?: string | null } | undefined;
      if (!r) continue;
      const tr = (r.translation ?? '').split(/[；;\n]/)[0]?.trim() ?? '';
      out.push({ word: tok, lang: tlang, translation: tr.slice(0, 40) || undefined });
      return;
    }
  };

  for (const m of (textZh ?? '').matchAll(RU_LINK_TOKEN)) take(m[0], 'ru');
  if (lang === 'ru') {
    for (const m of (textEn ?? '').matchAll(RU_LINK_TOKEN)) take(m[0], 'ru');
  } else {
    // 英语只取构词表达（`un- + believe + -able` / `photo- + -graph`）里的成分。
    // 若按全文实词提取，"distance/denoting/apparatus/signals" 这类叙述用词在 77 万词库里同样可查，
    // 会把词源详解糊满无效链接。
    for (const m of (textEn ?? '').matchAll(EN_MORPH_HYPHEN)) {
      const c = m[1].replace(/^-+|-+$/g, '');
      if (c.length >= 2) take(c.toLowerCase(), 'en');
    }
    for (const m of (textEn ?? '').matchAll(EN_MORPH_PLUS)) {
      if (ETYM_STOP_EN.has(m[1].toLowerCase())) continue;
      take(m[1].toLowerCase(), 'en');
    }
  }
  return out.slice(0, 24);
}

export function getEtymology(db: DatabaseSync, word: string, lang = 'en'): WordEtymology | null {
  const r = getByVariants<EtymologyRow>(
    db,
    'SELECT * FROM word_etymology WHERE word = ? AND lang = ?',
    word,
    [lang],
  );
  if (!r) return null;
  const e = rowToEtymology(r);
  const links = etymologyLinks(db, word, lang, e.textZh, e.textEn);
  if (links.length) e.links = links;
  return e;
}

/* ---------------- 多语言词条（俄语等） ---------------- */

function rowToI18n(r: I18nRow, matchedForm: I18nWord['matchedForm']): I18nWord {
  let forms: I18nForm[] = [];
  try {
    const p = JSON.parse(r.forms ?? '[]');
    if (Array.isArray(p)) {
      forms = p
        .filter((s: unknown) => s && typeof s === 'object')
        .map((s: Record<string, unknown>) => ({
          form: String(s.form ?? ''),
          display: String(s.display ?? s.form ?? ''),
          tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
        }));
    }
  } catch {
    /* ignore */
  }
  return {
    word: r.word,
    lang: r.lang,
    langName: I18N_LANG_NAME[r.lang] ?? r.lang,
    phonetic: r.phonetic,
    translation: r.translation,
    definition: r.definition,
    pos: r.pos,
    forms,
    audio: r.audio,
    matchedForm,
  };
}

/**
 * 是否为「纯屈折说明」释义：zh 转储给变格形也建了词条，其释义只是「X 的属格单数」这类说明。
 * 「在家；дом (dom) 的属格单数」不算（含实质释义），「фра́нций (fráncij) 的属格单数」算。
 */
function isInflectionOnlyGloss(text: string | null): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  const parts = t.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => /的[^，。；]{0,8}(格|数|时|式|体)/.test(p));
}

export function getI18n(db: DatabaseSync, word: string, lang = 'ru'): I18nWord | null {
  const stmt = db.prepare('SELECT * FROM words_i18n WHERE word = ? AND lang = ?');
  const rows: I18nRow[] = [];
  for (const v of caseVariants(word)) {
    const r = stmt.get(v, lang) as unknown as I18nRow | undefined;
    if (r) rows.push(r);
  }
  if (!rows.length) return null;
  // 大小写变体同时存在时优先取有实质释义的词条（Франция「法国」优于 франция「франций 的属格单数」）
  const pick = rows.find((r) => !isInflectionOnlyGloss(r.translation)) ?? rows[0];
  return rowToI18n(pick, null);
}

function lookupI18n(db: DatabaseSync, word: string, lang: string): WordDetail | null {
  const direct = getI18n(db, word, lang);
  // 1) 词形反查优先：命中即返回主词条（含完整变格表）+ 词形标注（столом → стол[instrumental,singular]）。
  //    zh 转储会把变格形也建成独立词条（столом 有词条，甚至带 forms，但那是屈折形而非主词条），
  //    直接命中会掩盖反查、丢失「这是 стол 的哪个格」的教学信息，故反查在前。
  //    例外：输入本身是独立词条时（франция「法国」 vs франций「钫」的属格形 франция），
  //    反查会把它误判成屈折形并劫持到无关词条，故当自身有词源而反查主词条没有时，认定输入是独立词条。
  const fr = getByVariants<I18nFormRow>(
    db,
    'SELECT word, tags FROM i18n_forms WHERE form = ? AND lang = ?',
    word,
    [lang],
  );
  if (fr) {
    const base = getI18n(db, fr.word, lang);
    if (base && base.word !== direct?.word) {
      // 输入自身有实质释义（дома「在家」、яма「坑，洞」）→ 它是独立词条而非屈折形，不劫持到反查主词条；
      // 纯屈折说明（столом「стол 的工具格单数」）或「自身有词源而主词条无」（франция「法国」）不适用。
      const selfIsReal = direct
        ? !isInflectionOnlyGloss(direct.translation) ||
          (!!getEtymology(db, direct.word, lang) && !getEtymology(db, base.word, lang))
        : false;
      if (!selfIsReal) {
        let tags: string[] = [];
        try {
          const p = JSON.parse(fr.tags ?? '[]');
          if (Array.isArray(p)) tags = p.map(String);
        } catch {
          /* ignore */
        }
        const withForm: I18nWord = { ...base, matchedForm: { form: word, display: word, tags } };
        return i18nToDetail(db, withForm, lang);
      }
    }
  }
  // 2) 直接词条
  if (direct) return i18nToDetail(db, direct, lang);
  return null;
}

/** 多语言词条 → WordDetail：补词源（词源语言与词条语言一致）与词根词缀拆解 */
function i18nToDetail(db: DatabaseSync, i: I18nWord, lang: string): WordDetail {
  const base = i.word; // 保留原词形（俄语专名 Китай 按原形入库），大小写兜底交给 getOrigin/getEtymology
  return {
    word: i.word,
    phonetic: i.phonetic,
    definition: i.definition,
    translation: i.translation,
    pos: i.pos,
    collins: null,
    oxford: null,
    tag: null,
    bnc: null,
    frq: null,
    exchange: null,
    audio: i.audio,
    forms: [],
    origin: getOrigin(db, base),
    etymology: getEtymology(db, base, lang),
    breakdown: breakdownWord(db, i.word, lang),
    // v0.10.0：多语言词条也要如实反映「是否已在生词本」——按 (word, lang) 判定，
    // 否则俄语词条永远显示未收藏（生词本已按语言分离，收藏状态也必须按语言分离）
    inBook: !!db.prepare('SELECT 1 FROM book WHERE word = ? AND lang = ? AND deleted = 0').get(i.word, lang),
    i18n: i,
  };
}

/** 查词：lang='auto'（默认）按输入脚本自动识别；'en'/'ru' 强制指定语言 */
export function lookupWord(
  db: DatabaseSync,
  rawWord: string,
  opts?: { lang?: LangMode | string },
): WordDetail | null {
  const raw = rawWord.trim();
  const word = normalizeWord(rawWord);
  if (!word) return null;
  const lang = opts?.lang ?? 'auto';

  if (lang === 'ru') {
    // 强制俄语：直接词条或词形反查；未命中则放弃（不回落英语，避免混用）
    // 传原始词形（不预先小写）：专名 Франция「法国」与小写屈折词条 франция「франций 的属格单数」
    // 在库中并存，小写化会让用户查「法国」却看到「钫的属格单数」。
    return lookupI18n(db, raw, 'ru');
  }

  // 西里尔输入（auto）→ 俄语词条（先词形反查）
  if (lang !== 'en' && isCyrillic(word)) {
    const ru = lookupI18n(db, raw, 'ru');
    if (ru) return ru;
  }

  let row = db.prepare('SELECT * FROM words WHERE word = ?').get(word) as unknown as WordRow | undefined;
  let matched = word;
  if (!row && isCjk(word)) {
    // 中文反查：英文释义 + 俄语释义
    const like = `%${escapeLike(word)}%`;
    const r = db
      .prepare(
        "SELECT * FROM words WHERE translation LIKE ? ESCAPE '\\' OR definition LIKE ? ESCAPE '\\' ORDER BY (bnc IS NULL), bnc LIMIT 1"
      )
      .get(like, like) as unknown as WordRow | undefined;
    if (r) {
      row = r;
      matched = r.word;
    } else {
      const ruRow = db
        .prepare("SELECT word, lang FROM words_i18n WHERE translation LIKE ? ESCAPE '\\' LIMIT 1")
        .get(like) as unknown as { word: string; lang: string } | undefined;
      if (ruRow) {
        const ru = lookupI18n(db, ruRow.word, ruRow.lang);
        if (ru) return ru;
      }
    }
  }
  if (!row) return null;
  return {
    ...rowToEntry(row),
    forms: listForms(db, matched),
    origin: getOrigin(db, matched),
    etymology: getEtymology(db, matched),
    breakdown: breakdownWord(db, matched),
    inBook: !!db.prepare("SELECT 1 FROM book WHERE word = ? AND lang = 'en' AND deleted = 0").get(matched),
    i18n: null,
  };
}

export function suggest(db: DatabaseSync, rawQuery: string, limit = 20, lang?: string): SuggestItem[] {
  const q = normalizeWord(rawQuery);
  if (!q) return [];
  const lim = Math.min(Math.max(limit, 1), 50);
  /** 显式语言模式：'ru'/'en' 强制单语言；其它（undefined/'auto'）保持按输入脚本自动判定 */
  const mode: 'auto' | 'en' | 'ru' = lang === 'en' || lang === 'ru' ? lang : 'auto';
  const toItems = (rows: SuggestRow[]): SuggestItem[] =>
    rows.map((r) => ({
      word: r.word,
      bnc: r.bnc,
      frq: r.frq,
      tag: r.tag,
      lang: r.lang ?? undefined,
    }));

  const ruPrefix = (): SuggestItem[] =>
    toItems(
      db
        .prepare(
          `SELECT word, NULL AS bnc, NULL AS frq, 'ru' AS tag, 'ru' AS lang FROM words_i18n
           WHERE word >= ? AND word < ?
           ORDER BY word LIMIT ?`
        )
        .all(q, q + 'яяя', lim) as unknown as SuggestRow[],
    );

  const enPrefix = (): SuggestItem[] =>
    toItems(
      db
        .prepare(
          `SELECT word, bnc, frq, tag, 'en' AS lang FROM words
           WHERE word >= ? AND word < ?
           ORDER BY (word = ?) DESC, (bnc IS NULL), bnc, word LIMIT ?`
        )
        .all(q, q + 'zzzz', q, lim) as unknown as SuggestRow[],
    );

  const byTranslation = (target: 'en' | 'ru'): SuggestItem[] => {
    const like = `%${escapeLike(q)}%`;
    if (target === 'ru') {
      return toItems(
        db
          .prepare(
            "SELECT word, NULL AS bnc, NULL AS frq, 'ru' AS tag, 'ru' AS lang FROM words_i18n WHERE translation LIKE ? ESCAPE '\\' ORDER BY word LIMIT ?"
          )
          .all(like, lim) as unknown as SuggestRow[],
      );
    }
    return toItems(
      db
        .prepare(
          "SELECT word, bnc, frq, tag, 'en' AS lang FROM words WHERE translation LIKE ? ESCAPE '\\' ORDER BY (bnc IS NULL), bnc, word LIMIT ?"
        )
        .all(like, lim) as unknown as SuggestRow[],
    );
  };

  // 1) 显式语言模式：俄语模式下不再混入英语建议（中文反查同样限定语言）
  if (mode === 'ru') return isCjk(q) ? byTranslation('ru') : ruPrefix();
  if (mode === 'en') return isCjk(q) ? byTranslation('en') : enPrefix();

  // 2) 自动模式：按输入脚本判定（原行为）
  if (isCyrillic(q)) return ruPrefix();
  if (isCjk(q)) {
    const en = byTranslation('en');
    const ru = byTranslation('ru');
    // 英俄交错返回，保证中文反查时两种语言都可见（双语言分区）
    const mixed: SuggestItem[] = [];
    const n = Math.max(en.length, ru.length);
    for (let i = 0; i < n && mixed.length < lim; i += 1) {
      if (en[i]) mixed.push(en[i]);
      if (ru[i]) mixed.push(ru[i]);
    }
    return mixed.slice(0, lim);
  }
  return enPrefix();
}

/* ---------------- 词根词缀拆解 ---------------- */

let morphemeCache: { prefixes: Morpheme[]; suffixes: Morpheme[]; roots: Morpheme[] } | null = null;
/** 按语言缓存词素库（en 为英语，ru 为俄语） */
const morphemeCacheByLang = new Map<string, { prefixes: Morpheme[]; suffixes: Morpheme[]; roots: Morpheme[] }>();

function loadMorphemes(db: DatabaseSync, lang = 'en') {
  if (lang === 'en' && morphemeCache) return morphemeCache;
  const cached = morphemeCacheByLang.get(lang);
  if (cached) return cached;
  const rows = db
    .prepare('SELECT morpheme, kind, meaning_zh, meaning_en, origin, examples FROM morphemes WHERE lang = ?')
    .all(lang) as unknown as MorphemeRow[];
  const list: Morpheme[] = rows.map((r) => ({
    morpheme: r.morpheme,
    kind: r.kind as MorphemeKind,
    meaningZh: r.meaning_zh ?? '',
    meaningEn: r.meaning_en,
    origin: r.origin,
    examples: safeJsonArray(r.examples),
  }));
  const byKind = (k: MorphemeKind) => list.filter((m) => m.kind === k).sort((a, b) => b.morpheme.length - a.morpheme.length);
  const bundle = { prefixes: byKind('prefix'), suffixes: byKind('suffix'), roots: byKind('root') };
  morphemeCacheByLang.set(lang, bundle);
  if (lang === 'en') morphemeCache = bundle;
  return bundle;
}

function safeJsonArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

/** 拆解最少覆盖率：整体覆盖不足则视为「不可拆」，避免 difficult→cul、business→-ness 这类碎片式误拆 */
const BREAKDOWN_MIN_COVERAGE = 0.55;

/** 同分时的词素优先级：前缀 > 后缀 > 词根（否则 unbelievable 的 un- 会被同名词根 un 顶掉） */
const MORPHEME_RANK: Record<MorphemeKind, number> = { prefix: 0, suffix: 1, root: 2 };
function rankOf(m: Morpheme | null): number {
  return m ? MORPHEME_RANK[m.kind] : 3;
}

/**
 * 构词拆解：lang='en' 英语词素库；lang='ru' 俄语词素库（含屈折词尾与单字符前缀处理）
 *
 * 算法：全局最优分段（动态规划），非「每步取最长」的贪心。
 * 贪心会被同位置的长词素抢占：стетоскоп 在位置 3 命中 тоск-（忧愁）而丢掉
 * 更优的 стето- + скоп-（观察镜），导致 тоск- 词根关联到一堆医疗仪器词。
 * DP 以「覆盖字符数最大、片段数最少」为准则回推，从根上消除这类抢占。
 */
export function breakdownWord(db: DatabaseSync, rawWord: string, lang = 'en'): BreakdownPart[] {
  const w = normalizeWord(rawWord);
  if (w.length < 2) return [];
  const { prefixes, suffixes, roots } = loadMorphemes(db, lang);
  const isRu = lang === 'ru';
  // 俄语 ё/е 等价（весёлый ↔ весел-、жёлтый ↔ желто-）：匹配用归一化副本。
  // 两个字符等长，匹配位置可直接映射回原词，start/end 无需换算。
  const mw = isRu ? w.replace(/ё/g, 'е') : w;
  // 词素原文（morpheme 字段）→ 匹配模式（去掉首尾连字符；俄语后缀额外允许屈折词尾变体）
  const all = [...prefixes, ...suffixes, ...roots].map((m) => {
    const raw = m.morpheme.replace(/^-+|-+$/g, '');
    const stem = isRu ? raw.replace(/ё/g, 'е') : raw;
    const patterns: { pat: string; core: boolean }[] = [{ pat: stem, core: false }];
    if (isRu && m.kind === 'suffix' && stem.length >= 5 && /[ьйоаяеыиую]$/.test(stem)) {
      // -ость → 核心 ост，可吸收 -и/-ью 等屈折词尾；
      // 核心须 ≥3 字符：否则 -ать（核心 ат）会抢占 писатель 的 -тель
      const core = stem.slice(0, -1);
      if (core.length >= 3) patterns.push({ pat: core, core: true });
    }
    return { m, stem, patterns };
  });

  // 首字符索引：把每个位置要比较的词素从 888 条降到十位数（DP 反而比贪心更快）
  const byFirst = new Map<string, typeof all>();
  for (const e of all) {
    for (const { pat } of e.patterns) {
      const c = pat[0];
      let arr = byFirst.get(c);
      if (!arr) { arr = []; byFirst.set(c, arr); }
      arr.push(e);
    }
  }

  /** 位置 pos 上所有合法词素候选 */
  const candidatesAt = (pos: number): { m: Morpheme; start: number; end: number }[] => {    const out: { m: Morpheme; start: number; end: number }[] = [];
    const entries = byFirst.get(mw[pos]);
    if (!entries) return out;
    for (const { m, stem, patterns } of entries) {
      for (const { pat, core } of patterns) {
        const minLen = isRu && m.kind === 'prefix' ? 1 : 2; // 俄语有 в-/с-/у-/о- 等单字符前缀
        if (pat.length < minLen || !mw.startsWith(pat, pos)) continue;
        // ① 前缀只能起于词首 —— 否则 principle 的 in-（位置 1）会被误收
        if (m.kind === 'prefix' && pos !== 0 && !core) continue;
        let end = pos + (core ? w.length - pos : pat.length);
        if (core) {
          // 后缀吸收屈折词尾（-ость → -ости/-остью），词尾过长则不算同一后缀
          if (w.length - (pos + pat.length) > 3) continue;
          end = w.length;
        } else if (isRu && m.kind === 'prefix' && pat.length === 1) {
          // 单字符前缀需有【紧邻】的词根/后缀支撑，避免 вода → в-|ода、страшный → с-|трашный 这类误拆。
          // 用 startsWith 而非 includes：远处的 -ный 不足以支撑词首的 с-
          const rest = mw.slice(pos + 1);
          const supported = all.some(
            (x) => x.m.kind !== 'prefix' && x.stem.length >= 3 && rest.startsWith(x.stem)
          );
          if (!supported) continue;
        }
        // ② 后缀左侧须有 ≥3 字符词干 —— 否则 ателье、тельце 会被 -тель 误拆
        if (m.kind === 'suffix' && pos < 3) continue;
        out.push({ m, start: pos, end });
      }
    }
    return out;
  };

  // ---- DP：score[i] = 自 i 到词尾的最大覆盖；pieces[i] = 对应最少片段数 ----
  const n = w.length;
  const covered = new Int32Array(n + 1);
  const pieces = new Int32Array(n + 1);
  const stepTo = new Int32Array(n + 1);
  const stepEnd = new Int32Array(n + 1);
  const stepM: (Morpheme | null)[] = new Array(n + 1).fill(null);
  stepTo[n] = -1;
  for (let i = n - 1; i >= 0; i--) {
    // 选项 A：该字符不归属任何词素（碎片）
    let bestCov = covered[i + 1];
    let bestPieces = pieces[i + 1];
    let bestTo = i + 1;
    let bestEnd = i + 1;
    let bestM: Morpheme | null = null;
    for (const c of candidatesAt(i)) {
      const cov = c.end - c.start + covered[c.end];
      const pc = 1 + pieces[c.end];
      // 同分同片段时前缀 > 后缀 > 词根：否则 unbelievable 的 un- 会被同名词根 un 顶掉
      const better =
        cov > bestCov ||
        (cov === bestCov && (pc < bestPieces || (pc === bestPieces && rankOf(c.m) < rankOf(bestM))));
      if (better) {
        bestCov = cov; bestPieces = pc; bestTo = c.end; bestEnd = c.end; bestM = c.m;
      }
    }
    covered[i] = bestCov; pieces[i] = bestPieces; stepTo[i] = bestTo; stepEnd[i] = bestEnd; stepM[i] = bestM;
  }

  // ---- 回溯 ----
  const parts: BreakdownPart[] = [];
  let i = 0;
  while (i >= 0 && i < n && parts.length < 8) {
    const m = stepM[i];
    if (m) {
      parts.push({
        morpheme: m.morpheme,
        kind: m.kind,
        meaningZh: m.meaningZh,
        origin: m.origin,
        start: i,
        end: stepEnd[i],
        examples: m.examples?.length ? m.examples : undefined,
      });
      i = stepEnd[i];
    } else {
      i = stepTo[i];
    }
  }

  // 覆盖率不足视为不可拆（difficult/business/principle 一类碎片式误拆）
  const rawCovered = parts.reduce((s, p) => s + (p.end - p.start), 0);
  if (rawCovered / n < BREAKDOWN_MIN_COVERAGE) return [];

  // 词头 1 字符间隙的单片段（run→un、orange→-ange）判为不可拆；
  // achievement（chiev 起于位置 1，但后面还有 -ment，共 2 片段）不受影响。
  if (parts.length === 1 && parts[0].start === 1) return [];

  // 词首间隙（≥1）且 gap 无法被前缀解释时判为误拆：сегодня 曾被拆成 год- + -ня（"се" 被跳过，
  // 靠 -ня 补足覆盖率骗过阈值），实际是 сего + дня，与 год-（年）无关。
  // 但 acknowledge = ac- + know + -ledge 的 "ac" 能由 ac- 前缀解释，必须放行。
  //
  // D1 修复（v0.8.0）：此处原为 `>= 2`，与上面第 846 行的单片段规则**恰好都放过 gap=1**，
  // 于是 плескание→лес-、хлестаться→лес-、зверство→вер-、тлеться→лет- 这类
  // 「词首单字符被跳过 + 词中假词根」全部漏网（假词根库只有日常基础词，最易撞上）。
  // 改为 `>= 1` 后 gap=1 同样受「精确前缀解释」约束；修法选它而非「无条件禁止 gap=1」，
  // 是因为 в-/о-/с-/у- 确实是俄语真前缀：удачный = у- + да- + -ный 的 gap='у' 会被本规则放行，
  // 而无条件禁止会把它误杀。实测：全库 342 词 D1 模式中 267 词（首字符非前缀）被消除，
  // 75 词（首字符 ∈ в/о/с/у）全部保留，零误伤，L4 空洞≥3 持平 134。
  if (parts.length && parts[0].start >= 1) {
    const gap = mw.slice(0, parts[0].start);
    const explained = all.some((x) => x.m.kind === 'prefix' && x.stem === gap);
    if (!explained) return [];
  }
  return parts.sort((a, b) => a.start - b.start);
}

/**
 * 关联词排序 + 去碎片。
 *
 * roots/affixes 的 words 是按拆解倒排生成的，含词素裸形式（`phon`、`phon-`、`tele`）与
 * 生僻派生形；直接按字母序截断会让「同根词」以 `Phong/phono/phony` 打头、把 microphone
 * 这类常用词挤掉。这里剔除裸词素，英语按 bnc/frq 词频、俄语按词长（短词更基础）排序。
 */
function rankSiblings(
  db: DatabaseSync,
  words: string[],
  lang: string,
  morpheme: string,
  self: string,
): string[] {
  const bare = new Set([morpheme.toLowerCase(), morpheme.replace(/-/g, '').toLowerCase()]);
  const clean = words.filter((w) => {
    const key = w.toLowerCase().replace(/-/g, '');
    return !bare.has(w.toLowerCase()) && !bare.has(key) && key.length >= 3 && key !== self;
  });
  if (!clean.length) return [];

  if (lang === 'en') {
    const stmt = db.prepare('SELECT bnc, frq FROM words WHERE word = ?');
    const scored = clean.map((w) => {
      const r = stmt.get(w.toLowerCase()) as { bnc: number | null; frq: number | null } | undefined;
      const bnc = r?.bnc && r.bnc > 0 ? r.bnc : Number.MAX_SAFE_INTEGER;
      const frq = r?.frq && r.frq > 0 ? r.frq : Number.MAX_SAFE_INTEGER;
      return { w, score: Math.min(bnc, frq) };
    });
    scored.sort((a, b) => a.score - b.score || a.w.length - b.w.length);
    // 语料库无记录的词（telep/teles/Phong 这类）只在有词频的邻居太少时才补位，
    // 否则它们会挤进同根词列表末尾，看着像噪声。
    const ranked = scored.filter((s) => s.score < Number.MAX_SAFE_INTEGER);
    return (ranked.length >= 8 ? ranked : scored).map((s) => s.w);
  }
  return [...clean].sort((a, b) => a.length - b.length || a.localeCompare(b, 'ru'));
}

/**
 * 当前词经构词拆解关联到的同根词/同缀词，按共享词素分组。
 *
 * 数据来自 roots / affixes 表（由 `packages/data-pipeline/build_roots_tables.mjs`
 * 基于全量真实拆解建立的关联词倒排）。与词源卡「提到的词」互补：
 * 能拆解的词走这里看词族，拆不开的（луна/небо 这类单词根词）走词源链接。
 */
export function relatedByMorpheme(db: DatabaseSync, word: string, lang = 'en'): MorphemeGroup[] {
  const parts = breakdownWord(db, word, lang);
  if (!parts.length) return [];

  const qRoot = db.prepare(
    'SELECT meaning_zh, origin, words, examples FROM roots WHERE lang = ? AND morpheme = ?',
  );
  const qAffix = db.prepare(
    'SELECT meaning_zh, origin, words, examples FROM affixes WHERE lang = ? AND morpheme = ?',
  );
  const self = word.toLowerCase();
  const groups: MorphemeGroup[] = [];

  for (const p of parts) {
    const row = (p.kind === 'root' ? qRoot : qAffix).get(lang, p.morpheme) as
      | { meaning_zh: string | null; origin: string | null; words: string | null; examples: string | null }
      | undefined;
    if (!row) continue;
    const words = rankSiblings(db, safeJsonArray(row.words), lang, p.morpheme, self);
    if (!words.length) continue;
    groups.push({
      morpheme: p.morpheme,
      kind: p.kind,
      meaningZh: row.meaning_zh ?? p.meaningZh ?? '',
      origin: row.origin ?? p.origin ?? null,
      // 词根组是真正的「词族」，给满；词缀组语义关联天然更弱（рас- 会带出 раса/расти），
      // 只给前 16 个以免噪声盖过词根。
      words: words.slice(0, p.kind === 'root' ? 40 : 16),
      examples: safeJsonArray(row.examples),
    });
  }

  // 词根优先于词缀；同类按关联词数从多到少
  return groups.sort((a, b) => {
    const ra = a.kind === 'root' ? 0 : 1;
    const rb = b.kind === 'root' ? 0 : 1;
    return ra === rb ? b.words.length - a.words.length : ra - rb;
  });
}

/* ---------------- 生词本 ---------------- */

const BOOK_INSERT =
  'INSERT INTO book (word, lang, added_at, updated_at, status, note, tags, review_count, last_reviewed_at, deleted) VALUES (?,?,?,?,?,?,?,?,?,?)';

/** 缺省语言（历史数据全为 'en'，v0.10.0 前无语言维度） */
const BOOK_DEFAULT_LANG = 'en';

/**
 * 推断某 word 既有记录的语言（该词只有一种语言时有效）。
 * 仅用于 bookUpdate / bookRemove **未显式传 lang** 的老调用点：沿用既有语言，
 * 而不是老实现的 `?? 'en'`（那会把俄语条静默改写成英语条，见 REQ.md §8.1-B-3）。
 */
function existingLangForWord(db: DatabaseSync, word: string): string | null {
  const row = db
    .prepare('SELECT lang FROM book WHERE word = ? ORDER BY deleted ASC, updated_at DESC LIMIT 1')
    .get(word) as unknown as { lang: string } | undefined;
  return row ? row.lang : null;
}

function upsertBook(db: DatabaseSync, it: BookItem & { lang: string }): void {
  // v0.10.0：冲突目标 = (word, lang) 复合主键 ⇒ 同一拼写的英/俄两条互不覆盖（AC-13）
  // 注意：不再写 `lang = excluded.lang`（主键已含 lang，改写它只会在旧单键结构下造成跨语言覆盖）
  db.prepare(
    `${BOOK_INSERT}
     ON CONFLICT(word, lang) DO UPDATE SET
       added_at = excluded.added_at,
       updated_at = excluded.updated_at,
       status = excluded.status,
       note = excluded.note,
       tags = excluded.tags,
       review_count = excluded.review_count,
       last_reviewed_at = excluded.last_reviewed_at,
       deleted = excluded.deleted`
  ).run(
    it.word,
    it.lang,
    it.addedAt,
    it.updatedAt,
    it.status,
    it.note,
    JSON.stringify(it.tags ?? []),
    it.reviewCount ?? 0,
    it.lastReviewedAt ?? null,
    it.deleted ? 1 : 0
  );
}

/** 查一条生词；**缺省 lang = 'en'**（与既有行为一致：历史数据全为 en，AC-13 第 6 条） */
export function bookGet(db: DatabaseSync, word: string, lang: string = BOOK_DEFAULT_LANG): BookItem | null {
  const r = db
    .prepare('SELECT * FROM book WHERE word = ? AND lang = ?')
    .get(normalizeWord(word), lang) as unknown as BookRow | undefined;
  return r ? rowToBook(r) : null;
}

/**
 * 列出未删除的生词。
 * ★ 缺省（不传 lang）= **不过滤，返回全部语言** ——「宁可多不可少」：缺省过滤会让俄语条
 * 在未改造的调用点静默消失（AC-13 第 6 条 / D17）。**UI 层每一处读取必须显式传 lang**（AC-16 第 7 条）。
 */
export function bookList(db: DatabaseSync, lang?: string): BookItem[] {
  const rows = (
    lang
      ? db
          .prepare('SELECT * FROM book WHERE deleted = 0 AND lang = ? ORDER BY updated_at DESC')
          .all(lang)
      : db.prepare('SELECT * FROM book WHERE deleted = 0 ORDER BY updated_at DESC').all()
  ) as unknown as BookRow[];
  return rows.map(rowToBook);
}

/** 含墓碑（deleted）的全部记录，用于同步 */
export function bookListAll(db: DatabaseSync): BookItem[] {
  const rows = db.prepare('SELECT * FROM book ORDER BY updated_at DESC').all() as unknown as BookRow[];
  return rows.map(rowToBook);
}

export function bookAdd(db: DatabaseSync, word: string, tags: string[] = [], lang = BOOK_DEFAULT_LANG): BookItem {
  const w = normalizeWord(word);
  const now = Date.now();
  upsertBook(db, {
    word: w,
    lang,
    addedAt: now,
    updatedAt: now,
    status: 'new',
    note: null,
    tags,
    reviewCount: 0,
    lastReviewedAt: null,
  });
  // ★ 必须按 (word, lang) 回读：否则俄语条会读成同拼写的英语条
  return bookGet(db, w, lang)!;
}

/** 删除 = 写墓碑。★ 墓碑必须保留原语言（AC-13 第 5 条） */
export function bookRemove(db: DatabaseSync, word: string, lang?: string): void {
  const w = normalizeWord(word);
  const l = lang ?? existingLangForWord(db, w) ?? BOOK_DEFAULT_LANG;
  const now = Date.now();
  const existing = bookGet(db, w, l);
  upsertBook(db, {
    word: w,
    lang: l,
    addedAt: existing?.addedAt ?? now,
    updatedAt: now,
    status: existing?.status ?? 'new',
    note: existing?.note ?? null,
    tags: existing?.tags ?? [],
    reviewCount: existing?.reviewCount ?? 0,
    lastReviewedAt: existing?.lastReviewedAt ?? null,
    deleted: true,
  });
}

/**
 * 更新一条生词（按 (word, lang) 定位；未传 lang 时沿用既有语言，不隐式回退 'en'）。
 *
 * ★ 入参允许**局部字段**（AC-13 第 3 条判定式用 `{ word, lang, note }` 这种不完整对象）：
 *   未提供的字段一律**沿用该 (word, lang) 既有行的值**，行不存在时才用缺省值
 *   （addedAt/updatedAt 取 now，status='new'，tags=[] 等）。
 *   ⇒ 局部更新**不会**把同一 word 的另一语言条目的字段带过来，也不会写坏本行其它字段。
 */
export function bookUpdate(db: DatabaseSync, item: Partial<BookItem> & { word: string }): BookItem {
  const w = normalizeWord(item.word);
  const lang = item.lang ?? existingLangForWord(db, w) ?? BOOK_DEFAULT_LANG;
  const prev = bookGet(db, w, lang);
  const now = Date.now();
  const it: BookItem & { lang: string } = {
    word: w,
    lang,
    addedAt: item.addedAt ?? prev?.addedAt ?? now,
    updatedAt: item.updatedAt ?? now,
    status: item.status ?? prev?.status ?? 'new',
    note: item.note !== undefined ? item.note : (prev?.note ?? null),
    tags: item.tags ?? prev?.tags ?? [],
    reviewCount: item.reviewCount ?? prev?.reviewCount ?? 0,
    lastReviewedAt:
      item.lastReviewedAt !== undefined ? item.lastReviewedAt : (prev?.lastReviewedAt ?? null),
    deleted: item.deleted ?? prev?.deleted ?? false,
  };
  upsertBook(db, it);
  return bookGet(db, w, lang)!;
}

/**
 * 跨端同步合并（last-write-wins），返回合并后的全量记录（含墓碑）。
 * v0.10.0：冲突判定键 = **(word, lang)** —— 另一语言的 updatedAt 不再决定本条是否被推（AC-14 第 3 条）。
 */
export function syncMerge(db: DatabaseSync, items: BookItem[]): { pushed: number; pulled: number; items: BookItem[] } {
  let pushed = 0;
  for (const it of items) {
    const word = normalizeWord(it.word);
    const lang = it.lang ?? BOOK_DEFAULT_LANG;
    const cur = db.prepare('SELECT updated_at FROM book WHERE word = ? AND lang = ?').get(word, lang) as unknown as
      | { updated_at: number }
      | undefined;
    if (!cur || it.updatedAt > cur.updated_at) {
      // 远端载荷可能缺字段（老客户端）：缺失项沿用本端既有行，避免写入 undefined 触发绑定错误
      const prev = bookGet(db, word, lang);
      upsertBook(db, {
        word,
        lang,
        addedAt: it.addedAt ?? prev?.addedAt ?? it.updatedAt,
        updatedAt: it.updatedAt,
        status: it.status ?? prev?.status ?? 'new',
        note: it.note ?? prev?.note ?? null,
        tags: it.tags ?? prev?.tags ?? [],
        reviewCount: it.reviewCount ?? prev?.reviewCount ?? 0,
        lastReviewedAt: it.lastReviewedAt ?? prev?.lastReviewedAt ?? null,
        deleted: it.deleted ?? prev?.deleted ?? false,
      });
      pushed++;
    }
  }
  const all = bookListAll(db);
  return { pushed, pulled: all.length, items: all };
}

/* ---------------- 生词本 × 词根分组（知识图谱数据层） ---------------- */

/**
 * 把生词按命中的词根/词缀分组（词频排序：命中词多的词素靠前）。
 *
 * ★ 分层纪律（v0.10.0 AC-17 第 6 条）：本函数**不负责按语言过滤** —— 它按 `it.lang`
 * **选对应的词素库**去拆解（俄语生词用俄语词素，否则会被英语库误拆）。
 * ⇒「某个语言的词根分类」这件事发生在 **`bookGroups(lang)` 那一层**（先过滤 items），
 *   **不是**发生在词素库层。后人勿以为这里会替调用方过滤。
 */
export function groupBookByMorpheme(db: DatabaseSync, items: BookItem[]): MorphemeGroup[] {
  // 按生词条目自身的语言选词素库（俄语生词用俄语词素，否则会被英语库误拆）
  return groupBookByMorphemeData(items, (w, lang) => breakdownWord(db, w, lang ?? 'en'));
}

/* ---------------- 词频排行工具 ---------------- */

export function topFrequent(db: DatabaseSync, limit = 50): WordEntry[] {
  const rows = db
    .prepare('SELECT * FROM words WHERE bnc IS NOT NULL ORDER BY bnc LIMIT ?')
    .all(limit) as unknown as WordRow[];
  return rows.map(rowToEntry);
}
