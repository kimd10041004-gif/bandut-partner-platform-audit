import { Component, type ReactNode } from 'react'

/** 오류 격리 (28-13-03): 활성 탭의 예외가 앱 전체를 백화면으로 만들지 않게 한다.
 *  resetKey(활성 탭 키)가 바뀌면 오류 상태를 리셋해 다른 탭은 정상 동작한다. */
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="card">
          <h3>화면을 표시하지 못했습니다</h3>
          <div className="meta">예상하지 못한 오류가 발생했습니다. 다른 탭은 정상 동작합니다.</div>
          <div className="meta" style={{ marginTop: 6 }}>
            {String(this.state.error.message || this.state.error)}
          </div>
          <div className="row" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
            <button onClick={() => this.setState({ error: null })}>다시 시도</button>
            <button className="btn-secondary" onClick={() => window.location.reload()}>
              새로고침
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
