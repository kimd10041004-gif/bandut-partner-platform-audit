import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { authModeOf } from './build/authMode'

export default defineConfig({
  plugins: [react()],
  // 28-87-05: 모드를 **리터럴로** 박는다 — 배포 확인이 서빙 번들에서 읽는다.
  define: { __AUTH_MODE__: JSON.stringify(authModeOf(process.env)) },
})
