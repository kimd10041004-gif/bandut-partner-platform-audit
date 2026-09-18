import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlatform } from '../app/PlatformContext'
import { readOverwritten, clearOverwritten, overwrittenChars, OVERWRITTEN_KEY } from '../app/bootstrap'
import { downloadText } from './download'

/**
 * 덮인 변경 보관함 (28-72-03 · 28-73-04 · **28-75-04**).
 *
 * 보관은 **모든 기기**에서 일어난다 — conflict는 파트너 기기에서도 고객 기기에서도 난다. 그런데 28-74·28-75는
 * 꺼내는 화면을 관리자 설정 한 곳에만 두었다. 보관함은 그 브라우저의 것이라 서버로 올라가지 않으므로,
 * 관리자가 자기 자리에서 남의 기기 것을 꺼내 줄 수도 없다 — **그 자리의 사람만 꺼낼 수 있다.**
 * 그래서 역할과 무관한 부품으로 빼서 마이페이지·설정 어디에나 놓는다.
 *
 * 렌더마다 최대 1MB를 파싱하지 않는다: `overwrittenChars()`로 **길이만** 보고 달라졌을 때만 다시 읽는다
 * (28-74 리뷰). 갱신 계기는 이 탭의 복제 상태·동기화 안내 변화와 다른 탭의 `storage` 이벤트다.
 */
export default function OverwrittenBox({ restoreHint }: { restoreHint: string }) {
  const { refresh, syncNotice, replicationStatus } = usePlatform()
  const [overwritten, setOverwritten] = useState(() => readOverwritten())
  const [msg, setMsg] = useState('')
  const stashChars = useRef(overwrittenChars())

  const syncStash = useCallback(() => {
    const chars = overwrittenChars()
    if (chars === stashChars.current) return
    stashChars.current = chars
    setOverwritten(readOverwritten())
  }, [])
  // 보관은 복제기가 원격을 받아들이기 직전에만 일어난다 — 그 순간 복제 상태·동기화 안내가 바뀐다
  useEffect(syncStash, [syncStash, syncNotice, replicationStatus])
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === OVERWRITTEN_KEY) syncStash()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [syncStash])

  if (overwritten.length === 0) return null

  const doExport = (entry: { at: string; body: string }) => {
    downloadText(`banded-overwritten-${entry.at.slice(0, 10)}.json`, entry.body, 'application/json')
    setMsg(`덮였던 이 기기의 변경(${entry.at})을 내려받았습니다 — ${restoreHint}`)
  }

  const doClear = () => {
    clearOverwritten()
    stashChars.current = 0
    setOverwritten([])
    setMsg('덮인 변경 보관함을 비웠습니다 — 저장 용량이 그만큼 돌아옵니다')
    refresh()
  }

  return (
    <div className="overwritten-box" data-overwritten-list={overwritten.length} style={{ marginTop: 10 }}>
      <div className="meta">
        <strong>덮인 변경 보관함 {overwritten.length}건</strong> — 다른 기기의 변경을 받아들이며 이 기기에서 반영되지
        않았던 내용입니다. 이 기기에만 있으므로 <strong>여기서만</strong> 꺼낼 수 있습니다. 보관함도 저장 용량을 쓰므로
        다 쓴 것은 비우세요.
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
        {overwritten.map((e) => (
          <li
            key={e.at}
            className="row"
            style={{ justifyContent: 'flex-start', gap: 8, marginTop: 4, flexWrap: 'wrap' }}
          >
            <span className="meta">
              {e.at} · {Math.round(e.body.length / 1024).toLocaleString('ko-KR')}KB
            </span>
            <button className="btn-secondary" data-export-overwritten onClick={() => doExport(e)}>
              내려받기
            </button>
          </li>
        ))}
      </ul>
      <div className="row" style={{ justifyContent: 'flex-start', marginTop: 6 }}>
        <button className="btn-secondary" data-clear-overwritten onClick={doClear}>
          보관함 비우기
        </button>
      </div>
      {msg && (
        <div className="meta" style={{ marginTop: 6 }} data-overwritten-msg>
          {msg}
        </div>
      )}
    </div>
  )
}
