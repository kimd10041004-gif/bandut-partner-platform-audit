'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CalendarDays, MapPin, ShieldCheck, ArrowRight } from 'lucide-react';
import { api, won } from '@/lib/client';
import type { Presentation, SavedPresentation } from '@/lib/presentation';
import { BrandFilms } from './brand-films';

export function usePresentation(initial: SavedPresentation | null = null) {
  const [saved, setSaved] = useState<SavedPresentation | null>(initial);
  const [error, setError] = useState('');
  async function reload() {
    try { const value = await api<SavedPresentation>('presentation'); setSaved(value); setError(''); return value; }
    catch (e) { setError((e as Error).message); return null; }
  }
  useEffect(() => { let active = true; api<SavedPresentation>('presentation').then(v => { if (active) setSaved(v); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  return { saved, setSaved, error, reload };
}
export function PresentationLoading({ error, retry }: { error: string; retry: () => void }) {
  return <div className="loading-panel" role={error ? 'alert' : 'status'}>{error ? <>화면 설정을 불러오지 못했습니다. <button className="btn secondary" onClick={retry}>다시 불러오기</button></> : '화면을 준비하고 있습니다…'}</div>;
}
export function presentationStyle(data: Presentation): CSSProperties {
  return { '--presentation-heading': `${data.headingSize / 16}rem`, '--presentation-gap': `${data.cardGap / 16}rem` } as CSSProperties;
}
export function RequestIntro({ data }: { data: Presentation }) {
  return <section className="intro photo-intro presentation-intro" style={presentationStyle(data)}><Image unoptimized priority width={910} height={512} className="intro-background" src="/brand/inspection.webp" alt=""/><div><div className="service-kicker"><span className="line"/>전국 작업 접수 · 반듯한 공간 서비스</div><h1>{data.title}</h1><p>{data.subtitle}</p></div><div className="intro-note"><ShieldCheck size={22}/><span>사진 기준 사전예상, 방문 후 확정<strong>동의 없는 추가 작업은 없습니다.</strong></span></div></section>;
}
export function RequestAside({ data }: { data: Presentation }) {
  if (!data.widgets.some(w => w.visible)) return null;
  return <aside className="request-aside">{data.widgets.filter(w => w.visible).map(w => <div key={w.id} data-presentation-widget={w.id}>{w.id === 'film' ? <BrandFilms/> : w.id === 'promise' ? <article className="promise-card"><span className="eyebrow">BEFORE YOU REQUEST</span><h3>처음이어도, 안심할 수 있게</h3><div><MapPin/><p><strong>방문 일정 사전 안내</strong><span>지역과 작업 내용에 맞는 파트너의 방문 가능 여부 확인</span></p></div><div><CalendarDays/><p><strong>같은 방문, 출장비는 한 번</strong><span>직영 방문 1회당 {won(data.visitFee)} · VAT 포함</span></p></div><div><ShieldCheck/><p><strong>견적 확인 후 직접 선택</strong><span>작업 범위와 포함·제외 항목을 비교하세요</span></p></div><Link href="/services">서비스·가격 자세히 보기 <ArrowRight size={16}/></Link></article> : <p className="aside-caption">추가공임 1인 30분당 {won(data.extraFee)}<br/>작업 범위 변경은 사전 동의 후 진행합니다.</p>}</div>)}</aside>;
}
export function PriceGuide({ data }: { data: Presentation }) {
  return <section className="panel"><h2>소규모 직영 작업 기본 안내</h2><dl className="price-table">{[
    ['출장비', `방문 1회당 ${won(data.visitFee)}`, '같은 방문의 여러 작업은 출장비 1회만 합산'],
    ['추가공임', `1인 30분당 ${won(data.extraFee)}`, '2인 작업은 인원수에 비례 · 사전 동의 후 진행'],
    ['최소 결제', won(data.minimum), '작업과 자재 조건을 확인한 후 최종 견적 안내'],
    ['자재 구매 대행', `기본 대행비 ${won(data.purchaseFee)}`, '특수 자재 화물비는 별도 사전 안내'],
  ].map(([label, value, description]) => <div key={label}><dt>{label}</dt><dd><strong>{value}</strong><span>{description}</span></dd></div>)}</dl><p className="small muted">소규모 직영 작업의 VAT 포함 기본 안내입니다. 최종 금액은 개별 견적·계약에서 확인해 주세요. 큰 공사와 중개 작업은 파트너의 포함·제외 항목 및 총액을 기준으로 합니다.</p></section>;
}
