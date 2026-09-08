import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Wordverse render failure', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="fatal-error" role="alert">
      <div className="fatal-error-card">
        <span className="fatal-error-mark">W</span>
        <h1>Wordverse 没能完成这次渲染</h1>
        <p>你的词库仍保存在本地。重新加载通常可以恢复界面，不会清空数据。</p>
        <details>
          <summary>查看错误信息</summary>
          <code>{this.state.error.message || this.state.error.name}</code>
        </details>
        <button onClick={() => window.location.reload()}>重新加载</button>
      </div>
    </main>
  }
}
