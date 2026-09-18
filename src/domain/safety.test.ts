import { describe, it, expect } from 'vitest'
import { assessSafety, safetyQuestions, needsScopeReview, EMPTY_SAFETY } from './safety'

describe('safetyQuestions (28-93)', () => {
  it('문·도어락·모름은 잠김+긴급, 설비·전기는 긴급만, 방충망·커튼·시설 설치는 둘 다 묻지 않는다', () => {
    expect(safetyQuestions(['문·도어락'])).toEqual({ lock: true, urgent: true })
    expect(safetyQuestions(['분야를 모르겠어요'])).toEqual({ lock: true, urgent: true })
    expect(safetyQuestions(['급배수·누수·설비'])).toEqual({ lock: false, urgent: true })
    expect(safetyQuestions(['전기·조명'])).toEqual({ lock: false, urgent: true })
    expect(safetyQuestions(['방충망'])).toEqual({ lock: false, urgent: false })
    expect(safetyQuestions(['커튼·블라인드', '생활·상업 시설 설치'])).toEqual({ lock: false, urgent: false })
    // 여러 분야면 합집합
    expect(safetyQuestions(['방충망', '문·도어락'])).toEqual({ lock: true, urgent: true })
  })
  it('범위 검토: 잠금·방충망·커튼·시설 설치만 제외', () => {
    expect(needsScopeReview(['방충망', '커튼·블라인드', '생활·상업 시설 설치', '문·도어락'])).toBe(false)
    expect(needsScopeReview(['방충망', '바닥·타일'])).toBe(true)
  })
})

describe('assessSafety (28-93)', () => {
  it('방충망 + 답 없음 → AUTO_PASS, 플래그 없음', () => {
    expect(assessSafety({ categories: ['방충망'], description: '거실 방충망 교체', answers: EMPTY_SAFETY })).toEqual({
      reviewStatus: 'AUTO_PASS',
      flags: [],
    })
  })
  it('묻는 질문에 답이 없으면 INCOMPLETE', () => {
    expect(() =>
      assessSafety({ categories: ['급배수·누수·설비'], description: '수전 교체', answers: EMPTY_SAFETY }),
    ).toThrow('안전 질문에 답해 주세요')
    expect(() =>
      assessSafety({
        categories: ['문·도어락'],
        description: '도어락 교체',
        answers: { isLocked: null, urgent: false, ack: false },
      }),
    ).toThrow('안전 질문에 답해 주세요')
  })
  it('묻지 않은 질문에 답이 있으면 거절', () => {
    expect(() =>
      assessSafety({
        categories: ['급배수·누수·설비'],
        description: '수전 교체',
        answers: { isLocked: false, urgent: false, ack: false },
      }),
    ).toThrow('질문 대상이 아닌 답변은 비워 주세요')
  })
  it('잠김·긴급이면 안내 확인(ack)이 필요하다', () => {
    expect(() =>
      assessSafety({
        categories: ['문·도어락'],
        description: '도어락 고장',
        answers: { isLocked: true, urgent: false, ack: false },
      }),
    ).toThrow('안전 안내 확인이 필요합니다')
    expect(
      assessSafety({
        categories: ['문·도어락'],
        description: '도어락 고장',
        answers: { isLocked: true, urgent: false, ack: true },
      }),
    ).toEqual({ reviewStatus: 'MANUAL_REVIEW', flags: ['LOCKOUT'] })
  })
  it('설명이 답과 어긋나면 RECHECK — 잠기지 않았다면서 "문이 잠겨", 긴급 아니라면서 "타는 냄새"', () => {
    expect(() =>
      assessSafety({
        categories: ['문·도어락'],
        description: '문이 잠겨서 못 들어가요',
        answers: { isLocked: false, urgent: false, ack: false },
      }),
    ).toThrow('문 잠김에 대한 설명과 답변을 다시 확인해 주세요')
    expect(() =>
      assessSafety({
        categories: ['전기·조명'],
        description: '콘센트에서 타는 냄새가 나요',
        answers: { isLocked: null, urgent: false, ack: false },
      }),
    ).toThrow('긴급 증상에 대한 설명과 답변을 다시 확인해 주세요')
    // 답이 긴급이면 같은 설명이 통과한다(플래그로 남는다)
    expect(
      assessSafety({
        categories: ['전기·조명'],
        description: '콘센트에서 타는 냄새가 나요',
        answers: { isLocked: null, urgent: true, ack: true },
      }),
    ).toEqual({ reviewStatus: 'MANUAL_REVIEW', flags: ['URGENT_SYMPTOM', 'WORK_SCOPE_REVIEW'] })
  })
  it('범위 검토 분야·모름은 답이 모두 아니오여도 MANUAL_REVIEW', () => {
    expect(
      assessSafety({
        categories: ['주방·욕실 공사'],
        description: '세면대 교체',
        answers: { isLocked: null, urgent: false, ack: false },
      }),
    ).toEqual({ reviewStatus: 'MANUAL_REVIEW', flags: ['WORK_SCOPE_REVIEW'] })
    expect(
      assessSafety({
        categories: ['분야를 모르겠어요'],
        description: '집이 전체적으로 낡았어요',
        answers: { isLocked: false, urgent: false, ack: false },
      }),
    ).toEqual({ reviewStatus: 'MANUAL_REVIEW', flags: [] })
  })
  it('답변 형태가 어긋나면(문자열 등) 거절 — 스냅샷·API 값을 믿지 않는다', () => {
    expect(() =>
      assessSafety({
        categories: ['방충망'],
        description: '교체',
        answers: { isLocked: 'no', urgent: null, ack: false } as unknown as typeof EMPTY_SAFETY,
      }),
    ).toThrow('형식')
  })
})
