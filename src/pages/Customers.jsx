import { useEffect, useRef, useState } from 'react';
import { api, yen, ymd, norm } from '../api';
import { Modal, Text, Money, Select, Err, Empty, Note, Loading } from '../components/ui';

// 電話帳と同じ並び。索引はサーバーが「あ」「か」…で返す
const 行 = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ', 'その他'];

// 貼り付いた帯の下端。飛び先と「いまの行」の判定に同じ値を使う。
// ずれていると、飛んだ直後に手前の行が塗られる。
const 寸法 = (sel, 名) => {
  const e = document.querySelector(sel);
  return e ? e.getBoundingClientRect()[名] : 0;
};
// いま画面に貼り付いている帯の下端。「いまの行」の判定に使う
const 帯の下 = () => Math.max(寸法('.head', 'bottom'), 寸法('.idx', 'bottom'));
// 貼り付いたときの帯の下端。飛び先の計算に使う。
// 画面の上にいるときは索引バーがまだ流れの中にあり、bottom が実際より下に出るため、
// 高さから求めないと飛びすぎる（押した行の1つ手前が塗られる）。
const 貼り付いたときの帯の下 = () => 寸法('.head', 'height') + 寸法('.idx', 'height');
const 余白 = 8;   // 見出しを帯からこれだけ離して止める

export default function Customers({ onOpen, onChanged }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [いまの行, setいまの行] = useState('');   // 画面に出ている行。索引の色に使う
  const [余りの高さ, set余りの高さ] = useState(0); // 最後の行も上まで送れるようにする余白
  const 表 = useRef(null);

  const load = () => {
    setErr('');
    api.customers().then((d) => setRows(d.顧客)).catch((e) => { setRows([]); setErr(e.message); });
  };
  useEffect(load, []);

  const k = norm(key);
  const shown = (rows || []).filter((r) => !k
    || norm(r.氏名).includes(k) || norm(r.よみ).includes(k) || norm(r.車種).includes(k));

  // 行ごとにまとめる（サーバーがあいうえお順で返しているので、並べ直さない）
  const 組 = 行.map((g) => ({ 行: g, 人: shown.filter((r) => r.索引 === g) }))
    .filter((g) => g.人.length);
  // いま画面に出ている行を追って、索引の色を合わせる。
  // 貼り付いた帯の下にいちばん近い見出しが「いまの行」。
  useEffect(() => {
    if (!rows) return;
    let 待ち = 0;
    const 見る = () => {
      待ち = 0;
      // 飛んだ直後の見出し（帯から余白のぶん下）も「いまの行」に入るよう、
      // 判定の線は余白より少しだけ下に取る
      const 線 = 帯の下() + 余白 + 4;
      const 見出し達 = [...document.querySelectorAll('[id^="gyo-"]')];
      // ふつうは「線より上にある最後の見出し」がいまの行
      let いま = '';
      for (const el of 見出し達) {
        if (el.getBoundingClientRect().top <= 線) いま = el.id.slice(4);
      }
      // いちばん下まで来たら、それ以上スクロールできない。
      // 最後のほうの見出しは線まで上がらないので、
      // 画面のいちばん上に見えている行を指す
      const 下端 = window.innerHeight + window.scrollY
        >= document.documentElement.scrollHeight - 2;
      if (下端) {
        const 見えている = 見出し達.find((el) => el.getBoundingClientRect().bottom > 線);
        if (見えている) いま = 見えている.id.slice(4);
      }
      // どの見出しもまだ線より下なら、いちばん上の行を指しておく
      setいまの行(いま || (見出し達[0] ? 見出し達[0].id.slice(4) : ''));
    };
    const 動いた = () => { if (!待ち) 待ち = requestAnimationFrame(見る); };
    見る();
    window.addEventListener('scroll', 動いた, { passive: true });
    window.addEventListener('resize', 動いた);
    return () => {
      window.removeEventListener('scroll', 動いた);
      window.removeEventListener('resize', 動いた);
      if (待ち) cancelAnimationFrame(待ち);
    };
  }, [rows, key]);

  // 最後のほうの行は、画面の下が足りなくて上まで送れない。
  // 送れないと索引の色も合わないので、足りないぶんだけ余白を足す。
  useEffect(() => {
    if (!rows) return;
    const 測る = () => {
      const 束 = 表.current && 表.current.querySelectorAll('tbody');
      if (!束 || !束.length) return set余りの高さ(0);
      const 最後 = 束[束.length - 1].getBoundingClientRect().height;
      set余りの高さ(Math.max(0, Math.round(
        window.innerHeight - 貼り付いたときの帯の下() - 余白 - 最後 - 24)));
    };
    測る();
    window.addEventListener('resize', 測る);
    return () => window.removeEventListener('resize', 測る);
  }, [rows, key]);

  // 索引を押したときの飛び先。ヘッダーと索引バーは画面の上に貼り付いたままなので、
  // その高さぶん手前で止めないと、肝心の見出しと最初の名前が裏に隠れる。
  const とぶ = (g) => {
    const el = document.getElementById(`gyo-${g}`);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY
      - 貼り付いたときの帯の下() - 余白;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  };

  return (
    <>
      <div className="bar">
        <h2>顧客一覧</h2>
        <div className="bar-right">
          <input
            className="search" placeholder="氏名・よみ・車種で検索"
            value={key} onChange={(e) => setKey(e.target.value)}
          />
          <button className="btn btn-main" onClick={() => setOpen(true)}>＋ 新規顧客登録</button>
        </div>
      </div>

      <Err>{err}</Err>

      {rows !== null && (
        <div className="idx">
          {行.map((g) => {
            const ある = 組.some((x) => x.行 === g);
            return (
              <button
                key={g}
                className={'idx-b' + (ある ? '' : ' off') + (いまの行 === g ? ' on' : '')}
                onClick={(e) => { if (ある) { とぶ(g); e.currentTarget.blur(); } }}
                disabled={!ある}
              >
                {g === 'その他' ? '他' : g}
              </button>
            );
          })}
        </div>
      )}

      {rows === null && <Loading 件数={6} />}

      {rows && shown.length === 0 && (
        <div className="card"><Empty>
          {rows.length ? '見つかりませんでした。' : '顧客がまだ登録されていません。'}
        </Empty></div>
      )}

      {rows && shown.length > 0 && (
        <div className="card tw cards" ref={表}>
          <table>
            <thead>
              <tr>
                <th>氏名</th>
                <th>債権譲渡会社</th>
                <th>車種</th>
                <th className="num">毎月の支払日</th>
                <th className="num">金額</th>
                <th className="num">残り支払い回数</th>
                <th className="num">残債金額</th>
              </tr>
            </thead>
            {組.map(({ 行: g, 人 }) => (
              <tbody key={g}>
                {/* 行の見出し。1つの表に差し込むので、列の幅がそろう */}
                <tr className="grp-row">
                  <th colSpan={7} id={`gyo-${g}`}>
                    {g === 'その他' ? 'よみが分からない方' : `${g}行`}
                    <span>{人.length}名</span>
                  </th>
                </tr>
                {/* 終わった取引（引き上げ・完済）は薄いグレー。
                    一覧からは消さない。名前で探されたときに見つからないと困る */}
                {人.map((r) => (
                  <tr key={r.id} className={'clickable' + (r.テスト ? ' test-row' : '')
                        + (r.終了 ? ' fin-row' : '')}
                      onClick={() => onOpen(r.id)}>
                    <td className="nm">
                      <b>{r.氏名}</b>
                      {r.テスト && <span className="tag t-test">テスト</span>}
                      {r.終了 && (
                        <span className={'tag ' + (r.終了理由 === '引き上げ' ? 't-taken' : 't-done')}>
                          {r.終了理由}
                        </span>
                      )}
                      {/* 遅れている人だけ出す。遅れていなければ何も出さない */}
                      {!r.終了 && r.遅れ日数 > 0 && (
                        <span className="tag t-late">{r.遅れ日数}日 遅れ</span>
                      )}
                      {r.よみ && <span className="yomi">{r.よみ}</span>}
                    </td>
                    <td data-label="債権譲渡会社">
                      {r.債権譲渡会社 || <span className="none">—</span>}
                    </td>
                    <td data-label="車種">{r.車種 || <span className="none">—</span>}</td>
                    <td className="num" data-label="毎月の支払日">{r.毎月の支払日}日</td>
                    <td className="num" data-label="金額">{yen(r.金額)}円</td>
                    <td className="num" data-label="残り支払い回数">{r.残り支払い回数}回</td>
                    <td className="num strong" data-label="残債金額">{yen(r.残債金額)}円</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {rows && shown.length > 0 && 余りの高さ > 0 && (
        <div aria-hidden style={{ height: 余りの高さ }} />
      )}

      {open && (
        <NewCustomer
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); load(); onChanged && onChanged(); }}
        />
      )}
    </>
  );
}

// ── 新規顧客登録 ───────────────────────────
const 空 = {
  名前: '', よみ: '', 性別: '', 生年月日: '', 住所: '', 電話番号: '',
  契約日: '', 車種: '', 債権譲渡会社: '', 債権譲渡先: '',
  月々の金額: '', 回数: 48, 支払日: 27, 開始月: '', メモ: '',
};

function NewCustomer({ onClose, onDone }) {
  const [v, setV] = useState(空);
  const [companies, setCompanies] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (val) => setV((o) => ({ ...o, [k]: val }));

  useEffect(() => {
    api.companies()
      .then((d) => setCompanies(d.会社))
      .catch(() => setCompanies([]));
  }, []);

  const opts = companies.map((c) => ({ value: String(c.id), label: c.名前 }));

  // 開始月の既定は契約日の翌月
  const 既定開始 = (() => {
    if (v.開始月) return v.開始月;
    const base = v.契約日 ? new Date(v.契約日) : new Date();
    if (isNaN(base)) return '';
    const t = base.getFullYear() * 12 + base.getMonth() + 1;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
  })();

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const d = await api.addCustomer({ ...v, 開始月: 既定開始 });
      let msg = `${d.氏名}さんを登録しました。\n${d.初回} から ${d.最終回} まで、全${v.回数}回。`;
      if (d.同姓同名) msg += `\n\n※ 同じお名前の方が ${d.同姓同名}名 になりました。ご確認ください。`;
      alert(msg);
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title="新規顧客登録"
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
        <Text label="名前" value={v.名前} onChange={set('名前')} placeholder="山田 太郎" />
        <Text label="よみ（カナ）" value={v.よみ} onChange={set('よみ')}
              placeholder="ヤマダ タロウ" hint="あいうえお順と、CSVの振込人名の照合に使います" />
      </div>
      <div className="grid3">
        <Select label="性別" value={v.性別} onChange={set('性別')} placeholder="選択しない"
                options={[{ value: '男性', label: '男性' }, { value: '女性', label: '女性' },
                          { value: 'その他', label: 'その他' }]} />
        <Text label="生年月日" type="date" value={v.生年月日} onChange={set('生年月日')} />
        <Text label="電話番号" value={v.電話番号} onChange={set('電話番号')} placeholder="090-0000-0000" />
      </div>
      <Text label="住所" value={v.住所} onChange={set('住所')} />
      <div className="grid2">
        <Text label="契約日" type="date" value={v.契約日} onChange={set('契約日')} />
        <Text label="車種" value={v.車種} onChange={set('車種')} placeholder="タントカスタム" />
      </div>
      <div className="grid2">
        <Select label="債権譲渡会社" value={v.債権譲渡会社} onChange={set('債権譲渡会社')}
                placeholder={opts.length ? '選択しない' : '設定タブで登録してください'}
                options={opts} disabled={!opts.length} />
        <Select label="債権譲渡先" value={v.債権譲渡先} onChange={set('債権譲渡先')}
                placeholder={opts.length ? '選択しない' : '設定タブで登録してください'}
                options={opts} disabled={!opts.length} />
      </div>
      <div className="grid3">
        <Money label="月々の金額" value={v.月々の金額} onChange={set('月々の金額')} placeholder="30,000" />
        <Text label="支払回数" type="number" min="1" value={v.回数}
              onChange={(x) => set('回数')(Number(x) || '')} />
        <Text label="毎月の支払日" type="number" min="1" max="31" value={v.支払日}
              onChange={(x) => set('支払日')(Number(x) || '')}
              hint="その月に無い日は末日にします" />
      </div>
      <Text label="支払い開始月" type="month" value={既定開始} onChange={set('開始月')}
            hint="空のままなら契約日の翌月から始めます" />
      <Text label="メモ" value={v.メモ} onChange={set('メモ')} />

      {v.月々の金額 > 0 && v.回数 > 0 && (
        <Note kind="ok">
          支払総額 <b>{yen(v.月々の金額 * v.回数)}円</b>（月々 {yen(v.月々の金額)}円 × {v.回数}回）
          {既定開始 && ` ／ ${ymd(既定開始)} から`}
        </Note>
      )}
      <Err>{err}</Err>
    </Modal>
  );
}
