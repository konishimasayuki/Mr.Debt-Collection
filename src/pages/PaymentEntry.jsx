import { useEffect, useRef, useState } from 'react';
import { api, yen, ymd, jpDate, 本日 } from '../api';
import { Modal, Text, Money, Select, Picker, Err, Note, Empty, Loading } from '../components/ui';
import BankIntake from './BankIntake';

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


// ── 取り込む前の確認の表。CSVからでも銀行からでも、同じものを使う ──────
// 出所が違っても、人が見て確かめることは同じ。
// 2つ作ると、片方だけ直されて見え方が食い違う。
// 入金種類の既定。いま払えていない回の種類に合わせる。
//
// 月額の回を予定どおり払い終えている方に振り込みが来たら、それはボーナスぶんの
// 見込みが高い。既定を月額のままにすると、毎回選び直すことになり、直し忘れる。
// 手動入金登録の「払えていない分の種類」と同じ考え方。
export const 既定の入金種類 = (c) =>
  (c && c.ボーナス金額 && c.追う回の種類 === 'ボーナス') ? 'ボーナス' : '月額';

// 月額を超える振り込みで、ボーナスがまだ払われていない行。
// 月々のぶんと賞与のぶんを、まとめて1回で振り込む方がいる。
// 黙って月額の回だけに充てると、ボーナスがいつまでも未払いで残る。
export const ボーナスも聞く = (c, 金額) =>
  !!(c && c.ボーナス未払い額 > 0 && 金額 > c.月額);

// 一押しで除外に入れられる候補は、顧客が決まっていない振込人だけにする。
// お客様の名前まで並べると、押し間違えてその方の入金が
// 二度と取り込まれなくなる。お客様を外したいときは手で打ってもらう。
const 候補の振込人 = (d) => [...new Set(
  ((d && d.明細) || []).filter((r) => !r.照合できた).map((r) => r.振込人).filter(Boolean),
)].sort();

// 取り込まない振込人のリスト。
//
// 会社の口座間の振替や、手数料の戻しは、毎月のCSVに必ず出てくる。
// そのたびにチェックを外していると、いつか外し忘れて、
// お客様の入金でないものが台帳に入ってしまう。
// 一度ここに入れておけば、CSVからでも銀行からでも毎回自動で外れる。
export function 除外リスト({ 候補, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [名前, set名前] = useState('');
  const [メモ, setメモ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [触った, set触った] = useState(false);

  const load = () => api.excludes().then(setD).catch((e) => { setD({ 除外: [] }); setErr(e.message); });
  useEffect(() => { load(); }, []);

  const 足す = async (n, m) => {
    const v = String(n || '').trim();
    if (!v) { setErr('振込人名を入れてください。'); return; }
    setBusy(true); setErr('');
    try {
      await api.addExclude({ 名前: v, メモ: m || '' });
      set名前(''); setメモ(''); set触った(true);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const 外す = async (x) => {
    if (!confirm(`「${x.名前}」を除外リストから外します。\n\n`
      + '次からは、この振込人も確認の表に出るようになります。\nよろしいですか。')) return;
    setBusy(true); setErr('');
    try { await api.delExclude(x.id); set触った(true); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const 入っている = new Set((d ? d.除外 : []).map((x) => x.名前));
  const まだの候補 = (候補 || []).filter((n) => !入っている.has(n));

  return (
    <Modal
      wide
      title="取り込まない振込人"
      onClose={() => (触った ? onChanged() : onClose())}
      foot={
        <div className="right">
          <button className="btn btn-main" onClick={() => (触った ? onChanged() : onClose())}>
            {触った ? '閉じて読み直す' : '閉じる'}
          </button>
        </div>
      }
    >
      <Note>
        <b>ここに入れた振込人は、取り込みの表に出なくなります。</b>
        {' '}CSVからでも銀行からでも、<b>毎回自動で外します。</b>
        <br />
        会社の口座どうしの振替や、手数料の戻しなど、
        <b>お客様の入金ではないもの</b>を入れてください。
        <br />
        すでに取り込んだ入金は消えません。これから読むぶんに効きます。
      </Note>

      <Err>{err}</Err>

      {まだの候補.length > 0 && (
        <div className="ex-cand">
          <b>顧客が決まっていない振込人（押すと入ります）</b>
          <div>
            {まだの候補.map((n) => (
              <button key={n} className="btn btn-sm" disabled={busy}
                      onClick={() => 足す(n, '')}>＋ {n}</button>
            ))}
          </div>
        </div>
      )}

      <div className="ex-add">
        <input className="kana-in" value={名前} placeholder="振込人名（手で入れる）"
               onChange={(e) => set名前(e.target.value)} />
        <input className="kana-in" value={メモ} placeholder="覚え書き（任意）"
               onChange={(e) => setメモ(e.target.value)} />
        <button className="btn" disabled={busy || !名前.trim()}
                onClick={() => 足す(名前, メモ)}>足す</button>
      </div>

      {/* 表にすると、スマホで右の「外す」まで手が届かない。
          1件を1枚にして、狭いところでは折り返す */}
      <div className="ex-list">
        {d === null && <Loading 件数={3} 行={1} />}
        {d && d.除外.length === 0 && (
          <p className="ex-none">まだ1件も入っていません。</p>
        )}
        {d && d.除外.map((x) => (
          <div className="ex-row" key={x.id}>
            <b className="mono">{x.名前}</b>
            <span className="ex-memo">{x.メモ || ''}</span>
            <span className="ex-on">{x.入れた日}</span>
            <button className="btn btn-sm btn-danger" disabled={busy}
                    onClick={() => 外す(x)}>外す</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function 明細の表({ 明細, 顧客, keep, setKeep, assignTo, setAssignTo, 種類, set種類 }) {
  const 顧客の = {};
  顧客.forEach((c) => { 顧客の[c.id] = c; });
  // その行がいま誰のものか。人が選び直していれば、そちらが優先
  const 誰の = (r) => (assignTo[r.行] ? Number(assignTo[r.行]) : r.顧客id) || null;

  return (
    <div className="card tw meisai">
      <table>
        <thead>
          <tr>
            <th style={{ width: 44 }}>取込</th>
            <th>日付</th><th>付番</th><th className="num">金額</th><th>振込人</th>
            <th>顧客</th><th>入金種類</th><th>印</th>
          </tr>
        </thead>
        <tbody>
          {明細.map((r) => {
            const c = 顧客の[誰の(r)] || null;
            return (
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
                  <select value={assignTo[r.行] || ''} className="assign"
                          onChange={(e) => setAssignTo((o) => ({ ...o, [r.行]: e.target.value }))}>
                    <option value="">選ぶ（{r.判断}）</option>
                    {顧客.map((x) => (
                      <option key={x.id} value={x.id}>{x.氏名}{x.よみ ? `（${x.よみ}）` : ''}</option>
                    ))}
                  </select>
                )}
              </td>
              {/* どの回に充てるか。既定は月額。
                  期日の古い順に埋めるので、種類を決めないとボーナスの回
                  （金額が大きい）に食われて、台帳の金額がおかしくなる */}
              <td>
                {!c ? (
                  <span style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>顧客を選ぶと出ます</span>
                ) : !c.ボーナス金額 ? (
                  <span style={{ fontSize: 12.5 }}>月額 ¥{yen(c.月額)}-</span>
                ) : (
                  <>
                    <select value={種類[r.行] || 既定の入金種類(c)} className="assign kind"
                            onChange={(e) => set種類((o) => ({ ...o, [r.行]: e.target.value }))}>
                      <option value="月額">月額 ¥{yen(c.月額)}-</option>
                      <option value="ボーナス">ボーナス ¥{yen(c.ボーナス金額)}-</option>
                      {/* 月額を超えていて、ボーナスがまだ払われていないときだけ */}
                      {ボーナスも聞く(c, r.金額) && (
                        <option value="月額＋ボーナス">
                          月額＋ボーナス ¥{yen(c.ボーナス未払い額)}-
                        </option>
                      )}
                    </select>
                    {/* まだ分けていないときだけ聞く。分けたら消える */}
                    {ボーナスも聞く(c, r.金額)
                      && (種類[r.行] || 既定の入金種類(c)) !== '月額＋ボーナス' && (
                      <div className="kind-ask">
                        月額を超えています。ボーナス（残 {yen(c.ボーナス未払い額)}円）にも
                        割り当てますか。
                        <button type="button" className="btn btn-sm"
                                onClick={() => set種類((o) => ({ ...o, [r.行]: '月額＋ボーナス' }))}>
                          ボーナスにも割り当てる
                        </button>
                      </div>
                    )}
                  </>
                )}
              </td>
              <td>
                {r.すでに取込済み && <span className="tag t-warn">取込済み</span>}
                {!r.すでに取込済み && r.ファイル内で重複 && <span className="tag t-dup">重複</span>}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PaymentEntry({ onChanged, goHistory }) {
  const [preview, setPreview] = useState(null);   // {形式, 概要, 明細, 顧客}
  const [keep, setKeep] = useState({});           // 行番号 → 残すか
  const [assignTo, setAssignTo] = useState({});   // 行番号 → 顧客id
  const [種類, set種類] = useState({});           // 行番号 → 月額 / ボーナス
  const [除外を開く, set除外を開く] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [manual, setManual] = useState(false);
  const [乗っている, set乗っている] = useState(false);   // ファイルを持ってきている最中か
  const file = useRef(null);
  // 読み取ったファイルの中身。除外リストを直したあと、読み直すために持っておく
  const 中身 = useRef('');
  const 深さ = useRef(0);          // 中の字の上を通るたびに離れた事にならないよう数える

  const 見せる = (d) => {
    setPreview(d);
    // 取込済みの行は最初から外しておく（残したければ人が戻せる）
    const k = {};
    d.明細.forEach((r) => { k[r.行] = !r.すでに取込済み; });
    setKeep(k);
    setAssignTo({}); set種類({});
  };

  const 読み取る = async (f) => {
    if (!f) return;
    setErr(''); setResult(null); setBusy(true);
    try {
      const text = await readText(f);
      中身.current = text;
      見せる(await api.preview(text));
      set除外を開く(false);
    } catch (e2) { setErr(e2.message); setPreview(null); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  };

  // 除外リストを直したあと、同じファイルをもう一度読む。
  // 外した振込人がその場で表から消えないと、直したかどうか分からない
  const 読み直す = async () => {
    if (!中身.current) return;
    setBusy(true); setErr('');
    try { 見せる(await api.preview(中身.current)); }
    catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  const pick = (e) => 読み取る(e.target.files && e.target.files[0]);

  // 表計算のファイルや画像を落とされることがある。読めないものは、その場で断る。
  // 銀行のCSVは .txt や拡張子なしで来ることもあるので、そこは通す
  const 読めない = (f) => {
    const 名 = (f.name || '').toLowerCase();
    if (/\.(xlsx?|numbers|pdf|docx?|zip)$/.test(名)) {
      return `${f.name} はCSVではありません。銀行の画面から、CSV形式で落としてください。`;
    }
    if ((f.type || '').startsWith('image/')) {
      return '画像は取り込めません。銀行のCSVファイルを落としてください。';
    }
    return '';
  };

  const 放した = (e) => {
    e.preventDefault();
    深さ.current = 0; set乗っている(false);
    const fs = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (!fs.length) return;
    if (fs.length > 1) {
      setErr('ファイルは1つずつ入れてください。'); return;
    }
    const だめ = 読めない(fs[0]);
    if (だめ) { setErr(だめ); return; }
    読み取る(fs[0]);
  };

  // 受け口の外に落としたときは、ブラウザがそのファイルを開いてしまい、
  // 画面が丸ごと入れ替わって作業中のものが消える。それを止める
  useEffect(() => {
    const 止める = (e) => {
      if (e.target && e.target.closest && e.target.closest('.drop')) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', 止める);
    window.addEventListener('drop', 止める);
    return () => {
      window.removeEventListener('dragover', 止める);
      window.removeEventListener('drop', 止める);
    };
  }, []);

  const commit = async () => {
    const rows = preview.明細
      .filter((r) => keep[r.行])
      .map((r) => {
        const cid = assignTo[r.行] ? Number(assignTo[r.行]) : r.顧客id;
        const c = preview.顧客.find((x) => x.id === cid) || null;
        return { ...r, 顧客id: cid, 入金種類: 種類[r.行] || 既定の入金種類(c) };
      });
    if (!rows.length) { setErr('取り込む行がありません。'); return; }
    setBusy(true); setErr('');
    try {
      const d = await api.commit(rows);
      setResult(d); setPreview(null);
      onChanged && onChanged();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  // 月額を超えていて、ボーナスがまだ払われていない行の数。上の注意書きに出す
  const 聞く数 = preview
    ? preview.明細.filter((r) => {
      const cid = assignTo[r.行] ? Number(assignTo[r.行]) : r.顧客id;
      return ボーナスも聞く(preview.顧客.find((x) => x.id === cid), r.金額);
    }).length
    : 0;

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
        {/* ファイルを放しても、押しても、同じことが起きる。
            スマホには放す操作が無いので、押せることは必ず残す */}
        <button
          type="button"
          className={'drop' + (乗っている ? ' over' : '') + (busy && !preview ? ' busy' : '')}
          onClick={() => file.current.click()}
          disabled={busy}
          onDragEnter={(e) => { e.preventDefault(); 深さ.current++; set乗っている(true); }}
          onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
          onDragLeave={() => { 深さ.current--; if (深さ.current <= 0) set乗っている(false); }}
          onDrop={放した}
        >
          <b>
            {busy && !preview ? '読み取っています…'
              : 乗っている ? 'ここで放してください'
              : (
                <>
                  {/* 指で触る端末には放す操作が無い。同じ言い方をすると迷わせる */}
                  <span className="pc-only">CSVファイルをここに放すか、押して選んでください</span>
                  <span className="sp-only">押してCSVファイルを選んでください</span>
                </>
              )}
          </b>
          <i>選んでも、すぐには取り込みません。中身を確かめてからです</i>
        </button>
        <p style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 0 }}>
          日付・付番・金額が重なる行には印を付けます。すでに取り込んだ行は、最初から外します。
        </p>
      </div>

      {!preview && <Err>{err}</Err>}

      {result && <ImportResult d={result} onClose={() => setResult(null)}
                               onChanged={onChanged} goHistory={goHistory} />}

      {/* 取り込む前の確認は、画面いっぱいのモーダルで出す。
          50件のCSVを狭い枠の中で少しずつ送りながら確かめるのは、目が疲れて見落とす */}
      {preview && (
        <Modal
          huge
          title={`取り込む前の確認（${preview.形式}）`}
          onClose={() => setPreview(null)}
          foot={
            <>
              <button className="btn" onClick={() => setPreview(null)} disabled={busy}>
                キャンセル
              </button>
              <div className="right">
                <button className="btn btn-main" onClick={commit} disabled={busy || !残す数}>
                  {busy ? '取り込んでいます…' : `${残す数}件を取り込む（${yen(残す額)}円）`}
                </button>
              </div>
            </>
          }
        >
          <Note>
            <b>取り込みたくない行は、左のチェックを外してください。</b>
            {' '}チェックの付いた行だけが入金になります。
            <br />
            <b>入金種類は、いま払えていない回に合わせてあります。</b>{' '}
            月額を予定どおり払い終えている方は<b>「ボーナス」</b>から始まります。
            違っていたら、その行で選び直してください。
            {聞く数 > 0 && (
              <>
                <br />
                <b style={{ color: 'var(--overdue)' }}>
                  {聞く数}件は、月額を超える振り込みで、ボーナスがまだ払われていません。
                </b>
                {' '}ボーナスにも割り当てるかを、その行で選んでください。
                選ばなければ、月額の回にだけ充てます。
              </>
            )}
            <br />
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

          {/* 取り込まないと決めた振込人は、黙って落とさずに件数を出す */}
          {preview.除いた && preview.除いた.件数 > 0 && (
            <Note>
              <b>{preview.除いた.件数}行は、除外リストにある振込人なので外しました。</b>{' '}
              {preview.除いた.振込人.join('、')}
            </Note>
          )}

          <div className="row-btn" style={{ marginBottom: 10 }}>
            <button className="btn btn-sm" onClick={() => set除外を開く(true)}>
              除外リストを確認・編集
            </button>
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
              入れておくと、次からは毎回この振込人を自動で外します
            </span>
          </div>

          <Err>{err}</Err>
          <明細の表 明細={preview.明細} 顧客={preview.顧客}
                    keep={keep} setKeep={setKeep}
                    assignTo={assignTo} setAssignTo={setAssignTo}
                    種類={種類} set種類={set種類} />
        </Modal>
      )}

      {除外を開く && (
        <除外リスト
          候補={候補の振込人(preview)}
          onClose={() => set除外を開く(false)}
          onChanged={() => { set除外を開く(false); 読み直す(); }}
        />
      )}

      {/* ── 中：銀行から取り込む ── */}
      <BankIntake onChanged={onChanged} />

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

      <余りの知らせ 余った={d.余った} />

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


// ── 月額の回に充てきれなかった入金の知らせ ──────────────
// 自動で取り込んだ入金は、月額の回にしか充てない。
// ボーナスの回が残っている方でお金が余ったら、それはボーナス分の可能性が高い。
// 黙って余らせると、残債が減っていないことに誰も気づかない。
function 余りの知らせ({ 余った }) {
  const 一覧 = 余った || [];
  if (!一覧.length) return null;
  const ボ = 一覧.filter((x) => x.ボーナスが残っている);
  return (
    <Note kind="warn">
      <b>{一覧.length}件は、選んだ種類の回に充てきれませんでした。</b>
      {' '}余ったお金は、まだどの回にも充てていません（残債は減っていません）。
      {ボ.length > 0 && (
        <>
          <br />
          このうち <b>{ボ.length}件</b>は、ボーナスの回が残っている方です。
          <b>ボーナス分の可能性があります。</b>
          {' '}入金履歴からその入金を開き、<b>入金種類を「ボーナス」</b>に直してください。
        </>
      )}
      <ul className="amari">
        {一覧.map((x) => (
          <li key={x.入金id}>
            {ymd(x.日付)}　{x.顧客名 || x.振込人 || '（名前なし）'}　
            {yen(x.金額)}円 のうち <b>{yen(x.余り)}円</b> が余り
            {x.種類 && <span className="tag t-csv">{x.種類}で充当</span>}
            {x.ボーナスが残っている && <span className="tag t-bonus">ボーナス残あり</span>}
          </li>
        ))}
      </ul>
    </Note>
  );
}

// ── 手動入金 ────────────────────────────────
// 未入金タブからも開くので、名前を付けて外へ出す。
// 初期顧客id を渡すと、その方が選ばれた状態で開く（未入金から来たとき）。
export function ManualPayment({ onClose, onDone, 初期顧客id, 初期種類 }) {
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
    // 未入金のボーナスの行から開いたときは、その行の種類をそのまま使う。
    // 「ボーナスの行を押したのに月額が入っている」では、選び直させることになる
    const 行から = 初期種類 === 'ボーナス' || 初期種類 === '月額' ? 初期種類 : '';
    const 既定 = 相手.ボーナス回数 > 0
      ? (行から || (相手.回の種類 === 'ボーナス' ? 'ボーナス' : '月額')) : '';
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
