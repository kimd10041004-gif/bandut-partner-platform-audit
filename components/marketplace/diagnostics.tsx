'use client'
/**
 * 이 배포가 어느 DB를 보는지 보여 주는 화면 (29-11, 29-17에서 판정을 나눴다).
 *
 * 프리뷰에서 계정을 만들어 가입→승인→권한까지 확인하려면, 그 프리뷰가 **운영 DB를 보고 있지 않다**는
 * 것이 먼저 확인돼야 한다. 그 전까지는 쓰기가 생기는 검증을 하지 않기로 했다.
 *
 * ## 이 화면이 말할 수 있는 것과 없는 것 (29-17, 29-17-2에서 좁혔다)
 *
 * 한동안 이 화면은 **"운영과 같음/다름"** 이라고 썼다. 틀린 말이었다. 배포는 자기 환경의
 * 변수만 받으므로, 프리뷰 배포가 보는 `DATABASE_URL` 은 **Preview 환경에 걸린 값**이지 운영의
 * 값이 아니다. 프리뷰에서 운영 환경변수를 읽을 방법이 애초에 없다.
 *
 * 그래서 주소로 말하는 것은 한 줄로 줄였다 — **이 배포의 기본값과 다른 곳인가.** 비교할 기본값이
 * 없으면 모른다고 쓴다. 그리고 그것마저도 주소 비교라, 다른 주소가 같은 데이터를 가리킬 수 있다
 * (읽기 전용 복제본, 같은 클러스터의 별칭).
 *
 *   지금 붙은 곳    이 배포의 기본값과 다른가. 주소 비교일 뿐이다
 *   데이터 분리     표식으로 확인한다. 사람이 양쪽을 대조한다 — 이것만이 답한다
 *
 * 비밀은 담기지 않는다 — 서버가 호스트와 DB 이름만 만들어 보낸다(`server/dbFingerprint.ts`).
 * 관리자 등급까지 서버가 확인하므로, 이 주소를 알아도 로그인하지 않으면 아무것도 나오지 않는다.
 */
import { useCallback, useEffect, useState } from 'react'
import { dbInfo, dbProbe, type DbInfo } from '@/lib/auth-client'
import { PageHeading } from './shell'

export function Diagnostics() {
  const [info, setInfo] = useState<DbInfo | null>(null)
  const [error, setError] = useState('')
  const [probeError, setProbeError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    dbInfo()
      .then(setInfo)
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  return (
    <div className="workspace">
      <PageHeading
        eyebrow="DIAGNOSTICS"
        title="이 배포가 보는 저장소"
        description="프리뷰가 운영 데이터를 보고 있지 않은지 확인합니다. 비밀번호는 표시하지 않습니다."
      />
      {error !== '' && (
        <p className="error" role="alert" data-db-error>
          {error}
        </p>
      )}
      {info === null && error === '' && <p className="small muted">확인 중…</p>}
      {info !== null && (
        <>
          <div className="panel field-stack" data-db-info>
            <p>
              <strong>환경</strong> <span data-db-env>{info.deployEnv}</span>
            </p>
            <p>
              <strong>접속 호스트</strong> <span data-db-host>{info.host}</span>
            </p>
            <p>
              <strong>DB 이름</strong> <span data-db-name>{info.database}</span>
            </p>
            <p>
              <strong>이 배포의 기본값</strong>{' '}
              <span data-db-fallback>
                {info.fallback === null ? '설정돼 있지 않음' : `${info.fallback.host} / ${info.fallback.database}`}
              </span>
            </p>
            <p data-db-different-fallback={String(info.differentFromFallback)}>
              <strong>지금 붙은 곳</strong>{' '}
              {info.differentFromFallback === null
                ? '비교할 기본값이 없어 말할 수 없습니다'
                : info.differentFromFallback
                  ? '기본값과 다른 곳입니다'
                  : '기본값과 같은 곳입니다'}
            </p>
            {/* 29-17-2. 예전에 이 자리에 "운영과 같음/다름"이라고 썼다. 틀린 말이었다 — 배포는 자기
                환경의 변수만 받으므로 프리뷰가 보는 DATABASE_URL 은 Preview 환경의 값이다. */}
            <p className="small muted" data-db-no-prod-compare>
              <strong>이 화면은 운영과 비교하지 못합니다.</strong> 배포는 자기 환경의 변수만 받기 때문에, 이 배포가
              보는 기본값은 <strong>이 환경에 걸린 값</strong>이지 운영의 값이 아닙니다. 게다가 주소가 달라도 같은
              데이터를 가리킬 수 있습니다. 운영과 갈라졌는지는 아래 표식으로만 확인됩니다.
            </p>
            {info.deployEnv === 'preview' && !info.usingPreviewUrl && (
              <p className="small muted">
                이 프리뷰는 <strong>DATABASE_URL_PREVIEW</strong>를 쓰고 있지 않습니다. 프리뷰 전용 저장소(예: Neon의
                별도 브랜치)를 만들고 그 값을 Vercel의 Preview 환경에 설정해 주세요. 값은 이 화면에서 받지 않습니다.
              </p>
            )}
          </div>

          <div className="panel field-stack" data-db-probes>
            <h3>데이터 분리 확인</h3>
            <p className="small muted">
              프리뷰에서 표식을 하나 남긴 뒤, <strong>운영 쪽에 그 표식이 없는 것</strong>을 직접 확인해 주세요.
              있으면 같은 데이터입니다. 이 방법은 운영 접속 정보를 프리뷰로 가져오지 않습니다 — 양쪽이 각자 자기
              DB만 읽고, 대조는 사람이 합니다.
            </p>
            <p className="small muted">
              운영 배포에 아직 이 화면이 없다면, Neon 콘솔에서 운영 브랜치를 고르고{' '}
              <code>select id from diagnostic_probes where id = &apos;표식ID&apos;</code>를 읽기 전용으로 실행해
              같은 판정을 얻을 수 있습니다. 표 자체가 없으면(<code>to_regclass</code>가 비면) 그 자체로 갈라져
              있다는 뜻입니다.
            </p>
            {info.deployEnv === 'production' ? (
              <p className="small muted" data-db-probe-readonly>
                운영에서는 표식을 남기지 않습니다. 읽기만 합니다.
              </p>
            ) : (
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                data-db-probe-write
                onClick={async () => {
                  setBusy(true)
                  setProbeError('')
                  try {
                    await dbProbe()
                    load()
                  } catch (e) {
                    setProbeError((e as Error).message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {busy ? '남기는 중…' : '여기에 표식 남기기'}
              </button>
            )}
            {probeError !== '' && (
              <p className="error" role="alert" data-db-probe-error>
                {probeError}
              </p>
            )}
            {/* 조회 실패를 "없음"으로 접지 않는다 (29-17-1). 없음은 분리의 근거가 되는 답이라,
                못 읽은 것을 없다고 쓰면 같은 DB 를 보고 있어도 분리됐다고 말하게 된다. */}
            {info.probes === null ? (
              <p className="error" role="alert" data-db-probe-unknown>
                {info.error ?? '표식을 조회하지 못했습니다'} — <strong>&ldquo;없음&rdquo;이 아닙니다.</strong> 이
                결과로는 분리 여부를 판단하지 마세요.
              </p>
            ) : info.probes.length === 0 ? (
              <p className="small muted" data-db-probe-empty>
                이 저장소에는 표식이 없습니다. (조회는 성공했습니다)
              </p>
            ) : (
              <ul className="card-list">
                {info.probes.map((p) => (
                  <li key={p.id} className="small" data-db-probe={p.id}>
                    <strong>{p.id}</strong>
                    <span className="muted">
                      {' '}
                      · {p.deployEnv} · {p.createdAt.slice(0, 19).replace('T', ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
