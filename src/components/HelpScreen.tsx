import { useState } from 'react'

// ★ GoogleフォームのURLをここに設定するだけで接続完了
const FEEDBACK_URL = '' // 例: 'https://forms.gle/xxxxxxxxxx'

interface Props {
  open: boolean
  onClose: () => void
}

const FAQ = [
  {
    q: '時刻表が古い情報を表示している',
    a: '右上の更新ボタン（↺）をタップしてください。NetworkFirstキャッシュを破棄して最新のデータを取得します。それでも改善しない場合はメニューの「アプリの初期化」をお試しください。',
  },
  {
    q: 'オフラインでも時刻表は見られますか？',
    a: 'はい。一度読み込んだ時刻表データはオフラインでも参照できます。地図もキャッシュ済みのタイルを表示します。ただしネット接続がない場合、更新ボタンによるデータ更新はご利用いただけません。',
  },
  {
    q: 'ホーム画面への追加方法は？',
    a: 'iOSの場合：Safariで開き、共有ボタン →「ホーム画面に追加」を選択してください。Androidの場合：Chromeのメニュー →「ホーム画面に追加」を選択してください。',
  },
  {
    q: '現在地からのルート案内が開かない',
    a: '「現在地からのルートを見る」ボタンはお使いのスマホの標準マップアプリ（Google マップ / Apple マップ）を起動します。マップアプリがインストールされていない場合はご利用いただけません。',
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
    if (FEEDBACK_URL) {
      window.open(FEEDBACK_URL, '_blank', 'noopener noreferrer')
    } else {
      alert('フィードバックフォームは現在準備中です。')
    }
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg-page)', transform: open ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.32s cubic-bezier(.4,0,.2,1), background 0.35s', zIndex: 50, display: 'flex', flexDirection: 'column', borderRadius: 44, overflow: 'hidden' }}>
      {/* ナビバー */}
      <div style={{ background: 'var(--bg-card)', padding: '52px 18px 14px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '.5px solid var(--border2)', flexShrink: 0, transition: 'background 0.35s' }}>
        <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#10b981', fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: '4px 0' }}>
          <svg width="10" height="16" viewBox="0 0 10 16" fill="none"><path d="M8.5 1.5L1.5 8L8.5 14.5" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          戻る
        </button>
        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-.3px' }}>ヘルプ</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* バナー */}
        <div style={{ background: 'linear-gradient(135deg,#0d9966,#34d399)', borderRadius: 20, padding: '25px 20px', color: '#fff', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>スクールバス時刻表</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.8)' }}>福山大学 ver {__APP_VERSION__}</div>
        </div>

        {/* FAQ */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1.1px', textTransform: 'uppercase', padding: '0 4px 8px' }}>よくある質問</div>
          <div style={{ background: 'var(--bg-card)', borderRadius: 18, overflow: 'hidden', transition: 'background 0.35s' }}>
            {FAQ.map((faq, i) => (
              <div key={i} style={{ borderBottom: i < FAQ.length - 1 ? '.5px solid var(--border)' : 'none' }}>
                <div onClick={() => toggleFaq(i)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '15px 16px', cursor: 'pointer' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{faq.q}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', transition: 'transform 0.22s', transform: openFaqs.has(i) ? 'rotate(180deg)' : '' }}>▼</span>
                </div>
                {openFaqs.has(i) && (
                  <div style={{ padding: '0 16px 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
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
              {FEEDBACK_URL ? 'Googleフォームで回答を受け付けます' : '回答はGoogleフォームで受け付けます（準備中）'}
            </p>
          </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>
          福山大学 スクールバス時刻表アプリ ver 1.0.0
        </p>
      </div>
    </div>
  )
}
