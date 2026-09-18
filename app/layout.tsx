import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata:Metadata={title:'반듯집수리 | 우리 집에 맞는 수리',description:'집수리 요청부터 견적 비교와 파트너 선택까지. 기술은 기본, 뒷정리는 감동.',icons:{icon:[{url:'/favicon.svg',type:'image/svg+xml'},{url:'/brand/favicon.png',type:'image/png'}]}};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#f5f5f7'};
// 29-4: v17 원본 중 계측을 위해 손댄 **유일한** 파일이다.
// 배포 확인(deploy-check)이 라이브가 어느 라운드인지, 어느 인증 모드인지 HTML에서 읽어야 한다 —
// 옛 SPA는 span.round[data-auth-mode][data-build]로 그 일을 했고(28-87), 그 자리를 여기로 옮긴다.
// 사람에게 보이지 않게 두되(hidden), 기계는 읽을 수 있게 남긴다.
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}<span hidden className="round" data-auth-mode="server" data-build={process.env.BANDUT_AUTH_MODE_MARK}>{process.env.BANDUT_ROUND}</span></body></html>}
