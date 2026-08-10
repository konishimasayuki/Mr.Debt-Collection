import { useEffect, useRef, useState } from 'react';
import { norm } from '../api';

// ── モーダル ────────────────────────────────
// Escで閉じ、外側を押しても閉じる。
//
// 開いたときに入力欄へ自動で移るのは、キーボードのある端末だけにする。
// 日付や時刻の欄へ移ると、端末の日付選びが勝手にせり上がってくる。
// 指で操作する端末では、そもそも移らない（開いた瞬間にキーボードが出て、
// 下の「登録する」が隠れてしまう）。
const 自動で移らない = 'date,time,month,week,datetime-local,file,checkbox,radio';
const 移る先 = `input:not([type=${自動で移らない.split(',').join(']):not([type=')}]),textarea`;

// huge … 表を大きく見せたいとき（CSVの確認など）。画面いっぱいまで広げる
export function Modal({ title, onClose, children, foot, wide, huge }) {
  const box = useRef(null);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    const 指で操作 = typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: none)').matches;
    if (!指で操作) {
      const el = box.current && box.current.querySelector(移る先);
      if (el) el.focus();
    }
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal-box' + (huge ? ' huge' : wide ? ' wide' : '')}
           ref={box} role="dialog" aria-modal="true">
        {/* 右上の「閉じる」は置かない。スマホでは題と重なって読めなくなる。
            閉じるのは下の「キャンセル」。どのモーダルにも必ず置いてある */}
        <div className="modal-h">
          <h3>{title}</h3>
        </div>
        {/* 中身は1枚で包む。大きく出すとき（huge）に、ここだけを伸び縮みさせるため */}
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

// ── 入力欄 ─────────────────────────────────
export function Field({ label, hint, children }) {
  return (
    <div className="f">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Text({ label, hint, value, onChange, ...rest }) {
  return (
    <Field label={label} hint={hint}>
      <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

// 金額欄。打っている最中も3桁区切りで見せる
export function Money({ label, hint, value, onChange, ...rest }) {
  const show = value === '' || value == null ? '' : Number(value).toLocaleString('ja-JP');
  return (
    <Field label={label} hint={hint}>
      <input
        inputMode="numeric" value={show}
        onChange={(e) => {
          const n = e.target.value.replace(/[^0-9]/g, '');
          onChange(n === '' ? '' : Number(n));
        }}
        {...rest}
      />
    </Field>
  );
}

export function Select({ label, hint, value, onChange, options, placeholder, ...rest }) {
  return (
    <Field label={label} hint={hint}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

// ── 名前を打って選ぶ欄 ───────────────────────────
// 「絞る欄」と「選ぶ欄」を分けない。打つと下に候補が出て、押すと決まる。
// かな・カナ・半角カナ・漢字・英字のどれで打っても当たる（norm）。
export function Picker({ label, hint, value, onChange, items, placeholder }) {
  const [key, setKey] = useState('');
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);          // キーボードで動かしている候補
  const box = useRef(null);

  const 選択中 = items.find((x) => String(x.id) === String(value)) || null;

  // 外を押したら候補を閉じる
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const k = norm(key);
  const 候補 = (k ? items.filter((x) => norm(x.名前).includes(k) || norm(x.よみ || '').includes(k))
    : items).slice(0, 8);

  const 決める = (x) => {
    onChange(String(x.id));
    setKey(''); setOpen(false); setAt(0);
  };

  const キー = (e) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => Math.min(n + 1, 候補.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => Math.max(n - 1, 0)); }
    else if (e.key === 'Enter' && 候補[at]) { e.preventDefault(); 決める(候補[at]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <Field label={label} hint={hint}>
      <div className="pick" ref={box}>
        {選択中 ? (
          <div className="pick-on">
            <b>{選択中.名前}</b>
            {選択中.よみ && <span className="pick-sub">{選択中.よみ}</span>}
            {選択中.脇 && <span className="pick-sub">{選択中.脇}</span>}
            <button type="button" className="btn btn-sm" onClick={() => { onChange(''); setKey(''); }}>
              変更
            </button>
          </div>
        ) : (
          <>
            <input
              value={key} placeholder={placeholder || '名前を打ってください'}
              onChange={(e) => { setKey(e.target.value); setOpen(true); setAt(0); }}
              onFocus={() => setOpen(true)}
              onKeyDown={キー}
            />
            {open && (
              <div className="pick-list">
                {候補.length === 0 && <div className="pick-none">見つかりませんでした。</div>}
                {候補.map((x, i) => (
                  <div
                    key={x.id}
                    className={'pick-item' + (i === at ? ' on' : '')}
                    onMouseEnter={() => setAt(i)}
                    onMouseDown={(e) => { e.preventDefault(); 決める(x); }}
                  >
                    <b>{x.名前}</b>
                    {x.よみ && <span className="pick-sub">{x.よみ}</span>}
                    {x.脇 && <span className="pick-sub">{x.脇}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Field>
  );
}

// ── 知らせ ─────────────────────────────────
export function Note({ kind, children }) {
  if (!children) return null;
  return <div className={'note' + (kind ? ' ' + kind : '')}>{children}</div>;
}

export function Err({ children }) {
  if (!children) return null;
  return <div className="err">{String(children)}</div>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

// 読み込み中の下敷き。「読み込んでいます…」の一行より、
// これから何が並ぶかが見えるほうが待ち時間が短く感じる。
export function Loading({ 件数 = 5, 行 = 4 }) {
  return (
    <div className="skel" aria-label="読み込んでいます">
      {Array.from({ length: 件数 }, (_, i) => (
        <div className="skel-c" key={i}>
          <span className="skel-b t" />
          {Array.from({ length: 行 }, (_, j) => (
            <span className="skel-b" key={j} style={{ width: `${[62, 48, 70, 40][j % 4]}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
