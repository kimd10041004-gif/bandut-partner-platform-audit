'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Reorder, useDragControls } from 'framer-motion';
import { GripVertical, ArrowUp, ArrowDown, Undo2, Redo2, Save, Monitor, Smartphone, Check, Eye, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { api, won } from '@/lib/client';
import { numberFields, widgetLabels, presentationChanges, presentationSchema, type NumberField, type Presentation, type SavedPresentation } from '@/lib/presentation';
import { categories, serviceGroups } from '@/lib/policy';
import { ServiceChoices } from './service-choices';
import { Access, PageHeading } from './shell';
import { RequestIntro, RequestAside, PriceGuide, usePresentation, PresentationLoading, presentationStyle } from './presentation-view';

export function VisualEditor() { return <Access roles={['ADMIN']}><LoadEditor/></Access>; }
function LoadEditor() {
  const { saved, error, reload } = usePresentation();
  return saved ? <Editor initial={saved}/> : <PresentationLoading error={error} retry={reload}/>;
}
function SortRow({ value, index, count, label, move, children }: { value: string; index: number; count: number; label: string; move: (from: number, to: number) => void; children?: React.ReactNode }) {
  const controls = useDragControls();
  return <Reorder.Item value={value} dragListener={false} dragControls={controls} className="editor-sort-row" whileDrag={{ boxShadow: '0 10px 25px #17324d26', zIndex: 2 }}>
    <button type="button" className="editor-grip" aria-label={`${label} 드래그 또는 방향키로 이동`} onPointerDown={e => controls.start(e)} onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); move(index, index + (e.key === 'ArrowUp' ? -1 : 1)); } }}><GripVertical size={20}/></button>
    <span className="editor-position">{String(index + 1).padStart(2, '0')}</span><strong>{label}</strong>{children}
    <div className="editor-move"><button type="button" aria-label={`${label} 위로`} disabled={index === 0} onClick={() => move(index, index - 1)}><ArrowUp size={16}/></button><button type="button" aria-label={`${label} 아래로`} disabled={index === count - 1} onClick={() => move(index, index + 1)}><ArrowDown size={16}/></button></div>
  </Reorder.Item>;
}
function NumberControl({ field, value, original, update }: { field: NumberField; value: number; original: number; update: (v: number) => void }) {
  const f = numberFields[field];
  return <div className="editor-number"><div className="between"><label htmlFor={'editor-' + field}>{f.label}</label><span className={value === original ? 'muted' : 'teal'}>{value === original ? '저장값과 같음' : `저장값 ${original.toLocaleString('ko-KR')}${f.unit}`}</span></div><div className="editor-number-input"><input id={'editor-' + field} type="number" min={f.min} max={f.max} step={1} value={Number.isFinite(value) ? value : ''} onChange={e => update(e.target.value === '' ? NaN : Number(e.target.value))}/><span>{f.unit}</span></div><Slider aria-label={f.label + ' 슬라이더'} min={f.min} max={f.max} step={f.step} value={[Number.isFinite(value) ? Math.min(f.max, Math.max(f.min, value)) : f.min]} onValueChange={v => update(v[0])}/><div className="editor-range"><span>{f.min.toLocaleString('ko-KR')}{f.unit}</span><span>{f.max.toLocaleString('ko-KR')}{f.unit}</span></div>{(!Number.isInteger(value) || value < f.min || value > f.max) && <p role="alert" className="error">{f.min.toLocaleString('ko-KR')}~{f.max.toLocaleString('ko-KR')} 사이 정수를 입력해 주세요.</p>}</div>;
}
function Editor({ initial }: { initial: SavedPresentation }) {
  const [saved, setSaved] = useState(initial);
  const [history, setHistory] = useState<Presentation[]>([initial.data]);
  const [position, setPosition] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [previewItems, setPreviewItems] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const data = history[position];
  const changes = presentationChanges(saved.data, data);
  const valid = presentationSchema.safeParse(data).success;
  const dirty = changes.length > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => {
      const target = (event.target as Element).closest?.('a');
      if (target && target.target !== '_blank' && !target.getAttribute('href')?.startsWith('#') && !window.confirm('저장하지 않은 수정이 있습니다. 이 화면을 나갈까요?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', warn); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', navigate, true); };
  }, [dirty]);
  function change(next: Presentation) {
    if (busy || JSON.stringify(next) === JSON.stringify(data)) return;
    const past = history.slice(0, position + 1).slice(-79);
    setHistory([...past, next]); setPosition(past.length); setError('');
  }
  function move(kind: 'groups' | 'widgets', from: number, to: number) {
    if (to < 0 || to >= data[kind].length) return;
    if (kind === 'groups') { const next = [...data.groups]; next.splice(to, 0, next.splice(from, 1)[0]); change({ ...data, groups: next }); }
    else { const next = [...data.widgets]; next.splice(to, 0, next.splice(from, 1)[0]); change({ ...data, widgets: next }); }
    setAnnouncement(`${from + 1}번째 항목을 ${to + 1}번째로 옮겼습니다.`);
  }
  async function save() {
    if (!valid || !dirty || busy || reason.trim().length < 5) return;
    setBusy(true); setError('');
    try {
      const result = await api<SavedPresentation>('admin/presentation', { data, revision: saved.revision, reason });
      setSaved(result); setHistory([result.data]); setPosition(0); setReason('');
      toast.success('저장했습니다. 고객 화면을 새로 열면 적용된 내용을 볼 수 있습니다.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true);
    try { const result = await api<SavedPresentation>('presentation'); setSaved(result); setHistory([result.data]); setPosition(0); setError(''); setReason(''); toast.success('마지막 저장 상태를 불러왔습니다.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  // A preview uses only validated values; invalid number input must never become CSS or a price.
  const preview = valid ? data : { ...data, ...Object.fromEntries((Object.keys(numberFields) as NumberField[]).map(key => [key, Number.isInteger(data[key]) && data[key] >= numberFields[key].min && data[key] <= numberFields[key].max ? data[key] : saved.data[key]])) };
  return <div className="visual-editor"><PageHeading eyebrow="WEBSITE EDITOR" title="화면·숫자 편집" description="끌어서 배치하고, 숫자로 조정하세요. 저장 전에는 고객 화면이 바뀌지 않습니다." action={<Link className="btn secondary" href="/request" target="_blank"><Eye size={17}/>저장된 고객 화면</Link>}/>
    <div className="editor-toolbar"><span className={'editor-save-state ' + (dirty ? 'changed' : '')}>{dirty ? <SlidersHorizontal size={17}/> : <Check size={17}/>} {dirty ? `${changes.length}개 항목 수정 중` : '저장된 화면과 같음'}</span><span className="editor-last-save">{saved.updatedAt ? new Date(saved.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ' 저장' : '기본 화면'}</span><div className="action-row"><button className="icon-button" aria-label="실행 취소" title="실행 취소" disabled={busy || position === 0} onClick={() => setPosition(position - 1)}><Undo2 size={18}/></button><button className="icon-button" aria-label="다시 실행" title="다시 실행" disabled={busy || position === history.length - 1} onClick={() => setPosition(position + 1)}><Redo2 size={18}/></button><AlertDialog><AlertDialogTrigger asChild><button className="btn secondary" disabled={busy}>저장 상태로 되돌리기</button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>마지막 저장 상태를 불러올까요?</AlertDialogTitle><AlertDialogDescription>현재 저장하지 않은 편집 내용은 사라집니다. 서버에 저장된 최신 화면으로 돌아갑니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>계속 편집</AlertDialogCancel><AlertDialogAction onClick={reload}>불러오기</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></div>
    {error && <p className="error" role="alert">{error} 입력 내용은 유지됩니다.</p>}<p className="sr-only" aria-live="polite">{announcement}</p>
    <div className="editor-workspace"><fieldset className="editor-controls" disabled={busy}><Tabs defaultValue="layout"><TabsList className="editor-tabs"><TabsTrigger value="layout">배치</TabsTrigger><TabsTrigger value="text">문구·크기</TabsTrigger><TabsTrigger value="numbers">요금 숫자</TabsTrigger></TabsList>
      <TabsContent value="layout"><section className="editor-section"><h2>안내 카드</h2><p>손잡이를 끌거나 화살표로 순서를 바꾸세요.</p><Reorder.Group axis="y" values={data.widgets.map(w => w.id)} onReorder={ids => change({ ...data, widgets: ids.map(id => data.widgets.find(w => w.id === id)!) })} className="editor-sort-list">{data.widgets.map((w, i) => <SortRow key={w.id} value={w.id} index={i} count={data.widgets.length} label={widgetLabels[w.id]} move={(a, b) => move('widgets', a, b)}><Switch aria-label={widgetLabels[w.id] + ' 표시'} checked={w.visible} onCheckedChange={visible => change({ ...data, widgets: data.widgets.map(item => item.id === w.id ? { ...item, visible } : item) })}/><span className="editor-visibility">{w.visible ? '표시' : '숨김'}</span></SortRow>)}</Reorder.Group></section><section className="editor-section"><h2>작업 분야 순서</h2><p>접수 화면과 서비스 안내에 같은 순서로 표시됩니다.</p><Reorder.Group axis="y" values={data.groups} onReorder={groups => change({ ...data, groups })} className="editor-sort-list">{data.groups.map((g, i) => <SortRow key={g} value={g} index={i} count={data.groups.length} label={g} move={(a, b) => move('groups', a, b)}/>)}</Reorder.Group><p className="small muted">모든 분야는 계속 접수할 수 있습니다. ‘잘 모르겠어요’는 맨 끝에 표시됩니다.</p></section></TabsContent>
      <TabsContent value="text"><section className="editor-section field-stack"><h2>메인 안내</h2><label className="field">제목<textarea rows={3} value={data.title} maxLength={70} onChange={e => change({ ...data, title: e.target.value })}/><small>{data.title.length}/70자 · 줄바꿈 가능</small></label><label className="field">설명<textarea rows={4} value={data.subtitle} maxLength={160} onChange={e => change({ ...data, subtitle: e.target.value })}/><small>{data.subtitle.length}/160자</small></label>{(['headingSize', 'cardGap'] as const).map(key => <NumberControl key={key} field={key} value={data[key]} original={saved.data[key]} update={v => change({ ...data, [key]: v })}/>)}</section></TabsContent>
      <TabsContent value="numbers"><section className="editor-section"><h2>고객 공개 요금 안내</h2><p>VAT 포함 금액입니다. 접수 화면과 서비스 안내에 함께 적용합니다.</p><div className="inline-notice">요금 안내 수정입니다. 개별 견적·계약·결제 금액과 운영 통계는 바뀌지 않습니다.</div>{(['visitFee', 'extraFee', 'minimum', 'purchaseFee'] as const).map(key => <NumberControl key={key} field={key} value={data[key]} original={saved.data[key]} update={v => change({ ...data, [key]: v })}/>)}</section></TabsContent>
    </Tabs></fieldset>
    <section className="editor-preview-pane"><div className="editor-preview-heading"><div><h2>고객 화면 미리보기</h2><span>{valid ? '편집한 내용이 바로 보입니다' : '입력 오류를 수정해 주세요 · 숫자는 마지막 유효 저장값으로 표시'}</span></div><div className="editor-device"><button aria-label="넓은 화면 미리보기" aria-pressed={!mobile} onClick={() => setMobile(false)}><Monitor size={18}/></button><button aria-label="좁은 화면 미리보기" aria-pressed={mobile} onClick={() => setMobile(true)}><Smartphone size={18}/></button></div></div>
    <div className={'editor-preview ' + (mobile ? 'narrow' : '')}><div className="editor-preview-content presentation-page" style={presentationStyle(preview)}><div className="editor-preview-brand">반듯집수리 <span>전국 작업 접수</span></div><RequestIntro data={preview}/><div className={"editor-preview-layout "+(preview.widgets.some(w=>w.visible)?'':'no-aside')}><section className="editor-preview-categories"><h2>어떤 작업이 필요하세요?</h2><p>필요한 작업 분야를 함께 선택하세요.</p><div className="editor-group-preview">{data.groups.map((name, i) => <span key={name}>{i + 1}. {name}</span>)}</div><ServiceChoices available={[...data.groups.flatMap(name => { const g = serviceGroups.find(group => group.name === name)!; return categories.filter(([code]) => g.codes.includes(code)); }), ...categories.filter(([code])=>code==='UNKNOWN')]} items={previewItems} toggle={code=>setPreviewItems(items=>items.includes(code)?items.filter(item=>item!==code):[...items,code])}/><p className="inline-notice">선택한 분야 {previewItems.length}개 · 미리보기에서는 접수되지 않습니다.</p></section><RequestAside data={preview}/></div><PriceGuide data={preview}/></div></div></section></div>
    <section className="editor-review panel"><div className="between"><div><h2>변경 전후 확인</h2><p className="muted">{changes.length ? '값과 배치를 확인한 후 저장하세요.' : '항목을 수정하면 변경 내역이 여기에 표시됩니다.'}</p></div><Link href="/admin/audit-logs" className="inline-link" target="_blank">저장 이력 보기</Link></div>{changes.length > 0 && <Table><TableHeader><TableRow><TableHead>항목</TableHead><TableHead>저장된 값</TableHead><TableHead>수정한 값</TableHead></TableRow></TableHeader><TableBody>{changes.map(c => <TableRow key={c.label}><TableCell>{c.label}</TableCell><TableCell>{c.before}</TableCell><TableCell><strong>{c.after}</strong></TableCell></TableRow>)}</TableBody></Table>}
    <div className="editor-price-check"><span>현재 입력한 출장비</span><strong>{Number.isFinite(data.visitFee) ? won(data.visitFee) : '입력 필요'}</strong><span>1회 방문 · 여러 작업도 한 번 합산</span></div><label className="field">변경 사유<textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} rows={2} placeholder="예: 고객이 자주 찾는 작업 분야를 위로 배치" disabled={busy}/><small>5자 이상 · 수정 전후 값과 함께 감사로그에 기록합니다.</small></label></section>
    <div className="editor-save-bar"><div><strong>{changes.length}개 항목 변경</strong><span>{!valid ? '문구 길이와 숫자 범위를 확인해 주세요.' : dirty ? '저장하면 고객 화면에 적용됩니다.' : '새로운 변경 사항이 없습니다.'}</span></div><button className="btn primary" disabled={!dirty || !valid || busy || reason.trim().length < 5} onClick={save}><Save size={18}/>{busy ? '저장 중…' : '확인하고 저장'}</button></div>
  </div>;
}
