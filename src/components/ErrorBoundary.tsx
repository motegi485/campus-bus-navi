import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('アプリでエラーが発生しました:', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: 24,
          textAlign: 'center',
          background: 'var(--bg-page)',
          color: 'var(--text-primary)',
        }}
      >
        <p style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>
          問題が発生しました
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          お手数ですが、再読み込みをお試しください。
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 24px',
            borderRadius: 999,
            background: '#0ea5e9',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          再読み込み
        </button>
      </div>
    )
  }
}
