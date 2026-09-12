/**
 * zidiankaifa 共享数据契约
 * 同一套类型同时服务于：Electron 主进程(better-sqlite3)、同步服务(Node)、Web/手机端 UI。
 */

/** ECDICT 词条 */
export interface WordEntry {
  word: string;
  phonetic: string | null;
  /** 英英释义 */
  definition: string | null;
  /** 英汉释义 */
  translation: string | null;
  pos: string | null;
  /** 柯林斯星级 0-5 */
  collins: number | null;
  /** 牛津星级 0-5 */
  oxford: number | null;
  /** 考试标签: zk gk cet4 cet6 ky toefl gre ielts …(空格分隔) */
  tag: string | null;
  /** 英伦国家语料库词频序（越小越常用） */
  bnc: number | null;
  /** 当代语料库词频序 */
  frq: number | null;
  audio: string | null;
  /** 原始 exchange 串 */
  exchange: string | null;
}

export type FormType =
  | 'base' // 原型
  | 'plural' // 复数
  | 'past' // 过去式
  | 'done' // 过去分词
  | 'ing' // 现在分词
  | 'third' // 第三人称单数
  | 'comp' // 比较级
  | 'super' // 最高级
  | 'variant'; // 其他变体

export interface WordForm {
  form: string;
  type: FormType;
}

/** 词源演变链上的一环（词级） */
export interface OriginStep {
  /** 词形 */
  w: string;
  /** 语言代码，如 eng/frm/lat */
  l: string;
  /** 语言中文名 */
  lz: string;
}

/** 词源信息 */
export interface WordOrigin {
  word: string;
  /** 语源语言中文名，如 拉丁语 */
  origin: string;
  /** 语源语言代码，如 lat */
  originCode: string;
  /** 演变链（语言名，自英语向外），如 ["英语","古法语","拉丁语"] */
  lineage: string[];
  /** 演变链（词级），如 [{w:"abandon",l:"eng",lz:"英语"},{w:"abandoner",l:"fro",lz:"古法语"}] */
  lineageWords: OriginStep[];
  depth: number;
}

/** wiktextract 结构化派生链上的一环 */
export interface EtymologyStep {
  /** 语言代码，如 frm/lat */
  lang: string;
  /** 语言中文名 */
  langZh: string;
  /** 源词 */
  word: string | null;
  /** 构词成分（同语言内部构词时） */
  parts?: string[];
  /** 模板类型 */
  kind?: string;
}

/** 词源详解（Wiktionary/wiktextract） */
export interface WordEtymology {
  word: string;
  /** 英文词源原文 */
  textEn: string | null;
  /** 中文词源原文 */
  textZh: string | null;
  /** 结构化派生链 */
  chain: EtymologyStep[];
  /** 最深层来源语言中文名 */
  origin: string | null;
  originCode: string | null;
  /** 数据来源: en / zh / en+zh */
  source: string | null;
}

export type MorphemeKind = 'root' | 'prefix' | 'suffix';

export interface Morpheme {
  morpheme: string;
  kind: MorphemeKind;
  meaningZh: string;
  meaningEn: string | null;
  /** 来源语言，如 拉丁语/希腊语/古英语 */
  origin: string | null;
  /** 例词 */
  examples: string[];
}

/** 词根词缀拆解的一段 */
export interface BreakdownPart {
  morpheme: string;
  kind: MorphemeKind;
  meaningZh: string;
  origin: string | null;
  /** 在单词中的起始位置（启发式匹配，可能为 -1 表示未定位） */
  start: number;
  end: number;
  /** 该词素的例词（来自 morphemes 表，可点击反查） */
  examples?: string[];
}

export type BookStatus = 'new' | 'learning' | 'mastered' | 'suspended';

/** 生词本条目 */
export interface BookItem {
  word: string;
  /** 语言：'en'（英语）/ 'ru'（俄语）等；旧数据缺省视为 'en' */
  lang?: string;
  /** epoch ms */
  addedAt: number;
  updatedAt: number;
  status: BookStatus;
  note: string | null;
  tags: string[];
  reviewCount: number;
  lastReviewedAt: number | null;
  /** 删除墓碑（同步用）：true 表示该词已从生词本删除，跨端同步时传播删除 */
  deleted?: boolean;
}

/** 多语言词形（如俄语变格变位） */
export interface I18nForm {
  /** 无重音的形式键（可反查） */
  form: string;
  /** 原形展示（含重音等） */
  display: string;
  /** 语法标签：genitive/plural/perfective... */
  tags: string[];
}

/** 多语言词条（俄语等，来自 Wiktionary） */
export interface I18nWord {
  word: string;
  /** 语言代码，如 ru */
  lang: string;
  /** 语言中文名，如 俄语 */
  langName: string;
  phonetic: string | null;
  /** 中文释义 */
  translation: string | null;
  /** 其他语言释义 */
  definition: string | null;
  pos: string | null;
  forms: I18nForm[];
  audio: string | null;
  /** 若本次查询命中词形而非原型（如 столом → стол） */
  matchedForm: { form: string; display: string; tags: string[] } | null;
}

/** 词条完整详情 */
export interface WordDetail extends WordEntry {
  forms: WordForm[];
  origin: WordOrigin | null;
  etymology: WordEtymology | null;
  breakdown: BreakdownPart[];
  inBook: boolean;
  /** 多语言词条（非空表示本次命中俄语等词条） */
  i18n: I18nWord | null;
}

export interface SuggestItem {
  word: string;
  bnc: number | null;
  frq: number | null;
  tag: string | null;
  /** 建议项语言：'en' / 'ru'（默认 'en'） */
  lang?: string;
}

/** 查询语言模式：auto=按输入脚本自动识别（默认）；en=强制英语；ru=强制俄语 */
export type LangMode = 'auto' | 'en' | 'ru';

/** 生词本 × 词素分组（知识图谱数据层）：同一词根/词缀关联的生词集合 */
export interface MorphemeGroup {
  morpheme: string;
  kind: MorphemeKind;
  meaningZh: string;
  origin: string | null;
  /** 命中该词素的生词 */
  words: string[];
  /** 该词素的例词 */
  examples: string[];
}

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  message?: string;
}

/** 后端能力：Electron 由 IPC 提供，浏览器/PWA 由 REST 提供 */
export interface DictBackend {
  /** lang: 'auto' | 'en' | 'ru'，缺省 'auto'（按输入脚本自动识别） */
  lookup(word: string, lang?: LangMode | string): Promise<WordDetail | null>;
  suggest(prefix: string, limit?: number): Promise<SuggestItem[]>;
  breakdown(word: string, lang?: LangMode | string): Promise<BreakdownPart[]>;
  bookList(): Promise<BookItem[]>;
  bookAdd(word: string, tags?: string[], lang?: string): Promise<BookItem>;
  bookRemove(word: string): Promise<void>;
  bookUpdate(item: BookItem): Promise<void>;
  /** 生词本按词根/词缀分组（知识图谱）；可选能力，缺失时前端自行聚合 */
  bookGroups?(): Promise<MorphemeGroup[]>;
  /** 全量合并同步；syncUrl 可选（Electron 端可省，浏览器端必传） */
  syncNow(syncUrl?: string): Promise<SyncResult>;
  /** 发音：lang 如 'en'/'ru'，默认 'en' */
  speak(word: string, lang?: string): Promise<void>;
  /** 订阅剪贴板取词（仅 Electron 生效）；返回取消订阅函数 */
  onClipboard?(cb: (text: string) => void): () => void;
}

/** Electron preload 注入的 window.dictAPI */
export interface DictAPI extends DictBackend {
  /** 开关主进程剪贴板监听（仅 Electron） */
  setClipboardWatch?(on: boolean): Promise<void>;
}

declare global {
  interface Window {
    dictAPI?: DictAPI;
  }
}
