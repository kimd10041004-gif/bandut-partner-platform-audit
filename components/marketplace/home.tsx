/* Sites sign-in must navigate at the top level. */
/* eslint-disable @next/next/no-html-link-for-pages */
'use client';
import Link from 'next/link';
import Image from 'next/image';
import {ArrowRight,Box,BriefcaseBusiness,House,Wrench,Droplets,Lightbulb,DoorOpen,PaintRoller,Building2,ClipboardList,MessagesSquare,ShieldCheck,Check} from 'lucide-react';
import {useAccount,ROOM_STUDIO_URL} from './shell';

const services=[['설비·누수',Droplets],['전기·조명',Lightbulb],['문·창호',DoorOpen],['도배·인테리어',PaintRoller],['주거·상업공간',Building2],['생활 수리·설치',Wrench]] as const;
export function MarketplaceHome(){
 const {user}=useAccount();
 return <div className="market-home">
  <section className="market-hero">
   <div className="market-hero-copy"><p className="market-kicker">전국 집수리·인테리어 연결</p><h1>우리 집, 어디부터 <br/><em>바꿔볼까요?</em></h1><p className="market-lead">필요한 수리는 전문가에게 요청하고, <br/>바꾸고 싶은 공간은 직접 꾸며보세요.</p></div>
   <div className="market-hero-image"><Image unoptimized src="/home-interior.webp" alt="밝고 정돈된 거실과 주방" width={1536} height={1024} priority/></div>
  </section>
  <section className="market-task-grid" aria-label="바로 시작하기">
   <Link className="market-task repair" href="/request"><span className="market-task-icon"><Wrench size={25}/></span><div><h2>수리 요청하기</h2><p>사진과 필요한 작업을 올리고 <br/>여러 전문가의 견적을 비교하세요.</p><strong>요청 작성 <ArrowRight size={18}/></strong></div></Link>
   <a className="market-task interior" href={ROOM_STUDIO_URL}><span className="market-task-icon"><Box size={25}/></span><div><h2>인테리어 꾸미기</h2><p>방 크기를 정하고 가구를 놓아 <br/>2D·3D로 미리 확인하세요.</p><strong>로그인 없이 바로 열기 <ArrowRight size={18}/></strong></div></a>
   <Link className="market-task jobs" href="/start/partner"><span className="market-task-icon"><BriefcaseBusiness size={25}/></span><div><h2>일감 찾기</h2><p>기사·업체로 등록하고 <br/>내 지역의 작업에 견적을 제안하세요.</p><strong>파트너로 시작 <ArrowRight size={18}/></strong></div></Link>
  </section>
  {user&&<div className="market-account"><span><strong>{user.name}님</strong>, 진행 중인 작업을 이어서 확인하세요.</span><Link href={user.role==='ADMIN'?'/admin':user.role==='PARTNER'?'/partner':'/mypage'}>내 작업 공간 <ArrowRight size={17}/></Link></div>}
  <section className="market-section"><div className="market-section-heading"><div><p className="market-kicker">수리부터 공간 개선까지</p><h2>어떤 도움이 필요하세요?</h2></div><Link href="/services">전체 서비스·가격 안내 <ArrowRight size={17}/></Link></div><div className="market-services">{services.map(([name,Icon])=><Link href="/services" key={name}><span><Icon size={27}/></span><strong>{name}</strong><small>작업 범위 알아보기</small></Link>)}</div></section>
  <section className="market-section market-sides"><article className="market-side customer"><span className="market-side-icon"><House size={27}/></span><p className="market-kicker">고객 공간</p><h2>요청은 한 번, <br/>선택은 비교하고.</h2><p>사진과 작업 내용을 올려 주세요. 도착한 견적의 금액, 작업 범위, 방문 일정을 보고 직접 파트너를 선택합니다.</p><ul><li><Check size={17}/>여러 기사·업체의 견적 비교</li><li><Check size={17}/>선택한 파트너와 채팅·일정 조율</li><li><Check size={17}/>추가 작업과 완료 여부 직접 확인</li></ul><Link href="/request">수리 요청하기 <ArrowRight size={20}/></Link></article><article className="market-side contractor"><span className="market-side-icon"><Wrench size={27}/></span><p className="market-kicker">기사·업체 공간</p><h2>잘하는 기술을, <br/>필요한 고객에게.</h2><p>활동 지역과 전문 분야를 등록해 주세요. 승인 후 공개된 요청을 확인하고 작업 조건에 맞는 견적을 제안할 수 있습니다.</p><ul><li><Check size={17}/>파트너 가입·활동 정보 등록</li><li><Check size={17}/>일감 확인과 견적 제안</li><li><Check size={17}/>내 작업·대화·정산 내역 관리</li></ul><Link href="/start/partner">파트너 가입·일감 찾기 <ArrowRight size={20}/></Link></article></section>
  <section className="market-section"><div className="market-section-heading"><div><p className="market-kicker">함께 진행하는 작업</p><h2>처음 요청부터 작업 확인까지</h2></div></div><ol className="market-steps">{([['01','작업 요청','고객이 사진, 지역, 필요한 작업을 등록합니다.',ClipboardList],['02','견적 비교·선택','기사들이 제안하면 고객이 조건을 비교하고 선택합니다.',Wrench],['03','채팅·작업 진행','방문 일정을 조율하고 추가 작업은 고객 승인을 받습니다.',MessagesSquare],['04','완료 확인','고객이 결과를 확인하고 거래 내역을 남깁니다.',ShieldCheck]] as const).map(([n,title,description,Icon])=><li key={String(n)}><span>{String(n)}<Icon size={23}/></span><h3>{String(title)}</h3><p>{String(description)}</p></li>)}</ol></section>
  <section className="market-help"><div><h2>이용 전에 궁금한 점이 있나요?</h2><p>서비스 범위와 거래 기준을 확인해 보세요. 접수 후에는 요청별 운영팀 채팅을 이용할 수 있습니다.</p></div><Link className="btn secondary" href="/notices">공지·자주 묻는 질문 <ArrowRight size={17}/></Link></section>
 </div>;
}

export function MarketplaceEntry({audience}:{audience?:'customer'|'partner'}){
 const {user,partner,loading,error,reload}=useAccount();
 const contractor=audience==='partner';
 const destination=user?.role==='ADMIN'?'/admin':user?.role==='PARTNER'?'/partner':'/mypage';
 return <div className="market-entry"><Link className="market-back" href="/">← 플랫폼 홈</Link><p className="market-kicker">BANDEUT MARKETPLACE</p><h1>{audience?contractor?'기사·업체로 시작하기':'고객으로 시작하기':'어떤 일로 오셨나요?'}</h1><p className="market-lead">{audience?contractor?'전문 분야를 등록하고, 새로운 고객을 만나세요.':'필요한 수리를 요청하고, 여러 전문가의 제안을 비교하세요.':'수리를 맡길 고객과 작업을 맡을 기사·업체의 공간을 선택하세요.'}</p>
 {!audience?<div className="market-entry-options"><Link href="/start/customer"><House size={30}/><h2>수리를 맡기고 싶어요</h2><p>작업 요청 · 견적 비교 · 내 요청 관리</p><strong>고객으로 시작 <ArrowRight size={18}/></strong></Link><Link href="/start/partner"><Wrench size={30}/><h2>일감을 찾고 싶어요</h2><p>파트너 가입 · 견적 제안 · 내 작업 관리</p><strong>기사·업체로 시작 <ArrowRight size={18}/></strong></Link></div>:<div className="market-entry-panel">
 <ol className="market-entry-steps">{(contractor?['본인 계정으로 로그인','활동 지역·전문 분야 제출','운영팀 승인 후 견적 제안']:['본인 계정으로 로그인','사진·지역·작업 내용 접수','도착한 견적 비교·선택']).map((v,i)=><li key={v}><span>{i+1}</span>{v}</li>)}</ol>
 {loading?<p role="status">계정을 확인하고 있습니다…</p>:!user?<><Link className="btn primary" href={audience==='partner'?'/login/partner':'/login'}>로그인하고 계속하기 <ArrowRight size={18}/></Link><Link className="inline-link" href={audience==='partner'?'/signup/partner':'/signup'}>계정이 없으신가요? 회원가입</Link><p className="small muted">휴대폰 번호로 본인 확인을 하면 가입이 끝납니다.{contractor?' 이후 파트너 활동 정보를 제출하면 승인 검토가 시작됩니다.':' 내 요청과 견적은 로그인한 계정에 연결됩니다.'}</p>{error&&error!=='로그인이 필요합니다.'&&<p role="alert" className="error">{error} <button type="button" onClick={reload}>다시 확인</button></p>}</>:user.suspended?<p role="alert">이용이 제한된 계정입니다. 계정 상태를 확인해 주세요.</p>:user.role==='ADMIN'?<><p>관리자 계정으로 로그인되어 있습니다. 고객 요청과 파트너 승인을 운영 공간에서 관리하세요.</p><Link className="btn primary" href="/admin">관리자 센터로 이동 <ArrowRight size={18}/></Link></>:contractor?user.role==='CUSTOMER'?<><p><strong>{user.name}님</strong>, 기사·업체의 활동 정보를 등록해 주세요.</p><Link className="btn primary" href="/partner/profile">파트너 가입 신청 <ArrowRight size={18}/></Link><p className="small muted">제출하면 계정이 파트너로 전환됩니다. 진행 중인 고객 요청이 있으면 먼저 마무리해야 합니다.</p></>:<><p><strong>{partner?.company||user.name}</strong> · {partner?.status==='APPROVED'?'승인된 파트너':partner?.status==='PENDING'?'파트너 승인 대기':'파트너 정보 확인 필요'}</p><Link className="btn primary" href={partner?.status==='APPROVED'?'/partner/jobs':'/partner/profile'}>{partner?.status==='APPROVED'?'일감 찾기':'신청 정보 확인'} <ArrowRight size={18}/></Link><Link className="inline-link" href="/partner">내 파트너 공간</Link></>:user.role==='PARTNER'?<><p>현재 기사·업체 계정으로 로그인되어 있습니다. 고객 요청은 고객 계정에서 접수할 수 있습니다.</p><Link className="btn primary" href={destination}>내 파트너 공간 <ArrowRight size={18}/></Link><Link className="inline-link" href="/login">다른 계정으로 로그인</Link></>:<><p><strong>{user.name}님</strong>, 어떤 작업이 필요하세요?</p><Link className="btn primary" href="/request">새 작업 요청하기 <ArrowRight size={18}/></Link><Link className="inline-link" href="/mypage">이미 접수한 요청·견적 확인</Link></>}
 </div>}
 {audience&&<Link className="market-back" href={contractor?'/start/customer':'/start/partner'}>{contractor?'수리를 맡길 고객이신가요?':'기사·업체로 활동하고 싶으신가요?'} <ArrowRight size={16}/></Link>}
 </div>;
}
