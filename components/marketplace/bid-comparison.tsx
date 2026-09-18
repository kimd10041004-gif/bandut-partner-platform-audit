'use client';
import {useState} from 'react';
import {ArrowRight,Columns3} from 'lucide-react';
import {Checkbox} from '@/components/ui/checkbox';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {Table,TableHeader,TableHead,TableBody,TableRow,TableCell} from '@/components/ui/table';
import type {Bid} from '@/lib/model';
import {won} from '@/lib/client';
export function BidComparison({bids,canSelect,onSelect}:{bids:Bid[];canSelect:boolean;onSelect:(b:Bid)=>void}){
 const [open,setOpen]=useState(false),[ids,setIds]=useState<string[]>([]),[sort,setSort]=useState('price');
 const ordered=[...bids].sort((a,b)=>sort==='price'?a.total-b.total:a.available_date.localeCompare(b.available_date)||a.start_hour-b.start_hour);
 const selected=ordered.filter(b=>ids.includes(b.id));
 const rows:[string,(b:Bid)=>string][]=[['VAT 포함 총액',b=>won(b.total)],['공급가',b=>won(b.total-b.vat)],['인건비',b=>won(b.labor_cost)],['자재비',b=>won(b.material_cost)],['출장비',b=>won(b.transport_cost)],['할인',b=>won(b.discount)],['VAT',b=>won(b.vat)],['포함 항목',b=>b.included],['제외 항목',b=>b.excluded],['방문 가능 일정',b=>`${b.available_date} · ${b.start_hour}:00–${b.end_hour}:00`],['파트너 설명',b=>b.message]];
 if(bids.length<2)return null;
 return <><button className="btn secondary compare-trigger" onClick={()=>{setIds(ordered.slice(0,3).map(b=>b.id));setOpen(true);}}><Columns3 size={17}/>견적 나란히 비교</button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="comparison-dialog"><DialogHeader><DialogTitle>견적 비교</DialogTitle><DialogDescription>최대 3개 견적의 금액과 작업 범위를 비교하세요. 방문 가능일은 계약 동의 후 확정됩니다.</DialogDescription></DialogHeader><div className="comparison-controls"><Select value={sort} onValueChange={setSort}><SelectTrigger aria-label="견적 비교 정렬"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="price">낮은 금액순</SelectItem><SelectItem value="date">빠른 방문일순</SelectItem></SelectContent></Select><div className="compare-choices">{ordered.map(b=><label className="check-line" key={b.id}><Checkbox checked={ids.includes(b.id)} disabled={!ids.includes(b.id)&&ids.length>=3} onCheckedChange={v=>setIds(prev=>v?[...prev,b.id]:prev.filter(id=>id!==b.id))}/>{b.company??'파트너'}</label>)}</div></div>{selected.length?<Table className="comparison-table"><TableHeader><TableRow><TableHead>비교 항목</TableHead>{selected.map(b=><TableHead key={b.id}>{b.company??'파트너'}{b.status==='SELECTED'&&<small className="block teal">선택한 파트너</small>}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map(([label,value],i)=><TableRow key={label} className={i===0?'compare-total':''}><TableCell>{label}</TableCell>{selected.map(b=><TableCell key={b.id}>{value(b)}</TableCell>)}</TableRow>)}{canSelect&&<TableRow><TableCell>파트너 선택</TableCell>{selected.map(b=><TableCell key={b.id}><button className="btn primary" onClick={()=>{setOpen(false);onSelect(b);}}>선택 검토 <ArrowRight size={14}/></button></TableCell>)}</TableRow>}</TableBody></Table>:<p className="inline-notice">비교할 견적을 선택해 주세요.</p>}</DialogContent></Dialog></>;
}
