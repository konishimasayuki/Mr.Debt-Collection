import { useEffect, useRef, useState } from 'react';
import { api, yen, ymd, jpDate, 本日 } from '../api';
import { Modal, Text, Money, Select, Picker, Err, Note, Empty } from '../components/ui';

// CSVは銀行によって Shift-JIS のことも UTF-8 のこともある。
//
// 先に UTF-8 で読んでみて、化けが無ければ UTF-8 と決める。
// UTF-8 はバイトの並びに決まりがあり、そうでないものを入れると必ず化ける。
// 逆に Shift-JIS はどんなバイトでもだいたい何かの字として読めてしまうので、
// 「化けの少ないほう」で選ぶと、UTF-8 のファイルを Shift-JIS と取り違える。
// 取り違えると見出しの日本語が壊れ、列を見つけられずに位置で読むことになり、
// 列の並びが違うファイルでは中身がまるごとずれる。
async function readText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const 読む = (enc) => {
    try {
      const t = new TextDecoder(enc, { fatal: false }).decode(buf);
      return { t, 化け: (t.match(/�/g) || []).length };
    } catch { return null; }
  };
  const u = 読む('utf-8');
  if (u && u.化け === 0) return u.t;
  const s = 読む('shift_jis');
  if (!u && !s) throw new Error('ファイルを文字として読めませんでした。');
  if (!s) return u.t;
  if (!u) return s.t;
  return s.化け <= u.化け ? s.t : u.t;
}

export default function PaymentEntry({ onChanged, goHistory }) {
  const [preview, setPreview] = useState(null);   // {形式, 概要, 明細, 顧客}
  const [keep, setKeep] = useState({});           // 行番号 → 残すか
  const [assignTo, setAssignTo] = useState({});   // 行番号 → 顧客id
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [manual, setManual] = useState(false);
  const file = useRef(null);

  const pick = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setErr(''); setResult(null); setBusy(true);
    try {
      const text = await readText(f);
      const d = await api.preview(text);
      setPreview(d);
      // 取込済みの行は最初から外しておく（残したければ人が戻せる）
      const k = {};
      d.明細.forEach((r) => { k[r.行] = !r.すでに取込済み; });
      setKeep(k);
      setAssignTo({});
    } catch (e2) { setErr(e2.message); setPreview(null); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  };

  const commit = async () => {
    const rows = preview.明細
      .filter((r) => keep[r.行])
      .map((r) => ({ ...r, 顧客id: assignTo[r.行] ? Number(assignTo[r.行]) : r.顧客id }));
    if (!rows.length) { setErr('取り込む行がありません。'); return; }
    setBusy(true); setErr('');
    try {
      const d = await api.commit(rows);
      setResult(d); setPreview(null);
      onChanged && onChanged();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const 残す数 = preview ? preview.明細.filter((r) => keep[r.行]).length : 0;
  const 残す額 = preview
    ? preview.明細.filter((r) => keep[r.行]).reduce((s, r) => s + r.金額, 0) : 0;

  return (
    <>
      <div className="bar">
        <h2>入金登録</h2>
        <span className="sub">銀行のCSVから取り込むか、手で1件ずつ入れます</span>
      </div>

      {/* ── 上：CSV取り込み ── */}
      <div className="sec">
        <h3>CSVから取り込む</h3>
        <input ref={file} type="file" accept=".csv,.txt,text/csv,text/plain"
               onChange={pick} style={{ display: 'none' }} />
        <button className="btn btn-main" onClick={() => file.current.click()} disabled={busy}>
          {busy && !preview ? '読み取っています…' : 'CSVファイルを選ぶ'}
        </button>
        <p style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 0 }}>
          選ぶと、取り込む前に中身を確かめられます。日付・付番・金額が重なる行には印を付けます。
        </p>
      </div>

      <Err>{err}</Err>

      {result && <ImportResult d={result} onClose={() => setResult(null)}
                               onChanged={onChanged} goHistory={goHistory} />}

      {preview && (
        <div className="sec">
          <h3>取り込む前の確認（{preview.形式}）</h3>
          <Note>
            {preview.概要.件数}件・合計 {yen(preview.概要.合計)}円。
            照合できた {preview.概要.照合できた}件、
            照合できない {preview.概要.照合できない}件。
            {preview.概要.ファイル内で重複 > 0 && <> ファイル内で重複 <b>{preview.概要.ファイル内で重複}件</b>。</>}
            {preview.概要.すでに取込済み > 0 && <> すでに取込済み <b>{preview.概要.すでに取込済み}件</b>（最初から外してあります）。</>}
            {preview.概要.ファイル検算 === false && (
              <><br /><b style={{ color: 'var(--overdue)' }}>
                ファイルの合計と明細の合計が一致しません。一部しか読めていない可能性があります。
              </b></>
            )}
          </Note>

          {/* 読めなかった行は必ず見せる。黙って落とすと、
              入っていない入金を未入金として督促してしまう */}
          {preview.読み飛ばし && preview.読み飛ばし.件数 > 0 && (
            <Note kind="warn">
              <b>{preview.読み飛ばし.件数}行は取り込みません。</b>{' '}
              {preview.読み飛ばし.内訳.map((x) => `${x.理由}（${x.件数}行）`).join('、')}。
              <br />
              出金や訂正の行なら、そのままで構いません。
              入金のはずの行が入っていたら、ファイルの列の並びをお確かめください。
              <details style={{ marginTop: 6 }}>
                <summary>読み飛ばした行を見る</summary>
                <table className="skip-tbl">
                  <tbody>
                    {preview.読み飛ばし.明細.map((x, i) => (
                      <tr key={i}>
                        <td className="num">{x.行}行目</td>
                        <td>{x.理由}</td>
                        <td className="mono">{x.中身}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.読み飛ばし.件数 > preview.読み飛ばし.明細.length && (
                  <p style={{ margin: '6px 0 0' }}>
                    ほか {preview.読み飛ばし.件数 - preview.読み飛ばし.明細.length}行。
                  </p>
                )}
              </details>
            </Note>
          )}

          <div className="card tw" style={{ maxHeight: 460, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 44 }}>取込</th>
                  <th>日付</th><th>付番</th><th className="num">金額</th><th>振込人</th>
                  <th>顧客</th><th>印</th>
                </tr>
              </thead>
              <tbody>
                {preview.明細.map((r) => (
                  <tr key={r.行} className={[
                    keep[r.行] ? '' : 'off',
                    r.すでに取込済み ? 'dupdone' : r.ファイル内で重複 ? 'dup' : '',
                  ].filter(Boolean).join(' ')}>
                    <td>
                      <input type="checkbox" checked={!!keep[r.行]}
                             onChange={(e) => setKeep((o) => ({ ...o, [r.行]: e.target.checked }))} />
                    </td>
                    <td>{ymd(r.日付)}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{r.付番 || '—'}</td>
                    <td className="num">{yen(r.金額)}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{r.振込人 || '—'}</td>
                    <td>
                      {r.照合できた ? (
                        <>{r.顧客名}<span style={{ color: 'var(--ink-3)', fontSize: 12, marginLeft: 6 }}>{r.判断}</span></>
                      ) : (
                        <select value={assignTo[r.行] || ''} style={{ maxWidth: 220, padding: '4px 6px' }}
                                onChange={(e) => setAssignTo((o) => ({ ...o, [r.行]: e.target.value }))}>
                          <option value="">選ぶ（{r.判断}）</option>
                          {preview.顧客.map((c) => (
                            <option key={c.id} value={c.id}>{c.氏名}{c.よみ ? `（${c.よみ}）` : ''}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      {r.すでに取込済み && <span className="tag t-warn">取込済み</span>}
                      {!r.すでに取込済み && r.ファイル内で重複 && <span className="tag t-dup">重複</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-main" onClick={commit} disabled={busy || !残す数}>
              {busy ? '取り込んでいます…' : `${残す数}件を取り込む（${yen(残す額)}円）`}
            </button>
            <button className="btn" onClick={() => setPreview(null)} disabled={busy}>キャンセル</button>
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
              取り込みたくない行は、左のチェックを外してください。
            </span>
          </div>
        </div>
      )}

      {/* ── 下：手動入金登録 ── */}
      <div className="sec">
        <h3>手で入金を登録する</h3>
        <button className="btn btn-main" onClick={() => setManual(true)}>手動入金登録</button>
        <p style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 0 }}>
          現金で受け取ったときや、CSVに出てこない入金のときに使います。
          手で入れた入金は、履歴で色を変えて表示します。
        </p>
      </div>

      {manual && (
        <ManualPayment
          onClose={() => setManual(false)}
          onDone={() => { setManual(false); onChanged && onChanged(); }}
        />
      )}
    </>
  );
}

// ── 取り込んだあとの知らせ。照合できなかった分はここで割り当てる ────
function ImportResult({ d, onClose, onChanged, goHistory }) {
  const [rest, setRest] = useState(d.照合できなかった明細 || []);
  const [customers, setCustomers] = useState([]);
  const [pick, setPick] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (rest.length) api.customers().then((x) => setCustomers(x.顧客)).catch(() => {});
  }, [rest.length]);

  const assign = async (row) => {
    const cid = pick[row.入金id];
    if (!cid) { setErr('どの顧客かを選んでください。'); return; }
    setBusy(true); setErr('');
    try {
      await api.assign({ 入金id: row.入金id, 顧客id: Number(cid), 日付: row.日付,
                         金額: row.金額, 付番: row.付番, 振込人: row.振込人 });
      setRest((o) => o.filter((x) => x.入金id !== row.入金id));
      onChanged && onChanged();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="sec" style={{ borderColor: 'var(--paid)' }}>
      <h3 style={{ display: 'flex', alignItems: 'center' }}>
        取り込みました
        <span style={{ marginLeft: 'auto' }}>
          <button className="btn btn-sm" onClick={onClose}>閉じる</button>
        </span>
      </h3>
      <Note kind="ok">
        {d.取り込んだ件数}件を登録しました。
        {d.見送った件数 > 0 && ` ${d.見送った件数}件は見送りました（すでに取り込み済みなど）。`}
        {d.照合できなかった件数 > 0 && ` ${d.照合できなかった件数}件は、まだどの顧客か決まっていません。`}
      </Note>

      {rest.length > 0 && (
        <>
          <h4 style={{ fontSize: 13.5, margin: '14px 0 8px' }}>
            照合できなかった入金（{rest.length}件）— 顧客を選んで割り当ててください
          </h4>
          <div className="card tw">
            <table>
              <thead>
                <tr><th>日付</th><th className="num">金額</th><th>振込人</th><th>理由</th>
                  <th>顧客を選ぶ</th><th /></tr>
              </thead>
              <tbody>
                {rest.map((r) => (
                  <tr key={r.入金id}>
                    <td>{ymd(r.日付)}</td>
                    <td className="num">{yen(r.金額)}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{r.振込人 || '—'}</td>
                    <td style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{r.理由}</td>
                    <td>
                      <select value={pick[r.入金id] || ''} style={{ maxWidth: 240, padding: '4px 6px' }}
                              onChange={(e) => setPick((o) => ({ ...o, [r.入金id]: e.target.value }))}>
                        <option value="">選んでください</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>{c.氏名}{c.よみ ? `（${c.よみ}）` : ''}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-main" onClick={() => assign(r)} disabled={busy}>
                        割り当てる
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Err>{err}</Err>
        </>
      )}

      {rest.length === 0 && d.取り込んだ件数 > 0 && (
        <button className="btn" onClick={() => goHistory('')}>入金履歴で確かめる →</button>
      )}
    </div>
  );
}

// ── 手動入金 ────────────────────────────────
// 未入金タブからも開くので、名前を付けて外へ出す。
// 初期顧客id を渡すと、その方が選ばれた状態で開く（未入金から来たとき）。
export function ManualPayment({ onClose, onDone, 初期顧客id }) {
  const [customers, setCustomers] = useState([]);
  const [v, setV] = useState({ 日付: 本日(), 顧客id: 初期顧客id ? String(初期顧客id) : '',
    金額: '', 入金方法: '振込', 入金種類: '', メモ: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((o) => ({ ...o, [k]: val }));

  // 控えではなく、いまの中身を取り直す。
  // 入金種類の既定は「いま払えていない回の種類」で決めるため、
  // 少し前の一覧だと1回ぶんずれて、ボーナスの入金が月額の回へ入ってしまう
  useEffect(() => { api.customersNow().then((d) => setCustomers(d.顧客)).catch(() => {}); }, []);

  // 選ばれている方
  const 相手 = customers.find((x) => String(x.id) === String(v.顧客id)) || null;
  // 入金種類を選べるのは、ボーナス払いの設定がある方だけ
  const 種類を選ぶ = !!(相手 && 相手.ボーナス回数 > 0);

  // 名前を選んだら、いま払えていない回の種類を最初に入れておく。
  // 遅れている分から順に埋めるのが普通なので、たいていはこのままでよい
  useEffect(() => {
    if (!相手) { if (v.入金種類) set('入金種類')(''); return; }
    const 既定 = 相手.ボーナス回数 > 0
      ? (相手.回の種類 === 'ボーナス' ? 'ボーナス' : '月額') : '';
    set('入金種類')(既定);
    // 相手が変わったときだけ入れ直す（人が選び直したものは触らない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.顧客id, customers.length]);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const d = await api.addPayment(種類を選ぶ ? v : { ...v, 入金種類: '' });
      const c = customers.find((x) => String(x.id) === String(v.顧客id));
      alert(`${c ? c.氏名 + 'さんの' : ''}入金 ${yen(v.金額)}円 を登録しました。`
        + (d.充当.length ? `\n${d.充当.map((x) => `${x.種類 === 'ボーナス' ? '賞与' : ''}${x.no}回目へ ${yen(x.充てた)}円`).join('\n')}` : '')
        + (d.余り ? `\n余り ${yen(d.余り)}円（充てる予定がありません）` : ''));
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title="手動入金登録"
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>キャンセル</button>
          <div className="right">
            <button className="btn btn-main" onClick={submit} disabled={busy}>
              {busy ? '登録しています…' : '登録する'}
            </button>
          </div>
        </>
      }
    >
      <div className="grid2">
        <Text label="日付" type="date" value={v.日付} onChange={set('日付')} />
        <Money label="金額" value={v.金額} onChange={set('金額')} />
      </div>
      <Picker label="名前" value={v.顧客id} onChange={set('顧客id')}
              placeholder="名前を打つと候補が出ます（かな・カナ・漢字・英字）"
              items={customers.map((c) => ({
                id: c.id, 名前: c.氏名, よみ: c.よみ, 脇: `月々 ${yen(c.金額)}円`,
              }))} />
      <Select label="入金方法" value={v.入金方法} onChange={set('入金方法')}
              options={[{ value: '振込', label: '振り込み' }, { value: '現金', label: '現金' },
                        { value: 'その他', label: 'その他' }]} />
      {/* 入金種類は、ボーナス払いの設定がある方にだけ出す。
          設定が無い方に出しても選びようがなく、迷わせるだけ */}
      {種類を選ぶ && (
        <Select label="入金種類" value={v.入金種類} onChange={set('入金種類')}
                options={[{ value: '月額', label: '月額' },
                          { value: 'ボーナス', label: 'ボーナス' }]}
                hint={`払えていない分（${相手.回の種類 === 'ボーナス' ? 'ボーナス' : '月額'}）を入れてあります。`
                  + 'ボーナスを選ぶと、ボーナスの回にだけ充てます。'} />
      )}
      <Text label="メモ（手動入金の理由）" value={v.メモ} onChange={set('メモ')}
            placeholder="現金で受け取った、CSVに出てこない振込 など"
            hint="あとから見て理由が分かるように、必ず書いてください" />
      <Err>{err}</Err>
    </Modal>
  );
}
