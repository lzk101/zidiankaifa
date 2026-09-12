import type { EtymologyLink } from '@zidiankaifa/core';

interface EtymTextProps {
  text: string;
  /** 词源文本中本词典可查的相关词（core 提取） */
  links?: EtymologyLink[];
  /** 点击相关词 → 按该词的语言直接查词 */
  onPick?: (word: string, lang: string) => void;
}

const RU = '\\u0400-\\u04FF';
const EN = 'A-Za-z';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 词源详解正文：把其中「本词典可查的相关词」渲染成可点链接，点击直接查该词。
 * 这让「继承自原始斯拉夫语 *tъska，可能与 тощий 或 тискать 相关」里的生词可一键展开词族。
 */
export default function EtymText({ text, links, onPick }: EtymTextProps) {
  if (!links?.length || !onPick) return <>{text}</>;

  const map = new Map(links.map((l) => [l.word.toLowerCase(), l]));
  // 长词优先，避免短词先匹配掉长词的前缀
  const alts = links
    .map((l) => l.word)
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|');
  if (!alts) return <>{text}</>;

  // JS 的 \b 不认西里尔，用显式前后瞻保证不切断单词
  const re = new RegExp(`(?<![${RU}${EN}])(${alts})(?![${RU}${EN}])`, 'gi');
  const parts = text.split(re);

  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        const link = map.get(p.toLowerCase());
        if (!link) return <span key={i}>{p}</span>;
        return (
          <button
            key={i}
            type="button"
            className="etym-link"
            title={link.translation ? `${link.word} — ${link.translation}` : `查 ${link.word}`}
            onClick={() => onPick(link.word, link.lang)}
          >
            {p}
          </button>
        );
      })}
    </>
  );
}
