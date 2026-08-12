import { useCallback, useEffect, useState } from 'react';
import { api, yen, ymd, md } from '../api';
import { Modal, Text, Err, Empty, Note, Loading } from '../components/ui';
import { ManualPayment } from './PaymentEntry';

// 入金の割り当て直し。
//
// 「月額のつもりの入金がボーナスに入っている」「その逆」を、
// 電話中にその場で直せるようにする。入金履歴まで行かなくて済む。
// 直したあとは、その顧客のお金を古い回から順に詰め直す。
function 割り当て直し({ 顧客, onClose, onDone }) {
  const [d, setD] = useState(null);
  const [選び, set選び] = useState({});      // 入金id → 月額 / ボーナス
  const [メモ, setメモ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.customer(顧客.id).then(setD).catch((e) => setErr(e.message));
  }, [顧客.id]);

  const いま = (p) => (選び[p.id] !== undefined ? 選び[p.id] : p.入金種類);
  const 変えた = d ? d.入金.filter((p) => いま(p) !== p.入金種類) : [];

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.reassign(顧客.id,
        変えた.map((p) => ({ 入金id: p.id, 入金種類: いま(p) })), メモ);
      alert(`${r.変えた件数}件の割り当てを直しました。`);
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Modal
      wide
      title={`${顧客.氏名} さんの入金の割り当て直し`}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>キャンセル</button>
          <div className="right">
            <button className="btn btn-main" onClick={save} disabled={busy || !変えた.length}>
              {busy ? '直しています…' : `${変えた.length}件を直す`}
            </button>
          </div>
        </>
      }
    >
      <Note>
        <b>月額のつもりの入金がボーナスに入っていたときに、ここで直せます。</b>
        {' '}その逆も直せます。
        <br />
        <b>入金の金額・件数・残債は変わりません。</b>どの回に充てるかだけが変わります。
        直したあとは、古い回から順に詰め直します。
      </Note>
      <Err>{err}</Err>

      {d === null && <Loading 件数={3} 行={1} />}
      {d && d.入金.length === 0 && <Empty>まだ入金がありません。</Empty>}

      {d && d.入金.length > 0 && (
        <div className="ex-list">
          {d.入金.map((p) => (
            <div className="ex-row" key={p.id}>
              <b>{ymd(p.日付)}</b>
              <span className="ex-on">{yen(p.金額)}円</span>
              <span className="ex-memo">{p.振込人 || p.メモ || p.区分}</span>
              <select className="assign kind" value={いま(p)}
                      onChange={(e) => set選び((o) => ({ ...o, [p.id]: e.target.value }))}>
                <option value="月額">月額</option>
                <option value="ボーナス">ボーナス</option>
              </select>
              {いま(p) !== p.入金種類 && <span className="tag t-done">直した</span>}
            </div>
          ))}
        </div>
      )}

      {変えた.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text label="直した理由（任意）" value={メモ} onChange={setメモ}
                placeholder="例：本人に確認したところ賞与分だった"
                hint="記録に残ります" />
        </div>
      )}
    </Modal>
  );
}

export default function Unpaid({ onOpen, onChanged }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [入金する, set入金する] = useState(null);   // 手動入金を入れる顧客
  const [割り当て, set割り当て] = useState(null);   // 入金の種類を直す顧客
  const [busy, setBusy] = useState(0);              // 督促を書き込んでいる顧客id
  const [戻すか, set戻すか] = useState(null);       // 取り消した督促がある行（聞き直す）

  const load = useCallback(() => {
    api.customers({ 未入金: 1 })
      .then((d) => setRows(d.顧客))
      .catch((e) => { setRows([]); setErr(e.message); });
  }, []);
  useEffect(load, [load]);

  // 督促の連絡をしたかを控える。電話を切った直後にその場で押せるよう、
  // 名前の横の印そのものを押せるようにしてある（ボタンを増やさない）。
  const 送る = async (r, 中身) => {
    setBusy(r.id); setErr('');
    try {
      await api.postCustomer({ id: r.id, 回次: r.回次, 回の種類: r.回の種類, ...中身 });
      load(); onChanged && onChanged();
    } catch (e) { setErr(e.message); }
    finally { setBusy(0); set戻すか(null); }
  };

  const 督促 = async (r, 取り消す) => {
    // 取り消した督促が残っているときは、はい・いいえでは足りない。
    // 「押し間違いを元に戻す」のか「今日あらためて電話した」のかを選んでもらう
    if (!取り消す && r.取り消した督促) { set戻すか(r); return; }
    const 文 = 取り消す
      ? `${r.氏名}さんの督促の記録を取り消します。\n\n`
        + '押し間違えたときは、もう一度押せば元に戻せます。\nよろしいですか。'
      : `${r.氏名}さんに督促の連絡をした、として記録します。よろしいですか。`;
    if (!confirm(文)) return;
    await 送る(r, { 種類: 取り消す ? '督促取消' : '督促' });
  };

  // 合計には、動作を試すための顧客を入れない。
  // 経営者が見る数字なので、試し打ちの金額が混ざってはいけない。
  const 本物 = (rows || []).filter((r) => !r.テスト);
  const テスト数 = (rows || []).length - 本物.length;
  const 合計 = 本物.reduce((s, r) => s + r.この回の残り, 0);
  const 未督促 = 本物.filter((r) => !r.督促回数).length;
  // 行は「人 × 種類」。同じ人が月額とボーナスで2行に並ぶので、人数は名寄せして数える
  const 人数 = new Set(本物.map((r) => r.id)).size;

  return (
    <>
      <div className="bar">
        <h2>未入金</h2>
        {rows && (
          <span className="sub">
            {人数}名{本物.length > 人数 && `（${本物.length}件）`}
            {' '}／ 今の回の未入金 合計 {yen(合計)}円
            {未督促 > 0 && ` ／ 未督促 ${未督促}件`}
          </span>
        )}
      </div>

      <Note>
        支払期日までに入金できていない顧客を、あいうえお順で出しています。
        <b>行を押すと顧客ページが開きます。</b>
        名前の横の <span className="tag t-warn">未督促</span> を押すと、
        督促の連絡をしたことを控えられます。
        ボーナス払いの方は、<span className="tag t-mon">月額</span> と{' '}
        <span className="tag t-bonus">ボーナス</span> を<b>別の行</b>に分けています。
        期日も金額も別なので、同じ名前が縦に2行並ぶことがあります。
        {テスト数 > 0 && (
          <> なお、<span className="tag t-test">テスト</span> の
          {テスト数}名は上の人数と合計に入れていません。</>
        )}
      </Note>
      <Err>{err}</Err>

      <div className="card tw cards unpaid-cards">
        <table>
          <thead>
            <tr>
              <th>顧客名</th>
              <th>支払い期日</th>
              <th className="num">支払済回数</th>
              <th className="num">金額</th>
              <th className="num">支払日</th>
              <th className="num">残債</th>
              <th className="num">残回数</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={8}><Loading 件数={3} /></td></tr>}
            {rows && rows.length === 0 && (
              <tr><td colSpan={8}><Empty>
                期日を過ぎて未入金の顧客はいません。
              </Empty></td></tr>
            )}
            {rows && rows.map((r) => (
              <tr key={`${r.id}-${r.回の種類}`}
                  className={'clickable' + (r.テスト ? ' test-row' : '')}
                  onClick={() => onOpen(r.id)}>
                <td className="nm">
                  <b>{r.氏名}</b>
                  {r.テスト && <span className="tag t-test">テスト</span>}
                  {/* ボーナス払いのある方だけ、どちらの行かを出す。
                      金額が大きいので、月額と同じ扱いで電話すると話が食い違う。
                      ボーナスの無い方に「月額」と付けても、意味がなく目障りになる */}
                  {r.ボーナス回数 > 0 && (
                    <span className={'tag ' + (r.種類 === 'ボーナス' ? 't-bonus' : 't-mon')}>
                      {r.種類}
                    </span>
                  )}
                  {r.よみ && <span className="yomi">{r.よみ}</span>}
                  <span className="tag t-late" style={{ marginLeft: 8 }}>{r.遅れ日数}日 遅れ</span>
                  {/* 督促したかどうか。押すと控えられる */}
                  <button
                    type="button"
                    className={'tag tag-btn ' + (r.督促回数 ? 't-done' : 't-warn')}
                    disabled={busy === r.id}
                    onClick={(e) => { e.stopPropagation(); 督促(r, !!r.督促回数); }}
                  >
                    {r.督促回数
                      ? `督促 ${md(r.督促日)}${r.督促回数 > 1 ? `（${r.督促回数}回）` : ''}`
                      : r.取り消した督促
                        ? `未督促（${md(r.取り消した督促.日)}を取消）`
                        : '未督促'}
                  </button>
                  {/* いつ払うと言ったか。日を過ぎていれば朱色 */}
                  {r.約束 && (
                    <span className={'tag ' + (r.約束.切れ ? 't-late' : 't-dup')}>
                      約束 {md(r.約束.日)}
                      {r.約束.時刻 ? ` ${r.約束.時刻}` : ''}
                      {r.約束.件数 > 1 ? `（${r.約束.件数}件）` : ''}
                      {r.約束.切れ ? ' 超過' : ''}
                    </span>
                  )}
                  {r.この回の残り !== r.金額 && (
                    <span className="tag t-dup">残り {yen(r.この回の残り)}円</span>
                  )}
                </td>
                <td data-label="支払い期日">{ymd(r.支払い期日)}</td>
                <td className="num" data-label="支払済回数">{r.支払い回数}回</td>
                <td className="num" data-label="金額">{yen(r.金額)}</td>
                <td className="num" data-label="支払日">{r.毎月の支払日}日</td>
                <td className="num" data-label="残債">{yen(r.残債金額)}</td>
                <td className="num" data-label="残回数">{r.残り支払い回数}回</td>
                <td className="act">
                  {/* 電話中にその場で入金を入れられるように。
                      入金登録タブへ行って名前を探し直さなくて済む */}
                  <button
                    className="btn btn-sm btn-main"
                    onClick={(e) => { e.stopPropagation(); set入金する(r); }}
                  >手動入金登録</button>
                  {/* 月額に入るはずの入金がボーナスに入っていた、という取り違えを
                      電話中にその場で直せるように。入金履歴まで行かなくて済む */}
                  {r.ボーナス回数 > 0 && (
                    <button
                      className="btn btn-sm"
                      onClick={(e) => { e.stopPropagation(); set割り当て(r); }}
                    >割り当て直し</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {戻すか && (
        <Modal
          title="督促の記録が取り消してあります"
          onClose={() => set戻すか(null)}
          foot={
            <>
              <button className="btn" onClick={() => set戻すか(null)}>やめる</button>
              <div className="right" style={{ display: 'flex', gap: 8 }}>
                <button className="btn"
                        disabled={busy === 戻すか.id}
                        onClick={() => 送る(戻すか, { 種類: '督促' })}>
                  今日、あらためて連絡した
                </button>
                <button className="btn btn-main"
                        disabled={busy === 戻すか.id}
                        onClick={() => 送る(戻すか, { 種類: '督促', 元に戻す: true })}>
                  取り消す前に戻す
                </button>
              </div>
            </>
          }
        >
          <p style={{ margin: '2px 0 10px' }}>
            <b>{戻すか.氏名}</b> さんの{戻すか.回次}回目
            {戻すか.回の種類 === 'ボーナス' ? '（ボーナス）' : ''}ぶんの督促は、
            <br />
            <b>{ymd(戻すか.取り消した督促.日)}</b> に
            {戻すか.取り消した督促.回数 > 1 && <>（{戻すか.取り消した督促.回数}回目まで）</>}
            連絡したことが記録されていて、そのあと<b>取り消してあります。</b>
          </p>
          <Note>
            <b>押し間違えて取り消してしまったのなら、「取り消す前に戻す」</b>を押してください。
            日付も回数も、取り消す前のままに戻ります。
            <br />
            <b>取り消したのは正しくて、今日あらためて電話したのなら、</b>
            「今日、あらためて連絡した」を押してください。
            今日の日付で、1回目から数え直します。
          </Note>
        </Modal>
      )}

      {割り当て && (
        <割り当て直し
          顧客={割り当て}
          onClose={() => set割り当て(null)}
          onDone={() => { set割り当て(null); load(); onChanged && onChanged(); }}
        />
      )}

      {入金する && (
        <ManualPayment
          初期顧客id={入金する.id}
          初期種類={入金する.種類}
          onClose={() => set入金する(null)}
          onDone={() => { set入金する(null); load(); onChanged && onChanged(); }}
        />
      )}
    </>
  );
}
