/**
 * 俄语变格变位表格化展示
 * 按语法标签把词形组织成 行维度 × 列维度 的范式表：
 *  - 名词/形容词：行=格（主格/属格/…），列=数（×性）
 *  - 动词现在/将来时：行=人称，列=时态·数
 *  - 动词过去时：行=时态，列=性·数
 * 无法归入范式的词形回落为 chips。
 */
import type { I18nForm } from '@zidiankaifa/core';
import { RUS_TAG_LABEL } from '@zidiankaifa/core';

interface RuFormsTableProps {
  forms: I18nForm[];
  /** 点击词形即查询该词（俄语） */
  onPick: (word: string) => void;
}

const CASE_TAGS = [
  'nominative',
  'genitive',
  'dative',
  'accusative',
  'instrumental',
  'prepositional',
  'locative',
  'vocative',
];
const PERSON_TAGS = ['first-person', 'second-person', 'third-person'];
const TENSE_TAGS = ['past', 'present', 'future'];
const NUMBER_TAGS = ['singular', 'plural'];
const GENDER_TAGS = ['masculine', 'feminine', 'neuter'];

/** 维度优先级（决定行/列归属顺序） */
const DIM_ORDER = ['case', 'person', 'tense', 'gender', 'number'];

const CANON: Record<string, string[]> = {
  case: CASE_TAGS,
  person: PERSON_TAGS,
  tense: TENSE_TAGS,
  gender: GENDER_TAGS,
  number: NUMBER_TAGS,
};

const DIM_ZH: Record<string, string> = {
  case: '格',
  person: '人称',
  tense: '时态',
  gender: '性',
  number: '数',
};

function zh(t: string): string {
  return RUS_TAG_LABEL[t] ?? t;
}

function dimOf(tag: string): string | null {
  if (CASE_TAGS.includes(tag)) return 'case';
  if (PERSON_TAGS.includes(tag)) return 'person';
  if (TENSE_TAGS.includes(tag)) return 'tense';
  if (GENDER_TAGS.includes(tag)) return 'gender';
  if (NUMBER_TAGS.includes(tag)) return 'number';
  return null;
}

function firstTag(f: I18nForm, tags: string[]): string | null {
  for (const t of tags) {
    if (f.tags.includes(t)) return t;
  }
  return null;
}

interface TableCell {
  display: string;
  tags: string[];
  form: string;
}

interface ParadigmTable {
  /** 行维度中文名 */
  rowDimLabel: string;
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  cells: Record<string, TableCell[]>;
}

export default function RuFormsTable({ forms, onPick }: RuFormsTableProps) {
  const { tables, leftovers } = buildParadigms(forms);

  return (
    <div className="ru-forms">
      {tables.length === 0 && leftovers.length === 0 && (
        <div className="empty">暂无变格变位数据</div>
      )}
      {tables.map((t, ti) => (
        <table className="ru-table" key={ti}>
          <thead>
            <tr>
              <th className="ru-th-corner">{t.rowDimLabel}</th>
              {t.cols.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.key}>
                <th className="ru-th-row">{r.label}</th>
                {t.cols.map((c) => {
                  const cells = t.cells[`${r.key}|${c.key}`] ?? [];
                  return (
                    <td key={c.key}>
                      {cells.length === 0 ? (
                        <span className="ru-cell-empty">—</span>
                      ) : (
                        cells.map((cell, i) => (
                          <button
                            key={`${cell.form}-${i}`}
                            className="ru-cell-btn"
                            title="点击查询该词形"
                            onClick={() => onPick(cell.form)}
                          >
                            {cell.display}
                          </button>
                        ))
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {leftovers.length > 0 && (
        <div className="ru-leftovers">
          {leftovers.map((f, idx) => (
            <button
              key={`${f.form}-${idx}`}
              className="i18n-form-chip"
              title="点击查询该词形"
              onClick={() => onPick(f.form)}
            >
              {f.display}
              {f.tags.length > 0 && (
                <span className="i18n-form-tags">
                  {f.tags.map(zh).join('/')}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function buildParadigms(forms: I18nForm[]): {
  tables: ParadigmTable[];
  leftovers: I18nForm[];
} {
  // 行维度优先级：人称 > 格 > 时态 > 性
  const rowDim =
    (forms.some((f) => hasAny(f, PERSON_TAGS)) && 'person') ||
    (forms.some((f) => hasAny(f, CASE_TAGS)) && 'case') ||
    (forms.some((f) => hasAny(f, TENSE_TAGS)) && 'tense') ||
    (forms.some((f) => hasAny(f, GENDER_TAGS)) && 'gender') ||
    null;

  if (!rowDim) return { tables: [], leftovers: forms };

  const colDims = DIM_ORDER.filter((d) => d !== rowDim && forms.some((f) => hasDim(f, d)));

  const rowsMap = new Map<string, string>();
  const colsMap = new Map<string, string>();
  const cells: Record<string, TableCell[]> = {};

  const leftovers: I18nForm[] = [];
  for (const f of forms) {
    const rowTag = firstTag(f, CANON[rowDim]);
    if (!rowTag) {
      leftovers.push(f);
      continue;
    }
    const colKey = colDims
      .map((d) => firstTag(f, CANON[d]))
      .filter(Boolean)
      .join('·');
    if (colDims.length > 0 && !colKey) {
      leftovers.push(f);
      continue;
    }
    const rowKey = rowTag;
    const ck = colKey || '其他';
    rowsMap.set(rowKey, zh(rowTag));
    colsMap.set(ck, ck === '其他' ? '其他' : colKey.split('·').map(zh).join('·'));
    const key = `${rowKey}|${ck}`;
    (cells[key] ??= []).push({ display: f.display, tags: f.tags, form: f.form });
  }

  if (rowsMap.size === 0) return { tables: [], leftovers: forms };

  // 行列按规范顺序排序（未知标签追加在后）
  const canonOrder = CANON[rowDim];
  const sortKeys = (keys: string[], canonical: string[]) =>
    [...keys].sort((a, b) => {
      const ia = canonical.indexOf(a);
      const ib = canonical.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  const tables: ParadigmTable[] = [
    {
      rowDimLabel: DIM_ZH[rowDim] ?? rowDim,
      rows: sortKeys([...rowsMap.keys()], canonOrder).map((k) => ({
        key: k,
        label: rowsMap.get(k)!,
      })),
      cols: sortKeys([...colsMap.keys()], []).map((k) => ({
        key: k,
        label: colsMap.get(k)!,
      })),
      cells,
    },
  ];

  return { tables, leftovers };
}

function hasAny(f: I18nForm, tags: string[]): boolean {
  return tags.some((t) => f.tags.includes(t));
}

function hasDim(f: I18nForm, dim: string): boolean {
  return (CANON[dim] ?? []).some((t) => f.tags.includes(t));
}
