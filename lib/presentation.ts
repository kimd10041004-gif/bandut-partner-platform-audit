import { z } from 'zod';
import { serviceGroups } from './policy';

export const widgetLabels = { film: '브랜드 영상', promise: '접수 전 안내', extra: '추가공임 안내' } as const;
export const numberFields = {
  headingSize: { label: '메인 제목 크기', unit: 'px', min: 24, max: 44, step: 1 },
  cardGap: { label: '분야 카드 간격', unit: 'px', min: 8, max: 28, step: 1 },
  visitFee: { label: '방문 1회 출장비', unit: '원', min: 0, max: 1000000, step: 1000 },
  extraFee: { label: '1인 30분 추가공임', unit: '원', min: 0, max: 1000000, step: 1000 },
  minimum: { label: '최소 결제 안내', unit: '원', min: 0, max: 10000000, step: 1000 },
  purchaseFee: { label: '기본 자재 대행비', unit: '원', min: 0, max: 1000000, step: 1000 },
} as const;
export type NumberField = keyof typeof numberFields;
const integer = (key: NumberField) => z.number().int().min(numberFields[key].min).max(numberFields[key].max);
export const presentationSchema = z.object({
  title: z.string().trim().min(2).max(70),
  subtitle: z.string().trim().min(5).max(160),
  headingSize: integer('headingSize'), cardGap: integer('cardGap'),
  visitFee: integer('visitFee'), extraFee: integer('extraFee'), minimum: integer('minimum'), purchaseFee: integer('purchaseFee'),
  groups: z.array(z.string()).length(serviceGroups.length).refine(v => new Set(v).size === serviceGroups.length && v.every(n => serviceGroups.some(g => g.name === n)), '작업 분야를 중복·누락 없이 배치해 주세요.'),
  widgets: z.array(z.object({ id: z.enum(['film', 'promise', 'extra']), visible: z.boolean() }).strict()).length(3).refine(v => new Set(v.map(w => w.id)).size === 3, '안내 카드가 중복되거나 누락되었습니다.'),
}).strict();
export type Presentation = z.infer<typeof presentationSchema>;
export interface SavedPresentation { data: Presentation; revision: number; updatedAt: string | null }
export const defaultPresentation: Presentation = {
  title: '우리 집부터 사업장까지,\n공간의 일을 반듯하게.',
  subtitle: '수리·설치부터 인테리어·복구·관리까지.\n전국의 작업 요청과 적합한 파트너를 연결합니다.',
  headingSize: 32, cardGap: 12, visitFee: 20000, extraFee: 20000, minimum: 150000, purchaseFee: 30000,
  groups: serviceGroups.map(g => g.name),
  widgets: [{ id: 'film', visible: true }, { id: 'promise', visible: true }, { id: 'extra', visible: true }],
};
export function presentationChanges(before: Presentation, after: Presentation) {
  const changes: { label: string; before: string; after: string }[] = [];
  for (const key of ['title', 'subtitle'] as const) if (before[key] !== after[key]) changes.push({ label: key === 'title' ? '메인 제목' : '메인 설명', before: before[key], after: after[key] });
  for (const key of Object.keys(numberFields) as NumberField[]) if (before[key] !== after[key]) {
    const f = numberFields[key];
    changes.push({ label: f.label, before: before[key].toLocaleString('ko-KR') + f.unit, after: after[key].toLocaleString('ko-KR') + f.unit });
  }
  if (before.groups.join() !== after.groups.join()) changes.push({ label: '작업 분야 순서', before: before.groups.join(' → '), after: after.groups.join(' → ') });
  const widgets = (d: Presentation) => d.widgets.map(w => widgetLabels[w.id] + (w.visible ? '' : ' (숨김)')).join(' → ');
  if (widgets(before) !== widgets(after)) changes.push({ label: '안내 카드 배치', before: widgets(before), after: widgets(after) });
  return changes;
}
