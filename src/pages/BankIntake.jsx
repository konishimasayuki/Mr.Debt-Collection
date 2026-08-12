import { useEffect, useState } from 'react';
import { api, yen } from '../api';
import { Err, Note } from '../components/ui';
import { 明細の表, 除外リスト, 既定の入金種類 } from './PaymentEntry';

// 銀行から取ってきた明細を、人が確かめて入金にする欄。
//
// 取ってきただけでは入金にしない。CSVと同じ確認の表を通す。
// 間違った人に入った入金は、黙って入ると誰も気づかないため。
export default function BankIntake({ onChanged }) {
  const [d, setD] = useState(null);      // {口座, 明細, 概要, 顧客}
  const [keep, setKeep] = useState({});
  const [assignTo, setAssignTo] = useState({});
  const [種類, set種類] = useState({});          // 行番号 → 月額 / ボーナス
  const [除外を開く, set除外を開く] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');  // '取得' / '取込' / '見送'

  const load = async () => {
    try {
      const x = await api.bank();
      setD(x);
      const k = {};
      x.明細.forEach((r) => { k[r.行] = !r.すでに取込済み; });
      setKeep(k);
      setAssignTo({}); set種類({});
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const 取りに行く = async () => {
    setBusy('取得'); setErr('');
    try {
      const r = await api.bankFetch();
      const 失敗 = (r.結果 || []).filter((x) => x.失敗);
      if (失敗.length) {
        setErr(失敗.map((x) => `${x.銀行名}：${x.失敗}`).join('\n'));
      }
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  };

  const 残す行 = () => (d ? d.明細.filter((r) => keep[r.行]) : []);

  const 取り込む = async () => {
    const rows = 残す行().map((r) => {
      const cid = assignTo[r.行] ? Number(assignTo[r.行]) : r.顧客id;
      const c = (d.顧客 || []).find((x) => x.id === cid) || null;
      return { ...r, 顧客id: cid, 入金種類: 種類[r.行] || 既定の入金種類(c) };
    });
    if (!rows.length) { setErr('取り込む行がありません。'); return; }
    setBusy('取込'); setErr('');
    try {
      const r = await api.bankCommit(rows);
      const 余 = r.余った || [];
      alert(`${r.取り込んだ件数}件を入金にしました。`
        + (r.見送った件数 ? `\n${r.見送った件数}件は見送りました（すでに取り込み済みなど）。` : '')
        + (r.照合できなかった件数 ? `\n${r.照合できなかった件数}件は、まだどの顧客か決まっていません。`
           + '\n入金履歴から顧客を選んでください。' : '')
        + (余.length ? `\n${余.length}件は、選んだ種類の回に充てきれず余りになりました。`
           + (余.filter((x) => x.ボーナスが残っている).length
             ? '\nボーナスの回が残っている方がいます。入金履歴で入金種類を「ボーナス」に直してください。' : '')
           : ''));
      await load();
      onChanged && onChanged();
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  };

  // チェックを外した行は「入金ではない」と決める。次から確認の表に出さない
  const 見送る = async () => {
    const ids = (d.明細.filter((r) => !keep[r.行]).map((r) => r.明細id)).filter(Boolean);
    if (!ids.length) { setErr('見送る行がありません。チェックを外した行が対象です。'); return; }
    if (!confirm(`チェックを外した ${ids.length}件を「入金ではない」として片づけます。\n\n`
      + '入金にはなりません。次から、この欄には出なくなります。\nよろしいですか。')) return;
    setBusy('見送'); setErr('');
    try {
      await api.bankSkip(ids);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  };

  const 口座 = d ? d.口座 : [];
  const 使う口座 = 口座.filter((a) => a.使う);
  const 失敗した口座 = 口座.filter((a) => a.最後の失敗);
  const 残す数 = 残す行().length;
  const 残す額 = 残す行().reduce((s, r) => s + r.金額, 0);
  const 外した数 = d ? d.明細.length - 残す数 : 0;

  return (
    <div className="sec">
      <h3>銀行から取り込む</h3>

      {口座.length === 0 ? (
        <Note>
          まだ口座の登録がありません。「設定」タブの<b>「銀行口座」</b>から入れてください。
          <br />
          登録すると、この欄に銀行の入金明細が出るようになります。
          <b>取ってくるだけで、入金にはなりません。</b>下の確認の表で残した行だけが入金になります。
        </Note>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                        marginBottom: 10 }}>
            <button className="btn btn-main" onClick={取りに行く} disabled={!!busy}>
              {busy === '取得' ? '取りに行っています…' : 'いま取りに行く'}
            </button>
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
              {使う口座.length}口座
              {使う口座.map((a) => (
                <span key={a.id} style={{ marginLeft: 8 }}>
                  {a.銀行名}
                  {a.下4桁 && <span style={{ color: 'var(--ink-3)' }}>（…{a.下4桁}）</span>}
                  {a.最後に取れた
                    ? <span style={{ color: 'var(--ink-3)' }}> 最後 {a.最後に取れた}</span>
                    : <span className="tag t-warn" style={{ marginLeft: 4 }}>未取得</span>}
                </span>
              ))}
            </span>
          </div>

          {失敗した口座.length > 0 && (
            <Note kind="warn">
              <b>取りに行けなかった口座があります。</b>
              {失敗した口座.map((a) => (
                <div key={a.id} style={{ fontSize: 13 }}>{a.銀行名}：{a.最後の失敗}</div>
              ))}
              直らないときは、デバッグ依頼から知らせてください。
            </Note>
          )}
        </>
      )}

      <Err>{err}</Err>

      {d && d.明細.length > 0 && (
        <>
          <Note>
            まだ確かめていない明細が <b>{d.概要.件数}件</b>・合計 {yen(d.概要.合計)}円。
            照合できた {d.概要.照合できた}件、照合できない {d.概要.照合できない}件。
            {d.概要.すでに取込済み > 0 && <> すでに取込済み <b>{d.概要.すでに取込済み}件</b>（最初から外してあります）。</>}
            <br />
            <b>ここに出ているだけでは、まだ入金になっていません。</b>
            残す行にチェックを付けて「取り込む」を押してください。
            <br />
            <b>入金種類は、いま払えていない回に合わせてあります。</b>{' '}
            月額を予定どおり払い終えている方は<b>「ボーナス」</b>から始まります。
            違っていたら、その行で選び直してください。
          </Note>

          <div className="row-btn" style={{ marginBottom: 10 }}>
            <button className="btn btn-sm" onClick={() => set除外を開く(true)}>
              除外リストを確認・編集
            </button>
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
              入れておくと、次からは毎回この振込人を自動で外します
            </span>
          </div>

          <明細の表 明細={d.明細} 顧客={d.顧客}
                    keep={keep} setKeep={setKeep}
                    assignTo={assignTo} setAssignTo={setAssignTo}
                    種類={種類} set種類={set種類} />

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12,
                        flexWrap: 'wrap' }}>
            <button className="btn btn-main" onClick={取り込む} disabled={!!busy || !残す数}>
              {busy === '取込' ? '取り込んでいます…' : `${残す数}件を取り込む（${yen(残す額)}円）`}
            </button>
            <button className="btn" onClick={見送る} disabled={!!busy || !外した数}>
              外した{外した数}件を片づける
            </button>
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
              入金ではない行（手数料の戻しなど）は、チェックを外して「片づける」を押すと、
              次から出なくなります。
            </span>
          </div>
        </>
      )}

      {除外を開く && (
        <除外リスト
          候補={[...new Set(((d && d.明細) || [])
            .filter((r) => !r.照合できた).map((r) => r.振込人).filter(Boolean))].sort()}
          onClose={() => set除外を開く(false)}
          onChanged={() => { set除外を開く(false); load(); }}
        />
      )}

      {d && d.明細.length === 0 && 口座.length > 0 && (
        <Note kind="ok">確かめ待ちの明細はありません。</Note>
      )}
    </div>
  );
}
