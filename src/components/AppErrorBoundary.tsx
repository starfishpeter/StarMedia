import { Component, type ErrorInfo, type ReactNode } from 'react'

type AppErrorBoundaryProps = { children: ReactNode }
type AppErrorBoundaryState = { error: Error | null }

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Renderer render failure', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="app-error-boundary" role="alert">
        <section>
          <p>StarMedia 页面未能加载。</p>
          <small>{this.state.error.message || '发生未知渲染错误。'}</small>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </section>
      </main>
    )
  }
}
