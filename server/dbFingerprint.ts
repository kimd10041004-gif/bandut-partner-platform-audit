/**
 * 이 배포가 어느 DB를 보는지, 비밀을 흘리지 않고 말한다 (29-11).
 *
 * ## 왜 필요한가
 *
 * 프리뷰에서 계정을 만들어 가입→승인→권한까지 확인해야 하는데, 그 프리뷰가 **운영 DB를 보고 있으면**
 * 테스트 계정이 운영 데이터에 섞인다. 그래서 "분리됐는가"를 먼저 확인하기 전에는 쓰기가 생기는
 * 검증을 하지 않는다. 확인할 방법이 없어 그 자리에서 멈춰 있었다.
 *
 * `resolveDatabaseUrl`(29-5)이 프리뷰용 이름(`DATABASE_URL_PREVIEW`)을 이미 고른다. 남은 것은
 * **골라진 결과를 사람이 볼 수 있게** 하는 일이다.
 *
 * ## 무엇을 내주고 무엇을 안 내주나
 *
 * 호스트와 DB 이름만 준다. 사용자·비밀번호·쿼리 문자열은 파싱 단계에서 버린다 — 만들지 않으니
 * 실수로 로그에 남을 수도 없다.
 *
 * ## 이 파일은 운영과 비교할 수 없다 (29-17-2)
 *
 * 한동안 이 파일은 프리뷰에서 고른 값을 `DATABASE_URL` 과 비교해 놓고 화면에 **"운영과 같음/다름"**
 * 이라고 썼다. 틀린 말이었다. 프리뷰 배포가 보는 `DATABASE_URL` 은 **Preview 환경에 걸린 값**이지
 * Production 환경의 값이 아니다. 배포는 자기 환경의 변수만 받는다 — 프리뷰에서 운영 환경변수를
 * 읽을 방법이 애초에 없다. 그러니 그 비교로는 운영을 말할 자격이 없다.
 *
 * 게다가 비교 대상이 아예 없을 때도 "다름"이라고 단정했다. `DATABASE_URL` 이 비어 있으면 빈 주소와
 * 비교해 놓고 다르다고 답했다. **없는 것과 다른 것은 다르다.**
 *
 * 그래서 이 파일이 말하는 것을 하나로 좁혔다.
 *
 *   differentFromFallback   지금 붙은 곳이 **이 배포의 기본값**(`DATABASE_URL`)과 다른 곳인가
 *
 * 기본값이 없으면 `null` 이다 — 모른다고 말한다. 그리고 이것은 여전히 **주소 비교일 뿐**이라
 * 데이터가 갈라졌다는 뜻이 아니다. 서로 다른 주소가 같은 데이터를 가리킬 수 있다(읽기 전용
 * 복제본, 같은 클러스터의 별칭, 풀러와 직결 엔드포인트).
 *
 * **운영과 갈라졌는지는 표식만이 답한다** — `server/dbProbe.ts`. 프리뷰에 표식을 남기고 운영 쪽에
 * 그 표식이 없는 것을 사람이 확인한다. 그 절차만이 두 환경을 실제로 대조한다.
 *
 * 이 값은 **관리자만** 본다(`handlers/auth.ts`의 `dbInfo`, 열람 등급). 공개 주소에 진단을 걸지
 * 않는다.
 */

/** 접속 지점 — 호스트와 DB 이름뿐이다. 자격 증명은 담기지 않는다 */
export interface DbPlace {
  host: string
  database: string
}

export interface DbFingerprint {
  /** Vercel이 말하는 이 배포의 환경. 로컬·CI에는 없다 */
  deployEnv: string
  /** 접속 호스트 — Neon은 브랜치마다 다르다 */
  host: string
  /** DB 이름 */
  database: string
  /** 프리뷰 전용 이름(`DATABASE_URL_PREVIEW`)이 실제로 쓰였는가 */
  usingPreviewUrl: boolean
  /**
   * 이 배포의 **기본값**(`DATABASE_URL`)이 가리키는 곳. 설정돼 있지 않으면 `null`.
   *
   * 프리뷰 배포에서 이 값은 **Preview 환경에 걸린 `DATABASE_URL`** 이다. 운영 환경의 값이 아니다.
   */
  fallback: DbPlace | null
  /**
   * 지금 붙은 곳이 기본값과 **다른 곳**인가. 비교할 기본값이 없으면 `null`(모른다).
   *
   * 운영과의 비교가 아니다 — 프리뷰 배포는 운영 환경변수를 볼 수 없다. 그리고 주소가 다른 것은
   * 데이터 분리의 **필요조건이지 충분조건이 아니다.** 분리는 표식으로 확인한다(`dbProbe.ts`).
   */
  differentFromFallback: boolean | null
}

/** 호스트와 DB 이름만 꺼낸다. 자격 증명은 애초에 만들지 않는다 */
function placeOf(url: string | undefined): DbPlace {
  if (url === undefined || url === '') return { host: '', database: '' }
  try {
    const u = new URL(url)
    return { host: u.host, database: u.pathname.replace(/^\//, '') }
  } catch {
    // 형식이 깨진 값 — 내용을 되비추지 않는다(그 자체가 비밀일 수 있다)
    return { host: '(읽을 수 없는 형식)', database: '' }
  }
}

function isSet(url: string | undefined): url is string {
  return url !== undefined && url !== ''
}

function same(a: DbPlace, b: DbPlace): boolean {
  return a.host === b.host && a.database === b.database
}

export function dbFingerprint(env: NodeJS.ProcessEnv, resolved: string | undefined): DbFingerprint {
  const deployEnv = env['VERCEL_ENV'] ?? '(로컬·CI)'
  const preview = env['DATABASE_URL_PREVIEW']
  const isPreview = env['VERCEL_ENV'] === 'preview'
  const here = placeOf(resolved)
  const usingPreviewUrl = isPreview && isSet(preview) && same(here, placeOf(preview))

  // 비교할 짝이 있어야 비교한다. 기본값이 없으면 "다름"이 아니라 "모름"이다 — 없는 것과 다른
  // 것은 다르다. 그리고 이 비교는 **이 배포의 기본값**과의 비교지 운영과의 비교가 아니다.
  const fallbackUrl = env['DATABASE_URL']
  const fallback = isSet(fallbackUrl) ? placeOf(fallbackUrl) : null
  const comparable = isSet(resolved) && fallback !== null

  return {
    deployEnv,
    ...here,
    usingPreviewUrl,
    fallback,
    differentFromFallback: comparable ? !same(here, fallback) : null,
  }
}
