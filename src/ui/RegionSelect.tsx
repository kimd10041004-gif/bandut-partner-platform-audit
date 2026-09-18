import { useEffect, useState } from 'react'
import { CITIES, DISTRICTS, formatRegion, parseRegion } from '../domain/catalog'

/**
 * 방문 지역 고르기 (28-92) — 전국 17 시·도 → 시·군·구. 값은 `"서울 강서구"` 한 문자열이다.
 * 요청 위저드와 고객의 요청 수정 폼이 같은 부품을 쓴다. 시·도만 고른 상태는 아직 지역이 아니므로
 * 빈 문자열을 올린다(세종처럼 시·군·구가 하나면 곧바로 채운다). 목록에 없는 옛 값(자유 입력)이
 * 들어오면 부모 값까지 비워(`onChange('')`) 다시 고르게 한다.
 */
export default function RegionSelect({
  value,
  onChange,
  labels = { city: '시·도', district: '시·군·구' },
}: {
  value: string
  onChange: (region: string) => void
  labels?: { city: string; district: string }
}) {
  const parsed = parseRegion(value)
  const [city, setCity] = useState(parsed?.city ?? '')
  // #251 리뷰: 부모가 값을 바꾸면(다른 요청을 편집) 시·도도 따라간다. 목록 밖의 옛 값은 화면만 비우면
  //   부모 값이 그대로 남아 "수정 저장"이 검증 없이 지나가므로, 부모 값도 비워 다시 고르게 한다.
  useEffect(() => {
    if (parsed !== undefined) {
      if (parsed.city !== city) setCity(parsed.city)
    } else if (value.trim() !== '') {
      setCity('')
      onChange('')
    }
  }, [value])
  const district = parsed !== undefined && parsed.city === city ? parsed.district : ''
  const districts = city === '' ? [] : (DISTRICTS[city] ?? [])
  return (
    <div className="region-select">
      <select
        value={city}
        aria-label={labels.city}
        onChange={(e) => {
          const next = e.target.value
          setCity(next)
          const list = next === '' ? [] : (DISTRICTS[next] ?? [])
          const only = list.length === 1 ? list[0] : undefined
          onChange(only !== undefined ? formatRegion(next, only) : '')
        }}
      >
        <option value="">시·도 선택</option>
        {CITIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        value={district}
        aria-label={labels.district}
        disabled={city === ''}
        onChange={(e) => onChange(e.target.value === '' ? '' : formatRegion(city, e.target.value))}
      >
        <option value="">시·군·구 선택</option>
        {districts.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    </div>
  )
}
