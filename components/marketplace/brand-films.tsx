'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Play } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const films = [
  { id: 'inspection', title: '정확한 현장 확인', description: '측정 장비로 작업 위치와 상태를 먼저 확인하는 장면입니다.' },
  { id: 'switch', title: '깔끔한 설치', description: '스위치 설치 결과를 확인하는 장면입니다.' },
  { id: 'kitchen', title: '정돈된 마무리', description: '주방 수납장 작업을 마친 뒤 상태를 확인하는 세로 영상입니다.', portrait: true },
  { id: 'hinge', title: '세심한 조정', description: '수납장 경첩을 세밀하게 조정하는 작업 장면입니다.' },
];

export function BrandFilms() {
  const [selected, setSelected] = useState('inspection');
  const [failed, setFailed] = useState(false);
  const reduce = useReducedMotion();
  const film = films.find(v => v.id === selected)!;
  return <Dialog>
    <motion.article className="brand-film-card" whileHover={reduce ? undefined : { y: -3 }}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="brand-film-trigger" aria-label="반듯집수리 브랜드 영상 보기">
          <Image unoptimized src="/brand/inspection.webp" width={910} height={512} alt="측정 장비로 벽면의 작업 위치를 확인하는 기술자"/>
          <span className="film-play"><Play size={24} fill="currentColor"/></span>
          <span className="film-caption"><strong>확인부터 마무리까지, 반듯하게.</strong><span>작업 영상 4편 보기 · 각 10초</span></span>
        </Button>
      </DialogTrigger>
      <p>AI로 제작한 브랜드 영상입니다.</p>
    </motion.article>
    <DialogContent className="brand-film-dialog">
      <DialogTitle>반듯집수리 브랜드 영상</DialogTitle>
      <DialogDescription>기술은 기본, 뒷정리는 감동. AI로 제작한 작업 영상 네 편을 확인해 보세요.</DialogDescription>
      <Tabs value={selected} onValueChange={v => { setSelected(v); setFailed(false); }}>
        <TabsList>{films.map(v => <TabsTrigger key={v.id} value={v.id}>{v.title}</TabsTrigger>)}</TabsList>
      </Tabs>
      <video key={selected} className={film.portrait?'portrait':''} controls playsInline muted preload="none" poster={'/brand/' + selected + '.webp'} src={'/brand/' + selected + '.mp4'} aria-label={film.title} onError={() => setFailed(true)}/>
      <p className="small muted">{film.description} 재생 버튼을 누르면 시작합니다. 소리는 영상의 음량 버튼으로 켤 수 있습니다.</p>
      {failed && <p role="alert" className="error">영상을 불러오지 못했습니다. <a href={'/brand/' + selected + '.mp4'} className="inline-link">영상 파일 열기</a></p>}
    </DialogContent>
  </Dialog>;
}
