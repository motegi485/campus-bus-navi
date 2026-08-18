import { useState, useEffect } from 'react'
import { useOverlayA11y } from '../hooks/useOverlayA11y'
import { FEEDBACK_URL } from '../constants/links'

interface Props {
  open: boolean
  onClose: () => void
}

const FAQ = [
  {
    q: 'バスの発車前に通知を受け取りたい',
    a: '2 段階の操作で設定します。\n\n1. メニューの「表示・通知オプション」を開き、「発車リマインダー」をオンにします。ここで通知の許可を求められます。\n2. ホームの「本日の全時刻表」を開き、「通知を設定」をタップします。何分前に通知するかを選び、通知したい便の時刻をタップして保存してください。複数の便を選べます。\n\n設定した便には、時刻表・「今後の発車時刻」・「次のバス」にベルの印が付きます。通知はアプリを閉じていても届きます。',
  },
  {
    q: '通知はいつまで有効ですか？',
    a: '設定したその日限りです。日付が変わると自動的に解除されます。ダイヤは日によって変わるため、翌日以降の便を先に予約することはできません。乗りたい日の当日に設定してください。',
  },
  {
    q: '設定した通知をやめたい',
    a: '個別にやめる場合は、「本日の全時刻表」の「通知を変更」から、その便をもう一度タップして選択を外し、保存してください。すべて選択を外して保存すると、その日の通知をすべて解除できます。\n\nまとめてやめる場合は、「表示・通知オプション」の「発車リマインダー」をオフにしてください。設定済みの通知もすべて解除されます。',
  },
  {
    q: '通知を設定したのに届かなかった',
    a: '次の場合は、設計上あえて通知を送りません。\n\n・全便運休日\n・時刻を確定できない特別ダイヤの日\n・ダイヤが差し替わり、設定した時刻の便がなくなった日\n\n存在しない便をお知らせしないための動作です。\n\nそれ以外で届かない場合は、端末の通知設定でこのアプリが許可されているか、また Android の場合は省電力設定で制限されていないかをご確認ください。',
  },
  {
    q: '時刻表が古い情報を表示している',
    a: '右上の更新ボタン（↺）をタップしてください。キャッシュを破棄して最新のデータを取得します。それでも改善しない場合はメニューの「アプリの初期化」をお試しください。',
  },
  {
    q: 'オフラインでも時刻表は見られますか？',
    a: 'はい。一度読み込んだ時刻表データはオフラインでも参照できます。地図もキャッシュ済みのタイルを表示します。ただしネット接続がない場合、更新ボタンによるデータ更新はご利用いただけません。',
  },
  {
    q: 'ホーム画面への追加方法は？',
    a: 'iOSの場合：Safariで開き、共有ボタン →「ホーム画面に追加」を選択してください。\nAndroidの場合：Chromeのメニュー →「ホーム画面に追加」を選択してください。',
  },
  {
    q: '現在地からのルート案内が開かない',
    a: '「現在地からのルートを見る」ボタンはお使いのスマホの標準マップアプリ（Google マップ / Apple マップ）を起動します。マップアプリがインストールされていない場合はインストールしてください。',
  },
]

export function HelpScreen({ open, onClose }: Props) {
  const [openFaqs, setOpenFaqs] = useState<Set<number>>(new Set())

  const toggleFaq = (i: number) => {
    setOpenFaqs(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const handleFeedback = () => {
    window.open(FEEDBACK_URL, '_blank', 'noopener noreferrer')
  }

  useEffect(() => {
    if (!open) setOpenFaqs(new Set())
  }, [open])

  // 閉時の inert 化、開いた直後の初期フォーカス、閉時のフォーカス復帰、Esc で閉じる
  const rootRef = useOverlayA11y(open, { onEscape: onClose })

  return (
    /* fixed: ビューポート基準の全画面パネル。touchAction: NavBar 等起点の
       背後 body への貫通スクロールを防ぐ（詳細は DrawerMenu.tsx のコメント参照） */
    <div ref={rootRef} aria-hidden={!open} style={{ position: 'fixed', inset: 0, background: 'var(--bg-page)', transform: open ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.32s cubic-bezier(.4,0,.2,1), background 0.35s', zIndex: 50, display: 'flex', flexDirection: 'column', touchAction: 'pinch-zoom' }}>
      {/* ナビバー */}
      <div style={{ background: 'var(--bg-card)', padding: '52px 18px 14px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '.5px solid var(--border2)', flexShrink: 0, transition: 'background 0.35s' }}>
        <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#10b981', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: '4px 0' }}>
          <svg width="10" height="16" viewBox="0 0 10 16" fill="none"><path d="M8.5 1.5L1.5 8L8.5 14.5" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          戻る
        </button>
        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-.3px' }}>ヘルプ</span>
      </div>

      {/* スクローラ（contain + 常時スクロール可能化。露出色 = --bg-page） */}
      <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <div style={{ minHeight: 'calc(100% + 1px)', padding: '20px 16px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* バナー */}
        <div style={{ background: 'linear-gradient(135deg,#0d9966,#34d399)', borderRadius: 20, padding: '25px 20px', color: '#fff', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>スクールバス時刻表</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.8)' }}>ver {__APP_VERSION__}</div>
        </div>

        {/* FAQ */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1.1px', textTransform: 'uppercase', padding: '0 4px 8px' }}>よくある質問</div>
          <div style={{ background: 'var(--bg-card)', borderRadius: 18, overflow: 'hidden', transition: 'background 0.35s' }}>
            {FAQ.map((faq, i) => (
              <div
                key={i}
                style={{ borderBottom: i < FAQ.length - 1 ? '.5px solid var(--border)' : 'none' }}
              >
                <button type="button" onClick={() => toggleFaq(i)} aria-expanded={openFaqs.has(i)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '15px 16px', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', font: 'inherit', cursor: 'pointer' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{faq.q}</span>
                  <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--text-muted)', transition: 'transform 0.22s', transform: openFaqs.has(i) ? 'rotate(180deg)' : '' }}>▼</span>
                </button>
                {openFaqs.has(i) && (
                  <div style={{ padding: '0 16px 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap'}}>
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* フィードバック — Googleフォーム接続口 */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1.1px', textTransform: 'uppercase', padding: '0 4px 8px' }}>お問い合わせ</div>
          <div style={{ background: 'var(--bg-card)', borderRadius: 20, padding: 20, transition: 'background 0.35s' }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>ご意見・不具合のご報告</p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
              アプリをより良くするためのご意見や、気になった不具合などをお気軽にお寄せください。いただいた内容は今後の改善に活用させていただきます。
            </p>
            <button
              onClick={handleFeedback}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: 14, background: 'linear-gradient(135deg,#0d9966,#34d399)', color: '#fff', fontSize: 14, fontWeight: 700, borderRadius: 14, border: 'none', cursor: 'pointer' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              フィードバックを送る
            </button>
            <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              Googleフォームで回答を受け付けます
            </p>
          </div>
        </div>
        </div>{/* / 内側ラッパー */}
      </div>
    </div>
  )
}
