import { useEffect, useState } from 'react';
import { STATUS_LABEL, STATUS_ORDER } from '../types';
import { fmtDateW, fmtDur, fmtTime, toFrames } from '../lib/time';
import {
  cutLabel,
  cutStart,
  useCurrentCut,
  useCurrentCutIndex,
  useEditor,
} from '../state/editor';
import { addCutAtEnd, deleteCut, duplicateCut, updateCut } from '../state/actions';
import { Icon } from './Icon';

export function Inspector() {
  const cut = useCurrentCut();
  const index = useCurrentCutIndex();
  const fps = useEditor((s) => s.project?.fps ?? 30);
  const start = useEditor((s) => (s.project && index >= 0 ? cutStart(s.project.cuts, index) : 0));
  const [confirm, setConfirm] = useState(false);

  // 別のカットに移ったら、削除の確認を取り消す
  const cutId = cut?.id;
  useEffect(() => setConfirm(false), [cutId]);

  if (!cut) {
    return (
      <aside className="inspector">
        <div className="sub">カットを選ぶと、ここに歌詞・内容・予定の欄が出る。</div>
        <button className="btn" onClick={addCutAtEnd}>
          <Icon name="plus" size={18} />
          カットを追加
        </button>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <div className="insp-head">
        <div className="big">{cutLabel(index)}</div>
        <div className="mono sub" style={{ fontSize: 12 }}>
          {fmtTime(start)} ・ {fmtDur(cut.duration)}秒 ・ {toFrames(cut.duration, fps)}f
        </div>
      </div>

      <div className="field">
        <span className="label">進み具合</span>
        <div className="seg">
          {STATUS_ORDER.map((st) => (
            <button
              key={st}
              className={cut.status === st ? `on st-${st}` : ''}
              aria-pressed={cut.status === st}
              onClick={() => updateCut(cut.id, { status: st })}
            >
              {STATUS_LABEL[st]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="row-between">
          <label htmlFor="cut-due">締切</label>
          {cut.due && (
            <span className="mono sub" style={{ fontSize: 12 }}>
              {fmtDateW(cut.due)}
            </span>
          )}
        </div>
        <input
          id="cut-due"
          type="date"
          className="input"
          value={cut.due ?? ''}
          onChange={(e) => updateCut(cut.id, { due: e.target.value || null })}
        />
      </div>

      <div className="field">
        <label htmlFor="cut-lyric">歌詞</label>
        <textarea
          id="cut-lyric"
          className="input"
          rows={2}
          value={cut.lyric}
          onChange={(e) => updateCut(cut.id, { lyric: e.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor="cut-desc">内容</label>
        <textarea
          id="cut-desc"
          className="input"
          rows={3}
          value={cut.desc}
          onChange={(e) => updateCut(cut.id, { desc: e.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor="cut-memo">備考</label>
        <textarea
          id="cut-memo"
          className="input"
          rows={2}
          value={cut.memo}
          onChange={(e) => updateCut(cut.id, { memo: e.target.value })}
        />
      </div>

      <div className="two-col">
        <button className="btn" onClick={() => duplicateCut(cut.id)}>
          複製
        </button>
        {confirm ? (
          <button className="btn danger" onClick={() => deleteCut(cut.id)}>
            本当に削除
          </button>
        ) : (
          <button className="btn" onClick={() => setConfirm(true)}>
            削除
          </button>
        )}
      </div>
    </aside>
  );
}
