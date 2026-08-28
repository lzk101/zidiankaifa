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

/** 词源信息 */
export interface WordOrigin {
  word: string;
  /** 语源语言中文名，如 拉丁语 */
  origin: string;
  /** 语源语言代码，如 lat */
  originCode: string;
  /** 演变链（自英语向外），如 ["英语","古法语","拉丁语"] */
  lineage: string[];
  depth: number;
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
}

export type BookStatus = 'new' | 'learning' | 'mastered' | 'suspended';

/** 生词本条目 */
export interface BookItem {
  word: string;
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

/** 词条完整详情 */
export interface WordDetail extends WordEntry {
  forms: WordForm[];
  origin: WordOrigin | null;
  breakdown: BreakdownPart[];
  inBook: boolean;
}

export interface SuggestItem {
  word: string;
  bnc: number | null;
  frq: number | null;
  tag: string | null;
}

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  message?: string;
}

/** 后端能力：Electron 由 IPC 提供，浏览器/PWA 由 REST 提供 */
export interface DictBackend {
  lookup(word: string): Promise<WordDetail | null>;
  suggest(prefix: string, limit?: number): Promise<SuggestItem[]>;
  breakdown(word: string): Promise<BreakdownPart[]>;
  bookList(): Promise<BookItem[]>;
  bookAdd(word: string, tags?: string[]): Promise<BookItem>;
  bookRemove(word: string): Promise<void>;
  bookUpdate(item: BookItem): Promise<void>;
  /** 全量合并同步；syncUrl 可选（Electron 端可省，浏览器端必传） */
  syncNow(syncUrl?: string): Promise<SyncResult>;
  /** 发音：返回 void，由后端实现 TTS/音频播放 */
  speak(word: string): Promise<void>;
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
