import { readFileSync } from 'node:fs'
import type { NextConfig } from 'next'

// 29-4: 라운드 표기는 package.json version이 단일 출처다(README, 29-1에서 하드코딩 제거).
// 런타임에는 npm_package_version이 없으므로 빌드 시점에 읽어 넘긴다.
const version = (JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string }).version
const round = version.split('.').slice(0, 2).join('-')

const nextConfig: NextConfig = {
  // 29-3: Next.js는 기본으로 루트 tsconfig.json을 자기 것으로 정규화한다. 이 저장소는 프로젝트가 셋이라
  // (Next 앱 · 옛 SPA · 우리 서버 코드) 그러면 서로의 설정을 덮어쓴다. 그래서 Next에게 전용 파일을 준다.
  typescript: { tsconfigPath: 'tsconfig.next.json' },
  env: {
    // 배포 확인(deploy-check)이 라이브 HTML에서 이 둘을 찾는다.
    BANDUT_ROUND: round,
    // 28-87의 인증 모드 표식. 새 셸에는 **로컬 모드가 없다** — 신원은 언제나 서버 세션에서 온다(29-2).
    // 그래서 조건이 아니라 상수다. 옛 SPA는 빌드 플래그로 둘 중 하나였다.
    BANDUT_AUTH_MODE_MARK: 'bandut-auth-mode:server',
  },
  // 29-8: 공간 스튜디오. public/ 의 파일은 정확한 경로로만 서빙되므로 `/interior/index.html`은
  // 열리지만 `/interior/`는 앱 라우터의 catch-all로 떨어져 404가 된다. 화면 다섯 자리가 부르는
  // 주소는 `/interior/`다 — 그 주소를 파일로 잇는다. 슬래시 없는 `/interior`도 같이 받는다.
  async rewrites() {
    return [
      { source: '/interior', destination: '/interior/index.html' },
      { source: '/interior/', destination: '/interior/index.html' },
    ]
  },
}

export default nextConfig
