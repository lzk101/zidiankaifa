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

export function isCjk(s: string): boolean {
  return CJK_RE.test(s);
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
