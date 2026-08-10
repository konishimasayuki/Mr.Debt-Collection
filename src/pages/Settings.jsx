import { useEffect, useState } from 'react';
import { api, yen } from '../api';
import { Modal, Text, Select, Err, Note, Empty, Loading } from '../components/ui';

export default function Settings({ onOpen, onChanged }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);

  const load = () => {
    setErr('');
    api.companies().then((d) => setRows(d.会社)).catch((e) => { setRows([]); setErr(e.message); });
  };
  useEffect(load, []);

  const remove = async (c) => {
    if (!confirm(`債権会社「${c.名前}」を削除します。よろしいですか。`)) return;
    try {
      await api.deleteCompany(c.id);
      load(); onChanged && onChanged();
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div className="bar">
        <h2>設定</h2>
        <div className="bar-right">
          <button className="btn btn-main" onClick={() => setOpen(true)}>＋ 債権会社を追加</button>
        </div>
      </div>

      <div className="sec">
        <h3>債権会社</h3>
        <Note>
          ここで登録した会社が、新規顧客登録の「債権譲渡会社」「債権譲渡先」の選択肢になります。
          顧客に使われている会社は削除できません。
        </Note>
        <Err>{err}</Err>

        <div className="card tw cards">
          <table>
            <thead>
              <tr><th>会社名</th><th>メモ</th><th className="num">使用中の顧客</th><th /></tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={4}><Loading 件数={2} 行={1} /></td></tr>}
              {rows && rows.length === 0 && (
                <tr><td colSpan={4}><Empty>
                  まだ登録がありません。「債権会社を追加」から入れてください。
                </Empty></td></tr>
              )}
              {rows && rows.map((c) => (
                <tr key={c.id}>
                  <td className="nm"><b>{c.名前}</b></td>
                  <td data-label="メモ" style={{ whiteSpace: 'normal', fontSize: 13 }}>{c.メモ || ''}</td>
                  <td className="num" data-label="使用中の顧客">{c.使用数}件</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => setEdit(c)}>編集</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(c)}>削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <BankAccounts />

      <BonusRepair onChanged={onChanged} />

      <TestCustomer onOpen={onOpen} onChanged={onChanged} />

      {(open || edit) && (
        <CompanyForm
          c={edit}
          onClose={() => { setOpen(false); setEdit(null); }}
          onDone={() => { setOpen(false); setEdit(null); load(); onChanged && onChanged(); }}
        />
      )}
    </>
  );
}

// ── ボーナスの回に入ってしまった入金の付け直し ──────────────
//
// いまは自動で取り込んだ入金をボーナスの回に充てない。
// けれど、その決まりより前に取り込んだ分は、入ったまま残っている。
// ここで一度だけ押してもらって、月額の回に付け直す。
//
// 直すものが無いときは、この欄ごと出さない。使わないボタンは迷いのもと。
function BonusRepair({ onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.repairCheck().then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const 直す = async () => {
    if (!confirm(
      `${d.件数}名の入金を、ボーナスの回から月額の回へ付け直します。\n\n`
      + '入金の金額そのものは変わりません。どの回に充てるかだけが変わります。\n'
      + (d.余り合計
        ? `${d.余りが出る人数}名・合わせて ${yen(d.余り合計)}円 は月額の回に充てきれず、`
          + '余りになります（残債はその分だけ増えて見えます）。\n'
        : '')
      + '\nよろしいですか。')) return;
    setBusy(true); setErr('');
    try {
      const r = await api.repairRun();
      await load();
      onChanged && onChanged();
      alert(`${r.件数}名を付け直しました。`
        + (r.余り合計
          ? `\n\n${r.余りが出る人数}名・${yen(r.余り合計)}円 が余りになりました。`
            + '\nその方の入金が本当はボーナス分なら、入金履歴でその行を押して'
            + '\n入金種類を「ボーナス」に直してください。'
          : ''));
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (d && d.件数 === 0) return null;

  return (
    <div className="sec">
      <h3>ボーナスの回に入った入金の付け直し</h3>
      <Note kind="warn">
        <b>ボーナスの回に、月々の振り込みが入ってしまっている方がいます。</b>
        {d && <> 対象は <b>{d.件数}名</b>です。</>}
        <br />
        期日が同じだと、金額の大きいボーナスの回が先に埋まるため、
        月々の回がいつまでも未入金のまま残っていました。
        いまの台帳は<b>自動で取り込んだ入金をボーナスの回に充てません</b>が、
        その決まりより前に入った分は、入ったままです。
        <br />
        <b>入金の金額そのものは変わりません。</b>どの回に充てるかだけを付け直します。
        記録にも残ります。
      </Note>
      <Err>{err}</Err>

      {d === null && <Loading 件数={2} 行={1} />}

      {d && d.件数 > 0 && (
        <>
          {d.余り合計 > 0 && (
            <Note kind="warn">
              このうち <b>{d.余りが出る人数}名</b>・合わせて <b>{yen(d.余り合計)}円</b> は、
              月額の回をもう払い終えているため、充てる先がなく<b>余り</b>になります。
              その分は<b>残債が増えて見えます。</b>
              <br />
              その入金が本当はボーナス分なら、<b>先に</b>入金履歴でその行を押して
              <b>入金種類を「ボーナス」</b>に直してから、このボタンを押してください。
              あとから直しても構いません。
            </Note>
          )}

          <div className="card tw cards">
            <table>
              <thead>
                <tr><th>お客様</th><th className="num">ボーナスから外す</th>
                  <th className="num">余りになる</th><th>余りの入金</th></tr>
              </thead>
              <tbody>
                {d.顧客.map((c) => (
                  <tr key={c.顧客id}>
                    <td className="nm"><b>{c.顧客名}</b></td>
                    <td className="num" data-label="ボーナスから外す">
                      {c.ボーナスから外す ? `${yen(c.ボーナスから外す)}円` : '—'}
                    </td>
                    <td className="num" data-label="余りになる">
                      {c.余り
                        ? <b style={{ color: 'var(--overdue)' }}>{yen(c.余り)}円</b>
                        : '—'}
                    </td>
                    <td data-label="余りの入金" style={{ whiteSpace: 'normal', fontSize: 12.5 }}>
                      {c.余りの明細.map((x) => `${x.日付}・${yen(x.金額)}円`).join('／') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row-btn">
            <button className="btn btn-main" onClick={直す} disabled={busy}>
              {busy ? '付け直しています…' : `${d.件数}名を月額の回に付け直す`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── 動作を試すための顧客 ─────────────────────────
// 本物の顧客で練習させないために置く。
// おかしくなったら作り直せばよい、と分かる場所に置いておく。
function TestCustomer({ onOpen, onChanged }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.testCustomer().then(setT).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const 用意する = async () => {
    if (t && t.ある && !confirm(
      `「${t.氏名}」を作り直します。\n`
      + '今入っている入金・約束・メモはすべて消えます。よろしいですか。')) return;
    setBusy(true); setErr('');
    try {
      const d = await api.makeTestCustomer();
      await load();
      onChanged && onChanged();
      alert(`${d.氏名}さんを用意しました。\n`
        + `${d.初回} から ${d.最終回} まで、全12回。\n`
        + `1回目は入金済み、2回目は一部入金、${d.約束日} に入金約束が入っています。`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const 消す = async () => {
    if (!confirm(`「${t.氏名}」と、その入金・約束・メモをすべて消します。\n`
      + 'よろしいですか。')) return;
    setBusy(true); setErr('');
    try { await api.deleteTestCustomer(); await load(); onChanged && onChanged(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="sec">
      <h3>動作を試すための顧客</h3>
      <Note>
        本物の顧客で練習しなくて済むように、試しに使える顧客を1件だけ置けます。
        顧客一覧では <span className="tag t-test">テスト</span> の印が付き、
        入金・入金約束・メモ・CSVの取り込みを自由に試せます。
        分からなくなったら、作り直してください。
      </Note>
      <Err>{err}</Err>

      <div className="row-btn">
        {t && t.ある && (
          <button className="btn" onClick={() => onOpen(t.id)}>
            {t.氏名} の顧客ページを開く
          </button>
        )}
        <button className="btn btn-main" onClick={用意する} disabled={busy}>
          {t && t.ある ? '最初の状態に戻す' : 'テスト用の顧客を用意する'}
        </button>
        {t && t.ある && (
          <button className="btn btn-danger" onClick={消す} disabled={busy}>削除</button>
        )}
      </div>
    </div>
  );
}


// ── 銀行口座 ───────────────────────────
// 明細を取りに行く先。合鍵（接続の鍵）はここには入れない。
// 鍵はVercelの環境変数に置く（画面から見えるところに置かない）。
function BankAccounts() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [開く, set開く] = useState(null);   // 口座 or 'new'

  const load = () => {
    setErr('');
    api.bank().then(setD).catch((e) => { setD({ 口座: [], 差し込み口: [] }); setErr(e.message); });
  };
  useEffect(load, []);

  return (
    <div className="sec">
      <h3>銀行口座</h3>
      <Note>
        入金明細を取りに行く先です。<b>取ってくるだけで、入金にはなりません。</b>
        入金登録タブの「銀行から取り込む」で、人が確かめてから入金にします。
        <br />
        接続の鍵は、この画面には入れません。置き場所は別に用意します。
      </Note>
      <Err>{err}</Err>

      <div className="card tw">
        <table>
          <thead>
            <tr><th>銀行</th><th>支店</th><th>口座</th><th>差し込み口</th>
              <th>最後に取れた</th><th>使う</th><th /></tr>
          </thead>
          <tbody>
            {d === null && <tr><td colSpan={7}><Loading 件数={2} /></td></tr>}
            {d && d.口座.length === 0 && (
              <tr><td colSpan={7}><Empty>
                まだ登録がありません。「銀行口座を追加」から入れてください。
              </Empty></td></tr>
            )}
            {d && d.口座.map((a) => (
              <tr key={a.id}>
                <td><b>{a.銀行名}</b></td>
                <td>{a.支店 || '—'}</td>
                <td className="mono">{a.下4桁 ? `…${a.下4桁}` : '—'}</td>
                <td>{a.差し込み口}</td>
                <td style={{ fontSize: 12.5 }}>
                  {a.最後に取れた || <span className="tag t-warn">未取得</span>}
                  {a.最後の失敗 && (
                    <div style={{ color: 'var(--overdue)', fontSize: 12 }}>{a.最後の失敗}</div>
                  )}
                </td>
                <td>{a.使う
                  ? <span className="tag t-done">使う</span>
                  : <span className="tag t-csv">止めている</span>}</td>
                <td><button className="btn btn-sm" onClick={() => set開く(a)}>編集</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row-btn">
        <button className="btn btn-main" onClick={() => set開く('new')}>＋ 銀行口座を追加</button>
      </div>

      {開く && (
        <BankAccountForm
          a={開く === 'new' ? null : 開く}
          差し込み口={(d && d.差し込み口) || []}
          onClose={() => set開く(null)}
          onDone={() => { set開く(null); load(); }}
        />
      )}
    </div>
  );
}

function BankAccountForm({ a, 差し込み口, onClose, onDone }) {
  const [v, setV] = useState({
    銀行名: a ? a.銀行名 : '', 支店: a ? a.支店 : '', 下4桁: a ? a.下4桁 : '',
    差し込み口: a ? a.差し込み口 : (差し込み口[0] ? 差し込み口[0].kind : ''),
    銀行側の識別子: a ? a.銀行側の識別子 : '', 使う: a ? a.使う : true,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((o) => ({ ...o, [k]: val }));
  const 選んだ口 = 差し込み口.find((x) => x.kind === v.差し込み口);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await api.saveBankAccount(a ? { id: a.id, ...v } : v);
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Modal
      title={a ? '銀行口座の編集' : '銀行口座の追加'}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>キャンセル</button>
          <div className="right">
            <button className="btn btn-main" onClick={submit} disabled={busy}>
              {busy ? '保存しています…' : a ? '保存する' : '追加する'}
            </button>
          </div>
        </>
      }
    >
      <div className="grid2">
        <Text label="銀行名" value={v.銀行名} onChange={set('銀行名')} placeholder="◯◯銀行" />
        <Text label="支店" value={v.支店} onChange={set('支店')} placeholder="本店営業部" />
      </div>
      <Text label="口座番号の下4桁" value={v.下4桁} onChange={set('下4桁')}
            placeholder="1234" hint="どの口座か見分けるためだけに使います" />
      <Select label="差し込み口" value={v.差し込み口} onChange={set('差し込み口')}
              options={差し込み口.map((x) => ({ value: x.kind, label: x.名前 }))}
              hint={選んだ口 ? 選んだ口.説明 : '銀行ごとのつなぎ方です'} />
      <Text label="銀行側の識別子" value={v.銀行側の識別子} onChange={set('銀行側の識別子')}
            placeholder="銀行から知らされた口座の番号など"
            hint="銀行との接続で、どの口座かを指すものです。分からなければ空のままで構いません" />
      <Select label="使うか" value={v.使う ? '使う' : '止める'}
              onChange={(x) => set('使う')(x === '使う')}
              options={[{ value: '使う', label: '使う（取りに行く）' },
                        { value: '止める', label: '止めている（取りに行かない）' }]} />
      <Err>{err}</Err>
    </Modal>
  );
}

function CompanyForm({ c, onClose, onDone }) {
  const [v, setV] = useState({ 名前: c ? c.名前 : '', メモ: c ? c.メモ : '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((o) => ({ ...o, [k]: val }));

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      if (c) await api.patchCompany({ id: c.id, ...v });
      else await api.addCompany(v);
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <Modal
      title={c ? '債権会社の編集' : '債権会社の追加'}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>キャンセル</button>
          <div className="right">
            <button className="btn btn-main" onClick={submit} disabled={busy}>
              {busy ? '保存しています…' : c ? '保存する' : '追加する'}
            </button>
          </div>
        </>
      }
    >
      <Text label="会社名" value={v.名前} onChange={set('名前')} placeholder="◯◯債権回収株式会社" />
      <Text label="メモ" value={v.メモ} onChange={set('メモ')} placeholder="担当者、連絡先など（任意）" />
      <Err>{err}</Err>
    </Modal>
  );
}
