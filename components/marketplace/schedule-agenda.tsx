'use client';
import {useState} from 'react';
import Link from 'next/link';
import {CalendarDays,ArrowUpRight,MapPin} from 'lucide-react';
import {ko} from 'date-fns/locale';
import {Calendar} from '@/components/ui/calendar';
import type {Order} from '@/lib/model';
import {todayInKorea} from '@/lib/marketplace/date';
const dateKey=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function ScheduleAgenda({orders,mode}:{orders:Order[];mode:string}){
 const [day,setDay]=useState<Date>();
 const scheduled=orders.filter(o=>o.scheduled_date&&['BID_SELECTED','SCHEDULED','IN_PROGRESS','COMPLETION_REQUESTED','DISPUTED'].includes(o.status)).sort((a,b)=>a.scheduled_date!.localeCompare(b.scheduled_date!)||(a.scheduled_start??0)-(b.scheduled_start??0));
 const visible=scheduled.filter(o=>day?o.scheduled_date===dateKey(day):o.scheduled_date!>=todayInKorea());
 return <section className="agenda-panel"><div className="agenda-calendar"><div className="between"><h2><CalendarDays size={20}/>확정 방문 일정</h2>{day&&<button className="inline-link" onClick={()=>setDay(undefined)}>예정 전체</button>}</div><Calendar mode="single" locale={ko} selected={day} onSelect={setDay} defaultMonth={new Date(todayInKorea()+'T12:00:00')} modifiers={{booked:scheduled.map(o=>new Date(o.scheduled_date+'T12:00:00'))}} modifiersClassNames={{booked:'has-visit'}}/><p className="small muted">밑줄이 있는 날짜에 방문 일정이 있습니다.</p></div><div className="agenda-list"><span className="eyebrow">{day?dateKey(day):'UPCOMING VISITS'}</span><h3>{day?'선택한 날의 작업':'다가오는 방문'} <span>{visible.length}건</span></h3>{visible.length===0?<div className="agenda-empty"><CalendarDays size={28}/><p>{day?'이 날짜에 확정된 방문이 없습니다.':'다가오는 확정 방문이 없습니다.'}</p><small>계약을 승인하면 확정 일정이 표시됩니다.</small></div>:visible.map(o=><Link className="agenda-item" key={o.id} href={(mode==='partner'?'/partner/work/':'/mypage/')+o.id}><div className="agenda-date"><b>{o.scheduled_date!.slice(8)}</b><small>{o.scheduled_date!.slice(5,7)}월</small></div><div><strong>{o.title}</strong><p>{o.scheduled_start}:00–{o.scheduled_end}:00 · {o.status==='DISPUTED'?'분쟁 검토 중':o.status==='BID_SELECTED'?'예약금 확인 필요':'확정 일정'}</p><small><MapPin size={12}/>{o.region}</small></div><ArrowUpRight size={18}/></Link>)}</div></section>;
}
