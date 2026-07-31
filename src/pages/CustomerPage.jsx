import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, yen, jpDate, md, 本日 } from '../api';
import { Modal, Text, Money, Select, Err, Note, Empty } from '../components/ui';

const p2 = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export default function CustomerPage({ id, onBack, onChanged, goHistory }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [month, setMonth] = useState(null);   // {y,m}。null なら追いかけている月
  const [day, setDay] = useState(null);       // 開いている日
  const [editing, setEditing] = useState(null); // 編集中の約束

  const load = useCallback(() => {
    setErr('');
    api.customer(id).then(setD).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(() => { setMonth(null); setDay(null); load(); }, [load]);

  // 表示する月。追いかけている回の月を出し、今月より前には戻さない
  const ym = useMemo(() => {
    if (month) return month;
    const now = new Date();
    const nowYM = { y: now.getFullYear(), m: now.getMonth() + 1 };
    if (!d) return nowYM;
    const cur = d.支払予定.find((s) => s.状態 !== '入金済み');
    if (!cur) return nowYM;
    const [y, m] = cur.期日.split('-').map(Number);
    return (y * 12 + m) < (nowYM.y * 12 + nowYM.m) ? nowYM : { y, m };
  }, [month, d]);

  if (err) return (<><div className="bar"><button className="btn" onClick={onBack}>← 顧客一覧へ戻る</button></div><Err>{err}</Err></>);
  if (!d) return <Empty>読み込んでいます…</Empty>;

  const c = d.顧客;
  const move = (n) => {
    if (!n) { setMonth(null); setDay(null); return; }
    const t = ym.y * 12 + (ym.m - 1) + n;
    setMonth({ y: Math.floor(t / 12), m: (t % 12) + 1 });
    setDay(null);
  };

  // 日ごとの印
  const marks = {};
  const put = (iso, o) => { if (iso) (marks[iso] = marks[iso] || []).push(o); };
  d.支払予定.forEach((s) => put(s.期日, {
    t: 'due', 回次: s.回次, 済み: s.状態 === '入金済み',
    残り: Math.max(0, s.請求 - s.入金), 請求: s.請求,
  }));
  d.約束.forEach((p) => put(p.日付, { t: 'prom', ...p }));
  d.入金.forEach((p) => put(p.日付, { t: 'paid', 金額: p.金額, 区分: p.区分 }));

  const today = 本日();
  const first = new Date(ym.y, ym.m - 1, 1).getDay();
  const last = new Date(ym.y, ym.m, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let dd = 1; dd <= last; dd++) cells.push(dd);
  while (cells.length % 7) cells.push(null);

  return (
    <>
      <div className="bar">
        <button className="btn" onClick={onBack}>← 顧客一覧へ戻る</button>
        <div className="bar-right">
          <button className="btn" onClick={() => goHistory(c.氏名)}>この方の入金履歴を見る →</button>
        </div>
      </div>

      <div className="cust-head">
        <div>
          <h2 className="cust-name">{c.氏名}</h2>
          <div className="cust-sub">
            {c.よみ && <span>{c.よみ}</span>}
            {c.車種 && <span>{c.車種}</span>}
            <span>{c.回次}回目 / 全{c.回数}回</span>
            <span>毎月 {c.支払日}日</span>
            {c.債権譲渡会社 && <span>譲渡会社：{c.債権譲渡会社}</span>}
            {c.債権譲渡先 && <span>譲渡先：{c.債権譲渡先}</span>}
            {c.電話番号 && <a href={`tel:${c.電話番号.replace(/-/g, '')}`}>{c.電話番号}</a>}
          </div>
        </div>
      </div>

      <div className="strip">
        <div className="s"><b>{yen(c.月々の金額)}円</b><i>月々の金額</i></div>
        <div className="s"><b>{c.次の期日 ? jpDate(c.次の期日) : '—'}</b><i>次の支払期日</i></div>
        {c.この回の入金 > 0 && (
          <div className="s bad"><b>{yen(c.この回の残り)}円</b>
            <i>この回の残り（請求 {yen(c.この回の請求)}円 / 入金 {yen(c.この回の入金)}円）</i></div>
        )}
        <div className="s"><b>{c.回数 - c.残り回数}回 / {c.回数}回</b><i>支払い回数</i></div>
        <div className="s"><b>{c.残り回数}回</b><i>残り支払い回数</i></div>
        <div className="s"><b>{yen(c.残債)}円</b><i>残債金額</i></div>
        {c.完済 && <div className="s good"><b>完済</b><i>お支払いは終わっています</i></div>}
      </div>

      <div className="cols">
        {/* ── 左7割：月カレンダー ── */}
        <div>
          <div className="sec">
            <h3>入金カレンダー</h3>
            <div className="cal-bar">
              <button className="btn btn-sm" onClick={() => move(-1)}>◀ 前の月</button>
              <b className="cal-title">{ym.y}年{ym.m}月</b>
              <button className="btn btn-sm" onClick={() => move(1)}>次の月 ▶</button>
              <button className="btn btn-sm" onClick={() => move(0)}>今月</button>
            </div>

            <div className="cal">
              <div className="cal-row cal-head">
                {WEEK.map((w, i) => (
                  <span key={w} className={'cal-w' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '')}>{w}</span>
                ))}
              </div>
              {Array.from({ length: cells.length / 7 }, (_, wi) => (
                <div className="cal-row" key={wi}>
                  {cells.slice(wi * 7, wi * 7 + 7).map((dd, di) => {
                    if (!dd) return <span className="cal-c out" key={di} />;
                    const iso = isoOf(ym.y, ym.m, dd);
                    const ev = marks[iso] || [];
                    const cls = ['cal-c', di === 0 ? 'sun' : '', di === 6 ? 'sat' : '',
                      iso === today ? 'today' : '', day === iso ? 'on' : ''].filter(Boolean).join(' ');
                    return (
                      <button className={cls} key={di} onClick={() => { setDay(iso); setEditing(null); }}>
                        <span className="cal-d">{dd}</span>
                        {ev.map((e, i) => e.t === 'due' ? (
                          <span key={i} className={'chip c-due' + (e.済み ? ' done' : '')}>
                            {e.回次}回目 {e.済み ? '済' : yen(e.残り)}
                          </span>
                        ) : e.t === 'prom' ? (
                          <span key={i} className="chip c-prom">
                            約束 {yen(e.金額)}{e.時刻 ? ` ${e.時刻}` : ''}
                          </span>
                        ) : (
                          <span key={i} className="chip c-paid">入金 {yen(e.金額)}</span>
                        ))}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="legend">
              <span><i className="c-due" />支払期日（固定）</span>
              <span><i className="c-prom" />入金約束日</span>
              <span><i className="c-paid" />入金</span>
              <span style={{ color: 'var(--ink-3)' }}>日を押すと、その日に入金約束を入れられます。</span>
            </div>

            {day && (
              <DayBox
                iso={day} 顧客={c} 予定={d.支払予定} 印={marks[day] || []}
                editing={editing} setEditing={setEditing}
                onClose={() => { setDay(null); setEditing(null); }}
                onDone={() => { setDay(null); setEditing(null); load(); onChanged && onChanged(); }}
              />
            )}
          </div>

          <CustomerMemo c={c} onDone={() => { load(); onChanged && onChanged(); }} />
        </div>

        {/* ── 右3割：支払いの記録 ── */}
        <div className="sec">
          <h3>支払いの記録（全{c.回数}回）</h3>
          <div className="rec">
            {d.支払予定.map((s) => {
              const late = s.状態 !== '入金済み' && s.期日 < today;
              const cls = ['rec-r', s.状態 === '入金済み' ? 'paid' : s.状態 === '一部入金' ? 'part' : '',
                late ? 'late' : '', s.回次 === c.回次 ? 'now' : ''].filter(Boolean).join(' ');
              return (
                <div className={cls} key={s.回次}>
                  <span className="no">{s.回次}回</span>
                  <span>{md(s.期日)}
                    {s.状態 === '一部入金' &&
                      <span style={{ color: 'var(--today)', marginLeft: 6, fontSize: 12 }}>
                        残 {yen(s.請求 - s.入金)}
                      </span>}
                    {late && s.状態 !== '一部入金' &&
                      <span style={{ color: 'var(--overdue)', marginLeft: 6, fontSize: 12 }}>未入金</span>}
                  </span>
                  <span className="amt">{yen(s.請求)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

// ── 日を押したときの欄 ─────────────────────────
function DayBox({ iso, 顧客, 予定, 印, editing, setEditing, onClose, onDone }) {
  const 未済 = 予定.filter((s) => s.状態 !== '入金済み');
  const 既定回 = (未済[0] || {}).回次 || '';
  const 既定額 = 未済[0] ? Math.max(0, 未済[0].請求 - 未済[0].入金) : '';
  const 約束 = 印.filter((x) => x.t === 'prom');

  const [v, setV] = useState({ 回次: String(既定回), 金額: 既定額, 終日: true, 時刻: '17:00', メモ: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((o) => ({ ...o, [k]: val }));

  useEffect(() => {
    if (editing) {
      setV({
        回次: editing.回次 ? String(editing.回次) : '',
        金額: editing.金額, 終日: editing.終日,
        時刻: editing.時刻 || '17:00', メモ: editing.メモ || '',
      });
    } else {
      setV({ 回次: String(既定回), 金額: 既定額, 終日: true, 時刻: '17:00', メモ: '' });
    }
    setErr('');
  }, [editing, iso]);

  const 過去 = iso < 本日();

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = {
        id: 顧客.id, 日付: iso, 回次: v.回次 || null, 金額: v.金額,
        終日: v.終日, 時刻: v.時刻, メモ: v.メモ,
      };
      if (editing) await api.postCustomer({ ...body, 種類: '約束変更', 約束id: editing.id });
      else await api.postCustomer({ ...body, 種類: '約束' });
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const remove = async (p) => {
    if (!confirm(`${jpDate(p.日付)} の約束（${yen(p.金額)}円）を取り消します。よろしいですか。`)) return;
    setBusy(true); setErr('');
    try {
      await api.postCustomer({ id: 顧客.id, 種類: '約束削除', 約束id: p.id });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="sec" style={{ borderColor: 'var(--indigo)', marginTop: 12 }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {jpDate(iso)}
        <span style={{ marginLeft: 'auto' }}>
          <button className="btn btn-sm" onClick={onClose}>閉じる</button>
        </span>
      </h3>

      {印.filter((x) => x.t === 'due').map((e, i) => (
        <Note key={i}>
          この日は <b>{e.回次}回目の支払期日</b>です（請求 {yen(e.請求)}円
          {e.済み ? '・入金済み' : `・残り ${yen(e.残り)}円`}）。期日は固定で、約束では動きません。
        </Note>
      ))}

      {約束.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {約束.map((p) => (
            <div key={p.id} style={{
              display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
              padding: '7px 10px', border: '1px solid #DCC98C', background: '#FDFAF1',
              marginBottom: 6,
            }}>
              <b>約束 {yen(p.金額)}円</b>
              <span style={{ fontSize: 13 }}>{p.終日 ? '終日' : `${p.時刻} まで`}</span>
              {p.回次 && <span style={{ fontSize: 13 }}>{p.回次}回目ぶん</span>}
              {p.メモ && <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{p.メモ}</span>}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => setEditing(p)}>編集</button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(p)} disabled={busy}>削除</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {過去 && !editing ? (
        <Note kind="warn">過ぎた日には、これから払う約束を入れられません。</Note>
      ) : (
        <>
          <h4 style={{ margin: '0 0 8px', fontSize: 13.5 }}>
            {editing ? '入金約束の編集' : '入金約束の登録'}
          </h4>
          <div className="grid3">
            <Select label="どの回ぶん" value={v.回次} onChange={set('回次')} placeholder="決めない"
                    options={未済.map((s) => ({
                      value: String(s.回次),
                      label: `${s.回次}回目（残り ${yen(s.請求 - s.入金)}円）`,
                    }))} />
            <Money label="いくら入金" value={v.金額} onChange={set('金額')} />
            <div className="f">
              <label>いつまで</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 13.5 }}>
                  <input type="checkbox" checked={v.終日} style={{ width: 'auto' }}
                         onChange={(e) => set('終日')(e.target.checked)} />
                  終日
                </label>
                <input type="time" value={v.時刻} disabled={v.終日}
                       onChange={(e) => set('時刻')(e.target.value)} />
              </div>
            </div>
          </div>
          <Text label="メモ" value={v.メモ} onChange={set('メモ')}
                placeholder="言われたこと（給料日後、家族が払う など）" />
          <Err>{err}</Err>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-main" onClick={save} disabled={busy}>
              {busy ? '保存しています…' : editing ? '変更を保存' : '登録する'}
            </button>
            {editing && <button className="btn" onClick={() => setEditing(null)}>キャンセル</button>}
          </div>
        </>
      )}
    </div>
  );
}

// ── 顧客についてのメモ ────────────────────────
function CustomerMemo({ c, onDone }) {
  const [memo, setMemo] = useState(c.メモ || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);

  // 保存すると親が読み直すので、この部品にも新しい c が届く。
  // そこで無条件に「保存しました」を消すと、出た瞬間に消えてしまう。
  // いま保存した中身と同じものが返ってきたときは、消さない。
  useEffect(() => {
    setMemo((cur) => (cur === (c.メモ || '') ? cur : (c.メモ || '')));
    setSaved((s) => (s && memo === (c.メモ || '')));
  }, [c.id, c.メモ]);   // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true); setErr(''); setSaved(false);
    try {
      await api.patchCustomer({ id: c.id, 顧客メモ: memo });
      setSaved(true);
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="sec">
      <h3>この顧客についてのメモ</h3>
      <div className="f">
        <textarea value={memo} onChange={(e) => { setMemo(e.target.value); setSaved(false); }}
                  placeholder="連絡のつきやすい時間、勤務先、家族のこと、事情など" rows={5} />
      </div>
      <Err>{err}</Err>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn" onClick={save} disabled={busy || memo === (c.メモ || '')}>
          {busy ? '保存しています…' : 'メモを保存'}
        </button>
        {saved && <span style={{ color: 'var(--paid)', fontSize: 13 }}>保存しました。</span>}
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>この欄は書き直せます。</span>
      </div>
    </div>
  );
}
