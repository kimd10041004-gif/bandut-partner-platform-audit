import {MarketplaceEntry} from '@/components/marketplace/home';
import {MessagesHub,SearchHub} from '@/components/marketplace/workspace-hubs';
import {CalendarHub} from '@/components/marketplace/calendar-hub';
import {loadPresentation} from '@/lib/presentation-server';
import {VisualEditor} from '@/components/marketplace/visual-editor';
import {PortfolioManager,Notices,ReceiptPage} from '@/components/marketplace/community';
// 29-31: 업체 상세·상담·질문을 공개본 순서대로 조립한다 (v17 community.tsx 는 그대로 둔다)
import {CompanyShowcase} from '@/components/marketplace/company-showcase';
import {Operations} from '@/components/marketplace/operations';
import { notFound } from 'next/navigation';
import { Shell,Access } from '@/components/marketplace/shell';
import { RequestForm } from '@/components/marketplace/request';
import { OrdersDashboard,AdminPartners,AuditPage } from '@/components/marketplace/dashboard';
import { TradeLedger,PaymentReturn } from '@/components/marketplace/trade';
import { OrderDetail } from '@/components/marketplace/order-detail';
import { Profile } from '@/components/marketplace/profile';
// 29-23: v17 이식 화면에 서류 코드를 섞지 않는다 — 주소에서 나란히 붙인다(29-16의 ConsultButton 과 같은 방식)
import { PartnerDocumentUpload } from '@/components/marketplace/partner-documents';
import { Services,InfoPage } from '@/components/marketplace/info';
import { LoginPage,SignupPage,PasswordResetPage } from '@/components/marketplace/auth';
import { Diagnostics } from '@/components/marketplace/diagnostics';
import { CompanyFinder } from '@/components/marketplace/companies';
import { CompanyQuestions } from '@/components/marketplace/questions';
import { PageEditor } from '@/components/marketplace/page-editor';
import { ConsultButton,ConsultList,ConsultRoom } from '@/components/marketplace/consult';
// 29-12: 주소의 role 을 초기값으로 쓴다(명세 2절). 아는 값이 아니면 고객으로 본다 — 잘못된 값이
// 화면을 비우거나 404 로 떨어지지 않게. 관리자는 여기서 고를 수 없다(29-10): /login/admin 한 자리뿐이다.
function roleOf(sp:Record<string,string|string[]|undefined>):'customer'|'partner'{return sp['role']==='partner'?'partner':'customer'}
export default async function Page({params,searchParams}:{params:Promise<{slug:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){const {slug}=await params;const sp=await searchParams;const path=slug.join('/');const role=roleOf(sp);let content;
 if(path==='login')content=<LoginPage initialRole={role}/>;
 else if(path==='login/customer')content=<LoginPage initialRole="customer"/>;
 else if(path==='login/partner')content=<LoginPage initialRole="partner"/>;
 else if(path==='login/admin')content=<LoginPage initialRole="admin"/>;
 else if(path==='signup')content=<SignupPage initialRole={role}/>;
 else if(path==='signup/customer')content=<SignupPage initialRole="customer"/>;
 else if(path==='signup/partner')content=<SignupPage initialRole="partner"/>;
 else if(path==='password/reset')content=<PasswordResetPage initialRole={role}/>;
 else if(path==='start')content=<MarketplaceEntry/>;
 else if(path==='start/customer'||path==='start/partner')content=<MarketplaceEntry audience={slug[1] as 'customer'|'partner'}/>;
 else if(path==='messages'||path==='admin/messages')content=<MessagesHub/>;
 else if(path==='search'||path==='admin/search')content=<SearchHub/>;
 else if(path==='schedule'||path==='admin/schedule')content=<CalendarHub/>;
 else if(path==='admin'||path==='admin/dashboard')content=<Operations kind="dashboard"/>;
 else if(path==='admin/editor')content=<VisualEditor/>;
 else if(path==='admin/diagnostics')content=<Diagnostics/>;
 else if(['admin/content','admin/settings','admin/reviews'].includes(path))content=<Operations kind={slug[1] as 'content'|'settings'|'reviews'}/>;
 else if(path==='notices')content=<Notices/>;
 else if(path==='partner/portfolio')content=<PortfolioManager/>;
 else if(path==='partner/company/editor')content=<PageEditor/>;
 else if(path==='companies')content=<CompanyFinder/>;
 else if(slug[0]==='companies'&&slug.length===2)content=<CompanyShowcase id={slug[1]}/>;
 else if(path==='consult')content=<ConsultList/>;
 else if(slug[0]==='consult'&&slug.length===2)content=<ConsultRoom id={slug[1]}/>;
 else if(slug[0]==='receipts'&&slug.length===2)content=<ReceiptPage id={slug[1]}/>;
 else if(path==='request')content=<RequestForm initialPresentation={await loadPresentation()}/>;
 else if(path==='services')content=<Services initialPresentation={await loadPresentation()}/>;
 else if(['privacy','terms','marketplace-notice'].includes(path))content=<InfoPage kind={path}/>;
 else if(path==='mypage')content=<OrdersDashboard mode="customer"/>;
 else if(path==='profile')content=<Profile/>;
 else if(path==='admin/orders')content=<OrdersDashboard mode="admin"/>;
 else if(path==='admin/partners')content=<AdminPartners/>;
 else if(path==='admin/audit-logs')content=<AuditPage/>;
 else if(['partner','partner/jobs','partner/work','partner/bids'].includes(path))content=<OrdersDashboard mode="partner"/>;
 else if(path==='partner/settlement')content=<TradeLedger kind="settlements" audience="partner"/>;
 else if(path==='admin/settlements')content=<TradeLedger kind="settlements" audience="admin"/>;
 else if(path==='admin/disputes')content=<TradeLedger kind="disputes"/>;
 else if(path==='payment/return')content=<PaymentReturn/>;
 else if(path==='partner/profile')content=<><Profile partnerMode/><PartnerDocumentUpload/></>;
 else if((slug[0]==='mypage'&&slug.length===2)||(slug[0]==='admin'&&slug[1]==='orders'&&slug.length===3)||(slug[0]==='partner'&&['jobs','work','bids'].includes(slug[1])&&slug.length===3))content=<OrderDetail id={slug.at(-1)!}/>;
 else notFound();
 return <Shell>{['admin/messages','admin/search','admin/schedule','admin/diagnostics'].includes(path)?<Access roles={['ADMIN']}>{content}</Access>:content}</Shell>;
}

export const dynamic='force-dynamic';
