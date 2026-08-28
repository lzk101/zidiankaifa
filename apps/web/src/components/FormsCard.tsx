import type { FormType, WordForm } from '@zidiankaifa/core';

interface FormsCardProps {
  forms: WordForm[];
  /** 点击词形即查询该词 */
  onPick: (word: string) => void;
}

const FORM_LABELS: Record<FormType, string> = {
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

const FORM_ORDER: FormType[] = [
  'base',
  'plural',
  'past',
  'done',
  'ing',
  'third',
  'comp',
  'super',
  'variant',
];

export default function FormsCard({ forms, onPick }: FormsCardProps) {
  const groups = new Map<FormType, WordForm[]>();
  for (const f of forms) {
    const arr = groups.get(f.type) ?? [];
    arr.push(f);
    groups.set(f.type, arr);
  }

  return (
    <div className="card forms-card">
      <h3 className="card-title">词形演变</h3>
      {forms.length === 0 ? (
        <div className="empty">暂无词形变化数据</div>
      ) : (
        <div className="forms-body">
          {FORM_ORDER.filter((t) => groups.has(t)).map((t) => (
            <div className="form-group" key={t}>
              <span className="form-label">{FORM_LABELS[t]}</span>
              <div className="form-chips">
                {groups.get(t)!.map((f) => (
                  <button
                    key={f.form}
                    className="form-chip"
                    title={`查询 ${f.form}`}
                    onClick={() => onPick(f.form)}
                  >
                    {f.form}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
