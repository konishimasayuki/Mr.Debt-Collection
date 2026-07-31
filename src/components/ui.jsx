import { useEffect, useRef } from 'react';

// ── モーダル ────────────────────────────────
// Escで閉じ、外側を押しても閉じる。開いたら最初の入力へ行く。
export function Modal({ title, onClose, children, foot, wide }) {
  const box = useRef(null);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    const el = box.current && box.current.querySelector('input,select,textarea');
    if (el) el.focus();
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal-box' + (wide ? ' wide' : '')} ref={box} role="dialog" aria-modal="true">
        <div className="modal-h">
          <h3>{title}</h3>
          <button className="btn btn-sm x" onClick={onClose}>閉じる</button>
        </div>
        {children}
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
