import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, yen, jpDate, md, ymd, 本日 } from '../api';
import { Modal, Text, Money, Select, Err, Note, Empty, Loading } from '../components/ui';

const p2 = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

// 生年月日から歳を出す。誕生日が来ていなければ1つ引く
function 年齢(生年月日) {
  const [y, m, d] = String(生年月日).split('-').map(Number);
  const t = new Date();
  let n = t.getFullYear() - y;
  if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) n -= 1;
  return n;
}

// 口座振替の状態を1行で表す。日がいるのは申込と開始だけ
const 振替の文 = (状態, 日) => (
  状態 === '口座振替申込' ? `${日 ? ymd(日) + ' ' : ''}口座振替申込`
  : 状態 === '口座振替開始' ? `${日 ? ymd(日) + ' ' : ''}口座振替開始`
  : 状態 === '口座振替停止' ? '口座振替停止'
  : '未申込');

export default function CustomerPage({ id, onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [month, setMonth] = useState(null);   // {y,m}。null なら追いかけている月
  const [day, setDay] = useState(null);       // 開いている日
  const [editing, setEditing] = useState(null); // 編集中の約束
  const [editCustomer, setEditCustomer] = useState(false);
  const [振替, set振替] = useState(false);   // 口座振替の状態を変える欄
  const [メモ欄, setメモ欄] = useState(null); // メモを足そうとしている回（'通常-3' の形）

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

  if (err) return <Err>{err}</Err>;
  if (!d) return <Loading 件数={2} 行={6} />;

  const c = d.顧客;

  // 支払いの記録に出ている「約束の写し」から、約束そのものを開く。
  // 写しの文だけ直しても約束は変わらないので、カレンダー側の編集へ送る。
  const 開く約束 = (m) => {
    const p = d.約束.find((x) => x.id === m.約束id);
    if (!p) return;
    const [y, mo] = p.日付.split('-').map(Number);
    setMonth({ y, m: mo });
    setDay(p.日付);
    setEditing(p);
    // カレンダーは画面の上のほうにある。押した場所から遠いので、そこまで送る
    setTimeout(() => {
      const el = document.querySelector('.cal-wrap') || document.querySelector('.sec');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

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
    t: 'due', 回次: s.回次, 種類: s.種類, 済み: s.状態 === '入金済み',
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
      {editCustomer && (
        <EditCustomer
          c={c}
          onClose={() => setEditCustomer(false)}
          onDone={() => { setEditCustomer(false); load(); onChanged && onChanged(); }}
        />
      )}

      <div className="cust-head">
        <h2 className="cust-name">{c.氏名}</h2>
        {c.テスト && <span className="tag t-test">テスト</span>}
        <button className="btn btn-sm" onClick={() => setEditCustomer(true)}>顧客情報を編集</button>
      </div>
      {c.テスト && (
        <Note>
          動作を試すための顧客です。本物の顧客ではありません。
          入金・約束・メモを自由に試してください。設定タブから作り直せます。
        </Note>
      )}
      {/* 顧客情報。電話中に見たいものをここに並べる */}
      <div className="cust-sub">
        {c.よみ && <span>{c.よみ}</span>}
        {c.性別 && <span>{c.性別}</span>}
        {c.生年月日 && <span>{jpDate(c.生年月日)}（{年齢(c.生年月日)}歳）</span>}
        {c.電話番号 && <a href={`tel:${c.電話番号.replace(/-/g, '')}`}>{c.電話番号}</a>}
        {c.住所 && <span>{c.住所}</span>}
        {c.車種 && <span>{c.車種}</span>}
        {c.契約日 && <span>契約 {jpDate(c.契約日)}</span>}
        {c.債権譲渡会社 && <span>譲渡会社：{c.債権譲渡会社}</span>}
        {c.債権譲渡先 && <span>譲渡先：{c.債権譲渡先}</span>}
      </div>

      {/* 大事な数字。スマホでも折り返して全部見えるようにする（横に流さない） */}
      <div className="strip">
        <div className="s"><b>{yen(c.月々の金額)}円</b><i>月々の金額</i></div>
        <div className="s"><b>{c.次の期日 ? jpDate(c.次の期日) : '—'}</b><i>次の支払期日</i></div>
        {/* 回次と残り回数は同じことを言っているので1つにまとめた。
            いま追いかけているのがボーナスの回なら、そう分かるように出す。
            金額が違うので、通常の回と取り違えると電話で話が食い違う */}
        <div className={'s' + (c.回の種類 === 'ボーナス' ? ' bns' : '')}>
          <b>
            {c.回の種類 === 'ボーナス'
              ? `ボーナス${c.回次}回目 / 全${c.ボーナス回数}回`
              : `${c.回次}回目 / 全${c.回数}回`}
          </b>
          <i>
            いまの回（残り {c.回の種類 === 'ボーナス' ? c.ボーナス残り : c.残り回数}回）
            {c.ボーナス回数 > 0 && c.回の種類 !== 'ボーナス'
              && ` ／ ボーナス 残${c.ボーナス残り}回`}
          </i>
        </div>
        <div className="s"><b>{yen(c.残債)}円</b><i>残債金額</i></div>
        {/* 押すと口座振替の状態を変えられる。トラブルが多いので、すぐ見えて、すぐ直せる */}
        <button className={'s dbt' + (c.引き落とし === '口座振替開始' ? ' good'
          : c.引き落とし === '口座振替停止' ? ' bad' : '')}
                onClick={() => set振替(true)}>
          <b>{振替の文(c.引き落とし, c.引き落とし日)}</b>
          <i>口座振替（押すと変えられます）</i>
        </button>
        {c.この回の入金 > 0 && (
          <div className="s bad"><b>{yen(c.この回の残り)}円</b>
            <i>この回の残り（請求 {yen(c.この回の請求)}円 / 入金 {yen(c.この回の入金)}円）</i></div>
        )}
        {c.状態 === '回収' && (
          <div className="s taken"><b>車両を引き上げ</b>
            <i>{c.状態日 ? `${jpDate(c.状態日)} に引き上げ。` : ''}督促の対象から外れています</i></div>
        )}
        {c.完済 && <div className="s good"><b>完済</b><i>お支払いは終わっています</i></div>}
      </div>

      {振替 && (
        <DebitBox c={c} onClose={() => set振替(false)}
                  onDone={() => { set振替(false); load(); onChanged && onChanged(); }} />
      )}

      <div className="cols">
        {/* ── 左7割：月カレンダー ── */}
        <div>
          <div className="sec cal-wrap">
            {/* 月を動かす操作は見出しの右へ。カレンダーの上を1段ぶん詰める */}
            <div className="cal-top">
              <h3>入金カレンダー</h3>
              <div className="cal-bar">
                <button className="btn btn-sm" onClick={() => move(-1)}>◀ 前の月</button>
                <b className="cal-title">{ym.y}年{ym.m}月</b>
                <button className="btn btn-sm" onClick={() => move(1)}>次の月 ▶</button>
                <button className="btn btn-sm" onClick={() => move(0)}>今月</button>
              </div>
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
                          <span key={i} className={
                            'chip ' + (e.種類 === 'ボーナス' ? 'c-bonus' : 'c-due')
                            + (e.済み ? ' done' : '')}>
                            <b>{e.種類 === 'ボーナス' ? `賞与${e.回次}回目` : `${e.回次}回目`}</b>
                            <i>{e.済み ? '済' : yen(e.残り)}</i>
                          </span>
                        ) : e.t === 'prom' ? (
                          <span key={i} className="chip c-prom">
                            <b>約束{e.時刻 ? ` ${e.時刻}` : ''}</b><i>{yen(e.金額)}</i>
                          </span>
                        ) : (
                          <span key={i} className="chip c-paid">
                            <b>入金</b><i>{yen(e.金額)}</i>
                          </span>
                        ))}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="legend">
              <span><i className="c-due" />支払期日（固定）</span>
              {c.ボーナス回数 > 0 && <span><i className="c-bonus" />ボーナス払い</span>}
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
          <h3>
            支払いの記録（全{c.回数}回{c.ボーナス回数 > 0 && ` + ボーナス${c.ボーナス回数}回`}）
          </h3>
          <p className="rec-hint">回を押すと、その回にメモを足せます。</p>
          <div className="rec">
            {d.支払予定.map((s) => {
              const late = s.状態 !== '入金済み' && s.期日 < today;
              const ボ = s.種類 === 'ボーナス';
              const いま = s.回次 === c.回次 && s.種類 === (c.回の種類 || '通常');
              const 鍵 = s.種類 + s.回次;
              const 開いている = メモ欄 === 鍵;
              const cls = ['rec-r', s.状態 === '入金済み' ? 'paid' : s.状態 === '一部入金' ? 'part' : '',
                late ? 'late' : '', いま ? 'now' : '', ボ ? 'bonus' : '',
                'rec-tap', 開いている ? 'open' : ''].filter(Boolean).join(' ');
              const 中身 = (
                <>
                  <span className="no">{ボ ? `賞与${s.回次}` : `${s.回次}回`}</span>
                  <span>{md(s.期日)}
                    {s.状態 === '一部入金' &&
                      <span style={{ color: 'var(--today)', marginLeft: 6, fontSize: 12 }}>
                        残 {yen(s.請求 - s.入金)}
                      </span>}
                    {late && s.状態 !== '一部入金' &&
                      <span style={{ color: 'var(--overdue)', marginLeft: 6, fontSize: 12 }}>未入金</span>}
                  </span>
                  <span className="amt">{yen(s.請求)}</span>
                </>
              );
              return (
                <div key={鍵}>
                  {/* 通常もボーナスも押せる。メモは種類と回次の両方で持っているので、
                      通常の3回目とボーナスの3回目が混ざることはない */}
                  <button type="button" className={cls}
                          onClick={() => setメモ欄((k) => (k === 鍵 ? null : 鍵))}>
                    {中身}
                  </button>
                  {/* その回に、いつ・いくら入ったか。
                      期日だけでは、遅れて払われたのかが分からない */}
                  {s.入金明細.map((p, i) => (
                    <div className="rec-p" key={i}>
                      <span className="rec-p-d">{md(p.日付)}</span>
                      <span className="rec-p-w">
                        入金{p.日付 > s.期日 && <span className="rec-p-late">（期日より後）</span>}
                      </span>
                      <span className="rec-p-a">{yen(p.金額)}</span>
                    </div>
                  ))}
                  {開いている && (
                    <RecMemoAdd
                      顧客id={c.id} 回次={s.回次} 回の種類={s.種類}
                      onClose={() => setメモ欄(null)}
                      onDone={() => { load(); onChanged && onChanged(); }}
                    />
                  )}
                  <RecMemos
                    顧客id={c.id} 回次={s.回次} 回の種類={s.種類} メモ={s.メモ}
                    約束を開く={開く約束}
                    onDone={() => { load(); onChanged && onChanged(); }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

// ── その回にメモを足す欄（回を押すと下に出る）───────────
// 電話を切った直後に、その回のことをその場で書き足せるようにする。
// 書いた日と時刻はサーバーが入れる（created_at）。人が入れ間違えない。
function RecMemoAdd({ 顧客id, 回次, 回の種類, onClose, onDone }) {
  const 回の名 = `${回の種類 === 'ボーナス' ? '賞与' : ''}${回次}回目`;
  const [本文, set本文] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const 足す = async () => {
    const text = 本文.trim();
    if (!text) { setErr('メモを入れてください。'); return; }
    setBusy(true); setErr('');
    try {
      await api.postCustomer({ id: 顧客id, 種類: '回メモ', 回次, 回の種類, 本文: text });
      set本文('');          // 続けて足せるように、欄は開けたまま空にする
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="rec-add">
      <label>{回の名}にメモを足す</label>
      <textarea
        rows={2} value={本文} autoFocus disabled={busy}
        placeholder="電話で話したこと、約束の事情など"
        onChange={(e) => { set本文(e.target.value); setErr(''); }}
        onKeyDown={(e) => {
          // 文章なので Enter は改行。送るのは Ctrl/⌘ + Enter
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); 足す(); }
          if (e.key === 'Escape') onClose();
        }}
      />
      <div className="rec-add-b">
        <button className="btn btn-sm btn-main" onClick={足す} disabled={busy}>
          {busy ? '足しています…' : 'メモを足す'}
        </button>
        <button className="btn btn-sm" onClick={onClose} disabled={busy}>閉じる</button>
        <span className="hint">書いた日と時刻も一緒に残ります。</span>
      </div>
      <Err>{err}</Err>
    </div>
  );
}

// ── 日を押したときの欄 ─────────────────────────
// ── 回ごとのメモ（支払いの記録の各回の下）─────────────
// 新しい順に3件まで出し、それより古いものは折りたたむ。
// 入金約束を入れたときなどに自動で足され、あとから編集・削除できる。
function RecMemos({ 顧客id, 回次, 回の種類, メモ, 約束を開く, onDone }) {
  const 回の名 = `${回の種類 === 'ボーナス' ? '賞与' : ''}${回次}回目`;
  const [開く, set開く] = useState(false);
  const [編集, set編集] = useState(null);   // {id, 本文}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!メモ || !メモ.length) return null;
  const 手前 = メモ.slice(0, 3);
  const 残り = メモ.slice(3);

  const save = async () => {
    const text = String(編集.本文 || '').trim();
    if (!text) { setErr('メモを入れてください。'); return; }
    setBusy(true); setErr('');
    try {
      await api.postCustomer({ id: 顧客id, 種類: '回メモ変更', メモid: 編集.id, 本文: text });
      set編集(null); onDone();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const remove = async (m) => {
    if (!confirm(`${回の名}のメモを削除します。\n\n${m.本文}\n\nよろしいですか。`)) return;
    setBusy(true); setErr('');
    try { await api.postCustomer({ id: 顧客id, 種類: '回メモ削除', メモid: m.id }); onDone(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const 一件 = (m) => (
    編集 && 編集.id === m.id ? (
      <div className="rec-m editing" key={m.id}>
        <input
          value={編集.本文} autoFocus disabled={busy}
          onChange={(e) => set編集((o) => ({ ...o, 本文: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') set編集(null); }}
        />
        <div className="rec-m-btn">
          <button className="btn btn-sm btn-main" onClick={save} disabled={busy}>保存</button>
          <button className="btn btn-sm" onClick={() => set編集(null)} disabled={busy}>キャンセル</button>
        </div>
      </div>
    ) : (
      <div className="rec-m" key={m.id}>
        <span className="rec-m-t">{m.本文}</span>
        {/* 書いた日と時刻。「08/07 09:12」（年は同じ画面に何度も出るので落とす） */}
        <span className="rec-m-d">{String(m.日時 || '').slice(5)}</span>
        <div className="rec-m-btn">
          {m.約束id ? (
            // これは約束の写し。ここの文だけ直しても約束は変わらないので、
            // 文は直させず、カレンダーの約束そのものを開く
            <button className="btn btn-sm" onClick={() => 約束を開く(m)}>約束を変更</button>
          ) : (
            <>
              <button className="btn btn-sm"
                      onClick={() => set編集({ id: m.id, 本文: m.本文 })}>編集</button>
              <button className="btn btn-sm btn-danger"
                      onClick={() => remove(m)} disabled={busy}>削除</button>
            </>
          )}
        </div>
      </div>
    )
  );

  return (
    <div className="rec-ms">
      {手前.map(一件)}
      {残り.length > 0 && (
        開く ? (
          <>
            {残り.map(一件)}
            <button className="rec-m-more" onClick={() => set開く(false)}>古いメモを隠す</button>
          </>
        ) : (
          <button className="rec-m-more" onClick={() => set開く(true)}>
            古いメモ {残り.length}件を表示
          </button>
        )
      )}
      <Err>{err}</Err>
    </div>
  );
}

// ── 顧客情報の編集 ────────────────────────────
// 月々の金額・支払回数・毎月の支払日・開始月はここでは変えられない。
// 変えると支払予定を作り直すことになり、すでに充てた入金の行き先が消えるため。
// ── 口座振替（自動引き落とし）の状態を変える ──────────────
// 電話中に「引き落としの手続きはどうなっていますか」と聞かれる。
// トラブルが多いので、4つから選ぶだけ・押した数だけで終わるようにする。
const 振替の並び = [
  { 値: '未申込', 説明: 'まだ申し込んでいない', 日: false },
  { 値: '口座振替申込', 説明: '申し込んだ日', 日: true },
  { 値: '口座振替開始', 説明: '引き落としが始まる日', 日: true },
  { 値: '口座振替停止', 説明: '引き落としを止めた', 日: false },
];

function DebitBox({ c, onClose, onDone }) {
  const [状態, set状態] = useState(c.引き落とし || '未申込');
  // 日はいつも既定で当日。前に入れた日があればそれを出す
  const [日, set日] = useState(c.引き落とし日 || 本日());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const 日が要る = 振替の並び.find((x) => x.値 === 状態).日;

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api.patchCustomer({ id: c.id, 引き落とし: 状態, 引き落とし日: 日が要る ? 日 : null });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Modal
      title="口座振替（自動引き落とし）"
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>キャンセル</button>
          <div className="right">
            <button className="btn btn-main" onClick={save} disabled={busy}>
              {busy ? '保存しています…' : '保存する'}
            </button>
          </div>
        </>
      }
    >
      <div className="dbt-pick">
        {振替の並び.map((x) => (
          <button
            key={x.値}
            className={'dbt-o' + (状態 === x.値 ? ' on' : '')}
            onClick={() => set状態(x.値)}
          >
            <b>{x.値}</b>
            <i>{x.説明}</i>
          </button>
        ))}
      </div>
      {/* 日付の欄は、スマホなら端末のホイール、パソコンなら年/月/日 の直接入力になる */}
      {日が要る && (
        <Text label={状態 === '口座振替申込' ? '申し込んだ日' : '引き落としが始まる日'}
              type="date" value={日} onChange={set日}
              hint="はじめは今日の日付が入っています" />
      )}
      <Note>
        いま：<b>{振替の文(c.引き落とし, c.引き落とし日)}</b>
        {状態 !== c.引き落とし && <> → 変更後：<b>{振替の文(状態, 日が要る ? 日 : null)}</b></>}
      </Note>
      <Err>{err}</Err>
    </Modal>
  );
}

function EditCustomer({ c, onClose, onDone }) {
  const [v, setV] = useState({
    名前: c.氏名, よみ: c.よみ, 性別: c.性別, 生年月日: c.生年月日 || '',
    住所: c.住所, 電話番号: c.電話番号, 契約日: c.契約日 || '', 車種: c.車種,
    債権譲渡会社: c.債権譲渡会社id ? String(c.債権譲渡会社id) : '',
    債権譲渡先: c.債権譲渡先id ? String(c.債権譲渡先id) : '',
    状態: c.状態 || '通常', 状態日: c.状態日 || 本日(),
    ボーナス月: c.ボーナス月 || [], ボーナス日: c.ボーナス日 || 27,
    ボーナス金額: c.ボーナス金額 || '',
    開始月: (c.開始日 || '').slice(0, 7), 支払日: c.支払日 || 27,
  });
  const [companies, setCompanies] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((o) => ({ ...o, [k]: val }));

  useEffect(() => { api.companies().then((d) => setCompanies(d.会社)).catch(() => {}); }, []);
  const opts = companies.map((x) => ({ value: String(x.id), label: x.名前 }));

  const save = async () => {
    setBusy(true); setErr('');
    try { await api.patchCustomer({ id: c.id, ...v }); onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Modal
      title="顧客情報の編集"
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>キャンセル</button>
          <div className="right">
            <button className="btn btn-main" onClick={save} disabled={busy}>
              {busy ? '保存しています…' : '保存する'}
            </button>
          </div>
        </>
      }
    >
      <div className="grid2">
        <Text label="名前" value={v.名前} onChange={set('名前')} />
        <Text label="よみ（カナ）" value={v.よみ} onChange={set('よみ')}
              placeholder="ヤマダ タロウ" hint="あいうえお順と、CSVの振込人名の照合に使います" />
      </div>
      <div className="grid3">
        <Select label="性別" value={v.性別} onChange={set('性別')} placeholder="選択しない"
                options={[{ value: '男性', label: '男性' }, { value: '女性', label: '女性' },
                          { value: 'その他', label: 'その他' }]} />
        <Text label="生年月日" type="date" value={v.生年月日} onChange={set('生年月日')} />
        <Text label="電話番号" value={v.電話番号} onChange={set('電話番号')} />
      </div>
      <Text label="住所" value={v.住所} onChange={set('住所')} />
      <div className="grid2">
        <Text label="契約日" type="date" value={v.契約日} onChange={set('契約日')} />
        <Text label="車種" value={v.車種} onChange={set('車種')} />
      </div>
      {/* 支払いの始まり。登録のときに間違えると、期日がまるごとずれる。
          期日を動かすだけで、入金の行き先は動かさない */}
      <div className="grid2">
        <Text label="支払い開始月" type="month" value={v.開始月} onChange={set('開始月')} />
        <Text label="毎月の支払日" type="number" min="1" max="31"
              value={v.支払日} onChange={(x) => set('支払日')(Number(x) || '')}
              hint="その月に無い日は末日にします" />
      </div>
      {(v.開始月 !== (c.開始日 || '').slice(0, 7) || Number(v.支払日) !== Number(c.支払日)) && (
        <Note kind="warn">
          <b>全{c.回数}回の期日が、まとめてずれます。</b>
          {v.開始月 && <> 1回目は <b>{v.開始月}-{String(v.支払日).padStart(2, '0')}</b> になります。</>}
          <br />
          <b>入金は動きません。</b>どの回にいくら入っているかはそのままで、
          期日だけを直します。金額・回数・残債も変わりません。
        </Note>
      )}

      <div className="grid2">
        <Select label="債権譲渡会社" value={v.債権譲渡会社} onChange={set('債権譲渡会社')}
                placeholder={opts.length ? '選択しない' : '設定タブで登録してください'}
                options={opts} disabled={!opts.length} />
        <Select label="債権譲渡先" value={v.債権譲渡先} onChange={set('債権譲渡先')}
                placeholder={opts.length ? '選択しない' : '設定タブで登録してください'}
                options={opts} disabled={!opts.length} />
      </div>
      {/* ボーナス払い。月は複数選べる。日と金額は共通。
          予定は追加されるだけで、通常の回には影響しない */}
      <div className="f">
        <label>ボーナス払い（払う月を押して選びます。何月でも選べます）</label>
        <div className="mon-pick">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <button
              key={m}
              className={'mon' + (v.ボーナス月.includes(m) ? ' on' : '')}
              onClick={() => set('ボーナス月')(v.ボーナス月.includes(m)
                ? v.ボーナス月.filter((x) => x !== m)
                : [...v.ボーナス月, m].sort((a, b) => a - b))}
            >{m}月</button>
          ))}
        </div>
      </div>
      {v.ボーナス月.length > 0 && (
        <>
          <div className="grid2">
            <Text label="ボーナスの支払日" type="number" min="1" max="31"
                  value={v.ボーナス日} onChange={(x) => set('ボーナス日')(Number(x) || '')}
                  hint="その月に無い日は末日にします" />
            <Money label="1回あたりのボーナス金額" value={v.ボーナス金額}
                   onChange={set('ボーナス金額')} placeholder="100,000" />
          </div>
          <Note kind="ok">
            {v.ボーナス月.join('月・')}月の{v.ボーナス日}日に
            <b> {yen(v.ボーナス金額 || 0)}円</b>。
            契約の期間（{c.開始日} 〜 全{c.回数}回）に入るぶんだけ作ります。
            <br />
            <b>すでに入金が充てられているボーナスの回は動かしません。</b>
            通常の{c.回数}回には影響しません。
          </Note>
        </>
      )}
      {v.ボーナス月.length === 0 && c.ボーナス回数 > 0 && (
        <Note kind="warn">
          月をすべて外すと、<b>ボーナス払いをやめます</b>。
          入金が入っているボーナスの回は残ります。
        </Note>
      )}

      {/* 車両を引き上げたら、督促も請求も止める。取り違えると引き上げ済みの方へ
          督促の電話をかけてしまうので、何が起きるかをその場に書いておく */}
      <div className="f">
        <label>取引の状態</label>
        <div className="dbt-pick">
          <button className={'dbt-o' + (v.状態 === '通常' ? ' on' : '')}
                  onClick={() => set('状態')('通常')}>
            <b>通常</b><i>ふだんどおり請求します</i>
          </button>
          <button className={'dbt-o taken' + (v.状態 === '回収' ? ' on' : '')}
                  onClick={() => set('状態')('回収')}>
            <b>車両を引き上げ</b><i>ここで終わり。督促も請求もしません</i>
          </button>
        </div>
      </div>
      {v.状態 === '回収' && (
        <>
          <Text label="引き上げた日" type="date" value={v.状態日} onChange={set('状態日')} />
          <Note kind="warn">
            引き上げにすると、この方は<b>未入金タブに出なくなり</b>、督促の対象から外れます。
            顧客一覧では背景が薄いグレーになり、<b>完済/引き上げタブ</b>に並びます。
            もとに戻すときは「通常」を選び直してください。
          </Note>
        </>
      )}

      <Note>
        月々の金額 {yen(c.月々の金額)}円 ／ 全{c.回数}回。
        <b>この2つはここでは変えられません。</b>
        変えると支払予定を作り直すことになり、すでに充てた入金の行き先が消えるためです。
        直す必要があるときは声をかけてください。
        <br />
        支払い開始月と毎月の支払日は、上で変えられます。
        <b>期日をずらすだけなので、入金の行き先は消えません。</b>
      </Note>
      <Err>{err}</Err>
    </Modal>
  );
}

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
                <label style={{ display: 'flex', gap: 5, alignItems: 'center',
                                fontSize: 13.5, whiteSpace: 'nowrap' }}>
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
