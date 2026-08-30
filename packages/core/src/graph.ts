/**
 * 生词本 × 词根/词缀分组（知识图谱数据层，纯函数）
 * 浏览器端安全：不依赖任何 Node 模块；拆分数据由调用方（REST 或 IPC）提供。
 */
import type { BookItem, BreakdownPart, MorphemeGroup } from './types.js';

/**
 * 把生词按命中的词根/词缀分组。
 * @param items 生词本条目（deleted 会被跳过）
 * @param breakdownOf 词 → 拆解结果（同步函数；异步场景请先预取再闭包传入）
 */
export function groupBookByMorphemeData(
  items: BookItem[],
  breakdownOf: (word: string) => BreakdownPart[],
): MorphemeGroup[] {
  const map = new Map<string, MorphemeGroup>();
  for (const it of items) {
    if (it.deleted) continue;
    const parts = breakdownOf(it.word);
    const seen = new Set<string>();
    for (const p of parts) {
      if (!p.morpheme || seen.has(p.morpheme)) continue;
      seen.add(p.morpheme);
      let g = map.get(p.morpheme);
      if (!g) {
        g = {
          morpheme: p.morpheme,
          kind: p.kind,
          meaningZh: p.meaningZh,
          origin: p.origin,
          words: [],
          examples: [],
        };
        map.set(p.morpheme, g);
      }
      if (!g.words.includes(it.word)) g.words.push(it.word);
      for (const ex of p.examples ?? []) {
        if (!g.examples.includes(ex)) g.examples.push(ex);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.words.length - a.words.length);
}
