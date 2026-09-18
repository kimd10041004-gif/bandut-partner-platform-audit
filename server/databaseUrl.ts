/**
 * 어느 DB에 붙을지 고른다 (29-5).
 *
 * ## 왜 이름이 둘인가
 *
 * 프리뷰 배포가 **운영 DB를 그대로 본다**. 그러면 검증하려고 만든 테스트 계정이 운영 데이터에 섞인다.
 * 보통은 Vercel에서 `DATABASE_URL`의 Preview 값만 다른 것으로 바꾸면 되는데, 이 프로젝트에서는 그게
 * 막힌다 — `DATABASE_URL`은 **Neon 연동이 만들고 소유하는 변수**라 Production과 Preview 양쪽에
 * 걸려 있고, 사람이 환경을 떼거나 같은 이름을 덮어쓸 수 없다. 브랜치를 지정해도 거부된다
 * (`A variable with the name DATABASE_URL already exists...`).
 *
 * 그래서 **이름을 하나 더 둔다.** 연동이 모르는 이름이라 충돌하지 않는다.
 *
 * ## 규칙
 *
 * 프리뷰 배포에서 `DATABASE_URL_PREVIEW`가 설정돼 있으면 그것을 쓰고, 그 밖에는 언제나
 * `DATABASE_URL`을 쓴다. 프리뷰인지는 Vercel이 주는 `VERCEL_ENV`로 판정한다(`'preview'`).
 *
 * **운영은 이 함수로 인해 달라질 수 없다.** `VERCEL_ENV`가 `'production'`이면 첫 줄에서 끝나므로
 * 프리뷰용 값이 실수로 운영에 새어 들어가는 경로가 없다. 로컬·CI에는 `VERCEL_ENV`가 없어서
 * 역시 `DATABASE_URL`만 본다 — 게이트가 보는 것과 운영이 보는 것이 같다는 뜻이다.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  if (env['VERCEL_ENV'] === 'preview') {
    const preview = env['DATABASE_URL_PREVIEW']
    if (preview !== undefined && preview !== '') return preview
  }
  return env['DATABASE_URL']
}
