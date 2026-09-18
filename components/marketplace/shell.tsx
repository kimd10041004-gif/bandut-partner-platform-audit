'use client';
import Link from 'next/link';
import Image from 'next/image';
import { MotionConfig } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { createContext,useContext,useEffect,useState } from 'react';
import { Box,Menu,X,BookOpen,Search,CalendarDays,MessageSquare,SlidersHorizontal,House,ArrowUpRight,ClipboardList,ShieldCheck,Users,ScrollText,Wallet,LayoutDashboard,BriefcaseBusiness,UserRound,Plus,ChevronRight,Database } from 'lucide-react';
import { useSidebar,SidebarProvider,Sidebar,SidebarHeader,SidebarContent,SidebarGroup,SidebarGroupLabel,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarFooter,SidebarInset,SidebarTrigger } from '@/components/ui/sidebar';
import { Sheet,SheetTrigger,SheetContent,SheetHeader,SheetTitle,SheetDescription,SheetClose } from '@/components/ui/sheet';
import { Toaster } from '@/components/ui/sonner';
import { Empty,EmptyHeader,EmptyMedia,EmptyTitle,EmptyDescription } from '@/components/ui/empty';
import {OperationNotice} from './community';
import { Notifications } from './trade';
import { api } from '@/lib/client';
import type {User,Partner} from '@/lib/model';
export const ROOM_STUDIO_URL='/interior/';
const Context=createContext<{user:User|null;partner:Partner|null;loading:boolean;error:string;reload:()=>void}>({user:null,partner:null,loading:true,error:'',reload:()=>{}});
export const useAccount=()=>useContext(Context);
export function Brand(){return <Link href="/" className="brand" aria-label="반듯집수리 홈"><span className="brand-mark" aria-hidden="true"><Image unoptimized src="/brand/logo.png" width={1254} height={1254} alt=""/></span><span>반듯집수리<small>BANDEUT HOME CARE</small></span></Link>}
const publicNav=[['/','홈',House],['/request','수리 요청',Plus],[ROOM_STUDIO_URL,'공간 꾸미기',Box],['/mypage','내 요청',ClipboardList]] as const;
const partnerPrimaryNav=[['/partner/jobs','일감 찾기',Search],['/partner/work','내 작업',BriefcaseBusiness],['/messages','채팅',MessageSquare],['/partner/settlement','정산',Wallet]] as const;
const customerNav=[['/request','수리 요청',Plus],[ROOM_STUDIO_URL,'공간 꾸미기',Box],['/mypage','내 요청',ClipboardList],['/messages','채팅',MessageSquare]] as const;
const partnerNav=[['/partner','파트너 홈',LayoutDashboard],['/partner/jobs','일감 찾기',Search],['/partner/work','내 작업',BriefcaseBusiness],['/partner/settlement','정산',Wallet],['/partner/profile','내 정보',UserRound]] as const;
const adminGroups=[
 {label:'작업 관리',items:[['/admin','대시보드',LayoutDashboard],['/admin/orders','주문 관리',ClipboardList],['/admin/messages','채팅',MessageSquare],['/admin/schedule','일정',CalendarDays],['/admin/search','통합검색',Search]]},
 {label:'파트너·거래',items:[['/admin/partners','파트너 승인',Users],['/admin/settlements','정산 관리',Wallet],['/admin/disputes','분쟁 관리',ShieldCheck]]},
 {label:'사이트 운영',items:[['/admin/editor','화면·숫자 편집',SlidersHorizontal],['/admin/content','공지·FAQ 관리',ScrollText],['/admin/reviews','후기 관리',Users],['/admin/settings','운영 설정',ShieldCheck],['/admin/audit-logs','감사로그',ScrollText],['/admin/diagnostics','저장소 진단',Database]]},
] as const;
function isCurrent(path:string,href:string){return path===href||(href==='/admin'&&path==='/admin/dashboard')||(!['/','/partner','/admin'].includes(href)&&path.startsWith(href+'/'));}
function AllMenu({mobile=false}:{mobile?:boolean}){
 const path=usePathname();const {user,loading}=useAccount();const [open,setOpen]=useState(false);
 const groups=[
  {label:'나의 작업',items:[[user?.role==='PARTNER'?'/partner/work':'/mypage',user?.role==='PARTNER'?'내 작업':'내 요청','견적과 진행 상황',ClipboardList],['/messages','채팅','파트너와 나눈 대화',MessageSquare],['/schedule','일정','방문 예약과 개인 일정',CalendarDays],['/profile','내 정보','연락처와 계정 정보',UserRound]]},
  {label:'이용 안내',items:[['/services','서비스·가격','작업 범위와 비용 안내',BookOpen],['/notices','공지·자주 묻는 질문','이용 전 궁금한 내용',ScrollText],['/marketplace-notice','중개·취소 안내','거래와 취소 기준',ShieldCheck]]},
  {label:'파트너 공간',items:[['/start/partner','파트너 센터','일감 찾기·작업·정산',BriefcaseBusiness]]},
 ] as const;
 const menuNav=user?.role==='PARTNER'?partnerPrimaryNav:user?customerNav:publicNav;
 const moreActive=!menuNav.some(([href])=>isCurrent(path,href));
 return <Sheet open={open} onOpenChange={setOpen}>
  <SheetTrigger asChild><button className={mobile?'mobile-all-menu':'menu-trigger'} aria-label="전체 메뉴" data-current={moreActive||undefined}><Menu size={mobile?22:20}/><span>{mobile?'전체':'전체 메뉴'}</span></button></SheetTrigger>
  <SheetContent className="all-menu-sheet" showCloseButton={false}>
   <SheetHeader className="all-menu-heading"><SheetTitle>전체 메뉴</SheetTitle><SheetDescription>필요한 작업과 이용 안내를 찾아보세요.</SheetDescription><SheetClose className="menu-close" aria-label="메뉴 닫기"><X size={22}/></SheetClose></SheetHeader>
   <div className="all-menu-scroll">
    <div className="menu-account">{loading?<span>계정을 확인하고 있어요</span>:user?<><span className="menu-avatar"><UserRound size={24}/></span><div><strong>{user.name}님</strong><span>{user.role==='ADMIN'?'관리자':user.role==='PARTNER'?'파트너':'고객'} 계정</span></div><SheetClose asChild><Link href="/profile" aria-label="내 정보 보기"><ChevronRight size={20}/></Link></SheetClose></>:<><div><strong>로그인하고 내 작업 확인하기</strong><span>견적·채팅·일정을 한곳에서</span></div><Link href="/login">로그인</Link></>}</div>
    <SheetClose asChild><Link className="menu-request" href={user?.role==='PARTNER'?'/partner/jobs':'/request'}><Plus size={22}/><span>{user?.role==='PARTNER'?'일감 찾기':'새 작업 요청하기'}</span><ChevronRight size={20}/></Link></SheetClose>
    <SheetClose asChild><Link className="menu-search" href="/search"><Search size={20}/><span>작업·파트너·공지 검색</span><ChevronRight size={18}/></Link></SheetClose>
    <SheetClose asChild><a className="menu-row studio-menu-link" href={ROOM_STUDIO_URL}><span className="menu-row-icon"><Box size={21}/></span><span><strong>3D 공간 꾸미기</strong><small>방 크기 · 가구 배치 · 2D·3D 미리보기</small></span><ArrowUpRight size={18}/></a></SheetClose>
    <nav aria-label="전체 메뉴 목록">{groups.map(group=><section className="menu-group" key={group.label}><h2>{group.label}</h2><div>{group.items.map(([href,label,description,Icon])=><SheetClose asChild key={href}><Link className="menu-row" href={href} aria-current={isCurrent(path,href)?'page':undefined}><span className="menu-row-icon"><Icon size={21}/></span><span><strong>{label}</strong><small>{description}</small></span>{isCurrent(path,href)?<span className="menu-current">현재</span>:<ChevronRight size={18}/>}</Link></SheetClose>)}</div></section>)}
     {user?.role==='ADMIN'&&<section className="menu-group"><h2>운영 관리</h2><SheetClose asChild><Link className="menu-row" href="/admin"><span className="menu-row-icon"><SlidersHorizontal size={21}/></span><strong>관리자 센터</strong><ChevronRight size={18}/></Link></SheetClose></section>}
    </nav>
    <div className="menu-policies"><SheetClose asChild><Link href="/terms">이용약관</Link></SheetClose><SheetClose asChild><Link href="/privacy">개인정보처리방침</Link></SheetClose></div>
   </div>
  </SheetContent>
 </Sheet>;
}
function AdminMenu({path}:{path:string}){const {setOpenMobile}=useSidebar();return <>{adminGroups.map(group=><SidebarGroup key={group.label}><SidebarGroupLabel>{group.label}</SidebarGroupLabel><SidebarMenu>{group.items.map(([href,label,Icon])=><SidebarMenuItem key={href}><SidebarMenuButton asChild isActive={isCurrent(path,href)}><Link href={href} onClick={()=>setOpenMobile(false)} aria-current={isCurrent(path,href)?'page':undefined}><Icon/><span>{label}</span></Link></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroup>)}</>;}
export function Shell({children}:{children:React.ReactNode}){
 const path=usePathname();const admin=path.startsWith('/admin');const partnerMode=path.startsWith('/partner');const [account,setAccount]=useState<{user:User;partner:Partner|null}|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 const reload=()=>{api<{user:User;partner:Partner|null}>('me').then(v=>{setAccount(v);setError('');}).catch(e=>{setAccount(null);setError(e.message);}).finally(()=>setLoading(false));};useEffect(reload,[]);
 const user=account?.user??null;const value={user,partner:account?.partner??null,loading,error,reload};
 const mainNav=path==='/'||path.startsWith('/start')||!user?publicNav:user.role==='PARTNER'?partnerPrimaryNav:customerNav;
 const footer=<footer className="footer"><Brand/><div><a href={ROOM_STUDIO_URL}>인테리어 꾸미기</a><Link href="/services">서비스·가격</Link><Link href="/start/partner">파트너 센터</Link><Link href="/notices">공지·FAQ</Link><Link href="/terms">이용약관</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/marketplace-notice">중개·취소 안내</Link></div><small>© BANDEUT HOME CARE · 검토용 서비스</small></footer>;
 return <Context.Provider value={value}><MotionConfig reducedMotion="user" transition={{duration:.22,ease:"easeOut"}}><a className="skip-link" href="#main-content">본문으로 이동</a><Toaster richColors position="top-center"/>{admin?
  <SidebarProvider><Sidebar className="admin-sidebar"><SidebarHeader><Brand/><p className="eyebrow">운영 관리</p></SidebarHeader><SidebarContent><AdminMenu path={path}/></SidebarContent><SidebarFooter><Link href="/" className="admin-home-link"><House size={18}/>플랫폼 홈<ArrowUpRight size={16}/></Link></SidebarFooter></Sidebar><SidebarInset><header className="admin-top"><SidebarTrigger aria-label="관리 메뉴 열기 또는 닫기"/><span>운영 관리 / {adminGroups.map(g=>g.items.find(([href])=>isCurrent(path,href))?.[1]).find(Boolean)??'상세'}</span><Notifications/><span className="account-chip">{user?.name??'계정 확인 중'}</span></header><div className="admin-body" id="main-content">{children}</div></SidebarInset></SidebarProvider>:
  <><header className="site-header"><div className="header-inner"><Brand/><nav aria-label="주 메뉴">{mainNav.map(([href,label,Icon])=><a key={href} className={isCurrent(path,href)?'active':''} aria-current={isCurrent(path,href)?'page':undefined} href={href}><Icon size={18}/>{label}</a>)}</nav><div className="header-actions"><Link className="header-search" href="/search" aria-current={isCurrent(path,'/search')?'page':undefined}><Search size={20}/><span>검색</span></Link><Notifications/><AllMenu/>{!loading&&(user?<Link className="account-chip" href="/profile"><UserRound size={16}/><span>내 정보</span></Link>:<Link className="account-chip" href="/start">로그인·시작하기</Link>)}</div></div></header>
   {partnerMode&&<nav className="partner-nav" aria-label="파트너 메뉴"><div>{partnerNav.map(([href,label,Icon])=><Link key={href} className={isCurrent(path,href)?'active':''} aria-current={isCurrent(path,href)?'page':undefined} href={href}><Icon size={18}/>{label}</Link>)}</div></nav>}
   <nav className="mobile-workspace-nav" aria-label="빠른 작업 메뉴">{mainNav.map(([href,label,Icon])=><a key={href} href={href} aria-current={isCurrent(path,href)?'page':undefined}><Icon size={22} strokeWidth={isCurrent(path,href)?2.3:1.7}/><span>{label}</span></a>)}<AllMenu mobile/></nav>
   <main id="main-content"><OperationNotice/>{children}</main>{footer}</>
 }</MotionConfig></Context.Provider>;
}
export function Blank({title,description,action}:{title:string;description:string;action?:React.ReactNode}){return <Empty className="empty-panel"><EmptyHeader><EmptyMedia variant="icon"><ClipboardList/></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>{action}</Empty>}
/**
 * 29-23: 로그인이 필요할 때 **어느 문으로** 보낼지 주소가 정한다.
 *
 * 공개 로그인 화면에는 관리자 선택지가 없다(29-10) — 손님 화면에 운영자 문을 내걸지 않는다.
 * 그런데 그 탓에, 로그인 안 한 관리자가 `/admin` 에 오면 "로그인이 필요합니다" 가 뜨고 그
 * 단추가 고객 로그인으로 보냈다. 거기서 관리자는 **갈 데가 없었다.** 주소를 외우고 있어야만
 * 들어올 수 있는 상태였다 — 문을 숨긴 것이 아니라 문이 없는 것에 가까웠다.
 *
 * `/admin` 을 친 사람은 이미 그 주소를 아는 사람이므로, 여기서 관리자 문으로 보내는 것은
 * 공개 화면에 새로 내거는 것이 아니다. 공개 로그인 화면은 그대로 둔다.
 */
export function Access({roles,children}:{roles?:string[];children:React.ReactNode}){const path=usePathname();const {user,loading,error,reload}=useAccount();const door=path.startsWith('/admin')?'/login/admin':'/login';if(loading)return <div className="loading-panel" aria-live="polite">계정을 확인하고 있습니다…</div>;if(!user)return <Blank title="로그인이 필요합니다" description={error||(door==='/login/admin'?'운영자 계정으로 로그인해 주세요.':'내 요청과 견적을 안전하게 확인하려면 로그인해 주세요.')} action={<Link className="btn primary" href={door} data-login-door={door}>로그인</Link>}/>;if(roles&&!roles.includes(user.role))return <Blank title="이 계정의 이용 공간이 아닙니다" description="고객, 파트너, 관리자 계정은 각각의 권한으로 이용할 수 있습니다." action={<Link className="btn secondary" href={user.role==='ADMIN'?'/admin/orders':user.role==='PARTNER'?'/partner':'/mypage'}>내 공간으로 이동 <ChevronRight size={16}/></Link>}/>;return <>{error&&<div role="alert" className="error">{error}<button onClick={reload}>다시 확인</button></div>}{children}</>}
export function PageHeading({eyebrow,title,description,action}:{eyebrow:string;title:string;description?:string;action?:React.ReactNode}){return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description&&<p className="muted">{description}</p>}</div>{action}</div>}
export function RequestLink(){return <Link href="/request" className="btn primary"><Plus size={17}/>새 작업 요청</Link>}
