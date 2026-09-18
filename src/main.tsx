import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'

// 28-29-01: 역할별 경로 주소 — /partner·/admin 진입을 해시 앱으로 번역 (App 렌더 전에 실행).
// 정적 호스팅에서는 vercel.json rewrite가 이 경로들에 index.html을 서빙한다.
{
  const path = window.location.pathname.replace(/\/+$/, '')
  if (path === '/partner' || path === '/admin') {
    window.history.replaceState(null, '', '/')
    window.location.hash = `#${path}`
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
