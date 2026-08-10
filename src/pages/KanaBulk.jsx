import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal, Err, Note, Loading } from '../components/ui';

// よみ（カナ）をまとめて入れる画面。
//
// よみが空だと、CSVの振込人名からお客様を当てられない。
// 1件ずつ顧客ページを開いて入れるのは、人数が多いと現実的でないので、
// 一覧で上から順に打てるようにする。
//
// 苗字の辞書から候補は出すが、**勝手に保存はしない。**
// 候補はあくまで下書きで、正解ではない。人が見て、必要なら直してから保存する。
export default function KanaBulk({ onClose, onDone }) {
  const [d, setD] = useState(null);        // {顧客, 空の人数, 候補がある人数}
  const [打った, set打った] = useState({}); // id → よみ（人が打った・候補を入れた）
  const [候補から, set候補から] = useState({}); // id → true（候補をそのまま使っている）
  const [空だけ, set空だけ] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.kanaList()
      .then((x) => {
        setD(x); set打った({}); set候補から({});
        // 全員そろっているなら、空だけ出しても1人も出ない。
        // 直しに来た人が空の画面を見ることになるので、はじめから全員を出す
        if (!x.空の人数) set空だけ(false);
      })
      .catch((e) => setErr(e.message));
  }, []);

  const いまの値 = (c) => (打った[c.id] !== undefined ? 打った[c.id] : c.よみ);
  const 変わった = d
    ? d.顧客.filter((c) => 打った[c.id] !== undefined && 打った[c.id] !== c.よみ)
    : [];

  // 空いているところだけ候補で埋める。すでに入っているものは触らない
  const 候補を入れる = () => {
    if (!d) return;
    const 次 = { ...打った }, 印 = { ...候補から };
    let n = 0;
    d.顧客.forEach((c) => {
      if (いまの値(c) || !c.候補) return;
      次[c.id] = c.候補; 印[c.id] = true; n++;
    });
    set打った(次); set候補から(印);
    setErr(n ? '' : '入れられる候補がありませんでした。');
  };

  const 保存 = async () => {
    if (!変わった.length) { setErr('変わったところがありません。'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api.patchCustomers({
        よみ: 変わった.map((c) => ({ id: c.id, よみ: 打った[c.id] })),
      });
      alert(`${r.変えた人数}名のよみを入れました。`);
      onDone && onDone();
      onClose();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const 出す = d
    ? d.顧客.filter((c) => !空だけ || !c.よみ)
    : [];
  const 残り = d ? d.顧客.filter((c) => !いまの値(c)).length : 0;

  return (
    <Modal
      huge
      title="よみ（カナ）をまとめて入れる"
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>閉じる</button>
          <div className="right">
            <button className="btn btn-main" onClick={保存} disabled={busy || !変わった.length}>
              {busy ? '保存しています…' : `${変わった.length}名を保存する`}
            </button>
          </div>
        </>
      }
    >
      <Note>
        <b>よみが入っていないと、CSVの振込人名からお客様を当てられません。</b>
        {' '}銀行の明細は <span className="mono">ｳｻﾐ ﾏｺﾄ</span> のようなカナで来るためです。
        <br />
        ひらがなでも半角カナでも構いません。保存するときに全角カナへそろえます。
        <br />
        <b>一度入れたよみも、ここで直せます。</b>
        読み方が違っていたら、上の「よみが空の方だけ出す」のチェックを外して探してください。
      </Note>

      {d && (
        <div className="kana-bar">
          <button className="btn" onClick={候補を入れる} disabled={busy || !d.候補がある人数}>
            苗字の辞書から候補を入れる（{d.候補がある人数}名）
          </button>
          <label className="kana-only">
            <input type="checkbox" checked={空だけ}
                   onChange={(e) => set空だけ(e.target.checked)} />
            よみが空の方だけ出す
          </label>
          <span className="kana-cnt">
            全{d.顧客.length}名 ／ まだ空 <b>{残り}名</b>
            {変わった.length > 0 && <> ／ 直した <b>{変わった.length}名</b></>}
          </span>
        </div>
      )}

      <Err>{err}</Err>

      <div className="card tw meisai">
        <table>
          <thead>
            <tr><th style={{ width: 60 }}>状態</th><th>氏名</th>
              <th style={{ width: 260 }}>よみ（カナ）</th><th>苗字の辞書から</th></tr>
          </thead>
          <tbody>
            {d === null && <tr><td colSpan={4}><Loading 件数={6} /></td></tr>}
            {d && 出す.length === 0 && (
              <tr><td colSpan={4} style={{ color: 'var(--ink-2)', padding: 14 }}>
                {d.顧客.length === 0
                  ? 'まだ顧客の登録がありません。'
                  : 'よみが空の方はいません。直すときは、上のチェックを外してください。'}
              </td></tr>
            )}
            {出す.map((c) => {
              const 値 = いまの値(c);
              return (
                <tr key={c.id} className={値 ? '' : 'kana-empty'}>
                  <td>
                    {!値 ? <span className="tag t-warn">空</span>
                      : 候補から[c.id] && 打った[c.id] === c.候補
                        ? <span className="tag t-dup">候補</span>
                        : 打った[c.id] !== undefined && 打った[c.id] !== c.よみ
                          ? <span className="tag t-done">直した</span>
                          : <span className="tag t-csv">済み</span>}
                  </td>
                  <td><b>{c.氏名}</b></td>
                  <td>
                    <input
                      className="kana-in" value={値}
                      placeholder="ウサミ マコト"
                      onChange={(e) => {
                        set打った((o) => ({ ...o, [c.id]: e.target.value }));
                        set候補から((o) => ({ ...o, [c.id]: false }));
                      }}
                    />
                  </td>
                  <td className="kana-hint">
                    {c.候補
                      ? <button className="btn btn-sm" onClick={() => {
                          set打った((o) => ({ ...o, [c.id]: c.候補 }));
                          set候補から((o) => ({ ...o, [c.id]: true }));
                        }}>{c.候補} を入れる</button>
                      : <span>{c.候補の理由}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="kana-note">
        候補は<b>苗字の読みだけ</b>の下書きです。正解ではありません。
        下の名前まで入れておくと、同じ苗字の方がいても取り違えません。
      </p>
    </Modal>
  );
}
