import { useEffect, useRef } from 'react'

interface OverlayLayer {
  /** このレイヤーが開いているか */
  open: boolean
  /** 戻る操作でこのレイヤーを閉じる */
  close: () => void
}

/**
 * フルスクリーン・オーバーレイのスタックを、ブラウザの戻る操作
 * （Android のジェスチャー/ハードウェア戻るボタンなど）と連動させる。
 *
 * layers は最前面から順に渡す（実際の z-index の高い順。App.tsx のコメントにある
 * ドロワー30 < 各画面50 < PWA案内100 の順）。開いているレイヤー数が増えるたびに
 * history entry を1つ積み、UI操作（×ボタン・Escape）で閉じられて減った分は
 * history.back() で消費して履歴を同期させる。popstate（戻る操作）を受けたら、
 * 配列の先頭から見て最初に開いているレイヤーを閉じる。
 *
 * 各画面の useOverlayA11y が Escape での「閉じる」を個別に担うのと対になる、
 * ジェスチャー版の「閉じる」。対象は App が持つ最上位のオーバーレイ（ドロワー・
 * お知らせ・週間ダイヤ・設定・ヘルプ・PWA案内）のみで、各画面内部のサブパネル
 * （詳細ビュー・選択リスト等）は対象外。
 *
 * history.back() は非同期（結果の popstate は別タスクで発火する）。UI操作で
 * 閉じた分を back() で消費している最中に、その popstate を「本物の戻る操作」と
 * 誤認して次のレイヤー（例: ドロワー）まで連鎖して閉じてしまわないよう、
 * 「自分が呼んだ back() の数」をカウンタで持ち、対応する popstate が来るまで
 * 素通りさせる。
 */
export function useOverlayBackGesture(layers: OverlayLayer[]): void {
  const layersRef = useRef(layers)
  layersRef.current = layers

  const depthRef = useRef(0)
  const pendingSelfPopsRef = useRef(0)

  // layers は毎レンダー新規の配列なので、open の並びを文字列化した値を依存に使い、
  // 実際に開閉状態が変わったときだけ実行する
  const openKey = layers.map(l => (l.open ? '1' : '0')).join('')

  useEffect(() => {
    const depth = layersRef.current.filter(l => l.open).length
    const prevDepth = depthRef.current
    depthRef.current = depth

    if (depth > prevDepth) {
      // 開いた: 増えた分だけ history entry を積む
      for (let i = prevDepth; i < depth; i++) {
        window.history.pushState({ overlayDepth: i + 1 }, '')
      }
    } else if (depth < prevDepth) {
      // UI 操作（×ボタン・Escape）で閉じた: 積んであった entry を消費する。
      // 結果の popstate は自分自身の分として後でカウンタから引く。
      const closedCount = prevDepth - depth
      pendingSelfPopsRef.current += closedCount
      for (let i = 0; i < closedCount; i++) {
        window.history.back()
      }
    }
  }, [openKey])

  useEffect(() => {
    const onPopState = () => {
      if (pendingSelfPopsRef.current > 0) {
        // 自分が呼んだ history.back() の結果。UI側は既に閉じ終わっているので何もしない
        pendingSelfPopsRef.current -= 1
        return
      }
      const topmost = layersRef.current.find(l => l.open)
      topmost?.close()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
}
