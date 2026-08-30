/** 语言/标签/状态 的中文展示映射（纯数据，浏览器与 Node 均可安全使用） */
import type { BookStatus, FormType } from './types.js';

export const FORM_TYPE_LABEL: Record<FormType, string> = {
  base: '原型',
  plural: '复数',
  past: '过去式',
  done: '过去分词',
  ing: '现在分词',
  third: '第三人称单数',
  comp: '比较级',
  super: '最高级',
  variant: '其他变体',
};

export const BOOK_STATUS_LABEL: Record<BookStatus, string> = {
  new: '新学',
  learning: '学习中',
  mastered: '已掌握',
  suspended: '已暂停',
};

export const BOOK_STATUS_ORDER: BookStatus[] = ['new', 'learning', 'mastered', 'suspended'];

export const TAG_LABEL: Record<string, string> = {
  zk: '中考',
  gk: '高考',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  gre: 'GRE',
  ielts: '雅思',
  ru: '俄语',
};

/** 把 ECDICT tag 字段拆成 chips */
export function tagChips(tag: string | null | undefined): { code: string; label: string }[] {
  if (!tag) return [];
  return tag
    .split(/\s+/)
    .filter(Boolean)
    .map((code) => ({ code, label: TAG_LABEL[code] ?? code.toUpperCase() }));
}

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const CYRILLIC_RE = /[\u0400-\u04ff]/;

export function isCjk(s: string): boolean {
  return CJK_RE.test(s);
}

export function isCyrillic(s: string): boolean {
  return CYRILLIC_RE.test(s);
}

/** 多语言代码 → 中文名 */
export const I18N_LANG_NAME: Record<string, string> = {
  ru: '俄语',
};

/** 俄语语法标签 → 中文（变格/变位等） */
export const RUS_TAG_LABEL: Record<string, string> = {
  nominative: '主格',
  genitive: '属格',
  dative: '与格',
  accusative: '宾格',
  instrumental: '工具格',
  prepositional: '前置格',
  locative: '方位格',
  vocative: '呼格',
  singular: '单数',
  plural: '复数',
  masculine: '阳性',
  feminine: '阴性',
  neuter: '中性',
  animate: '有生命',
  inanimate: '无生命',
  perfective: '完成体',
  imperfective: '未完成体',
  reflexive: '反身',
  past: '过去时',
  present: '现在时',
  future: '将来时',
  'first-person': '第一人称',
  'second-person': '第二人称',
  'third-person': '第三人称',
  indicative: '陈述式',
  imperative: '命令式',
  subjunctive: '虚拟式',
  conditional: '条件式',
  comparative: '比较级',
  superlative: '最高级',
  'short-form': '短尾',
  short: '短尾',
  canonical: '原形',
  lemma: '词条形',
  'non-lemma': '非词条形',
  relational: '关系形容词',
  participle: '分词',
  verbal: '动词性',
  'noun-from-verb': '动名词',
  name: '人名',
  surname: '姓氏',
};

/** 俄语语法标签列表 → 中文标签串 */
export function rusTagsZh(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags ?? []) {
    out.push(RUS_TAG_LABEL[t] ?? t);
  }
  return out;
}

export function nextBookStatus(s: BookStatus): BookStatus {
  const i = BOOK_STATUS_ORDER.indexOf(s);
  return BOOK_STATUS_ORDER[(i + 1) % BOOK_STATUS_ORDER.length];
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
