import { useState } from 'react'
import type { RepairCategory } from '../../domain/types'
import { usePlatform } from '../../app/PlatformContext'
import { landingTitle } from '../../domain/platform'
import type { LandingSectionId } from '../../domain/types'
import { krw } from '../../ui/format'
import CategoryPicker from '../../ui/CategoryPicker'

/** 퍼블릭 홈페이지 (28-16-01, 시안 "메인은 홈페이지"):
 *  히어로 → 카테고리 그리드 → 4단계 안내 → 서비스 카드 → CTA.
 *  사진 에셋 없이 토큰·그라데이션만으로 시안의 톤을 재현한다. */
export default function Landing({
  onPostJob,
  onBrowse,
}: {
  onPostJob: (category?: RepairCategory) => void
  onBrowse: () => void
}) {
  const { platform } = usePlatform()
  const settings = platform.getSettings()
  const [doc, setDoc] = useState<'terms' | 'privacy' | null>(null)
  const cats = platform.enabledCategories()
  // 28-25-03: 표준 가격 — 관리자 CMS의 활성 패키지(비활성 카테고리 자동 제외)
  const packages = platform.activePackages()

  const STEPS = [
    { n: 1, title: '작업 올리기', desc: '내용·일정·예산을 4단계로 등록' },
    { n: 2, title: '견적 받기', desc: '파트너가 금액 구성을 제안' },
    { n: 3, title: '비교하고 결정', desc: '견적함에서 검토 후 수락' },
    { n: 4, title: '시공과 정산', desc: '진행 상황을 실시간 확인' },
  ]

  // 28-23-03: 서브 카피는 브랜드 에셋 문구와 정렬, 이미지는 public/brand/의 장면 크롭
  const SERVICES: {
    key: string
    title: string
    desc: string
    img: string
    bullets: string[]
    category: RepairCategory
  }[] = [
    {
      key: 'care',
      title: '주거 케어',
      desc: '입주 전, 집 전체 점검',
      img: '/brand/svc-care.jpg',
      bullets: ['체크리스트 기반 점검', '전문가 현장 진단', '수리·교체 솔루션 제공'],
      category: '급배수·누수·설비',
    },
    {
      key: 'iot',
      title: '스마트홈 IoT',
      desc: '설치 전 사진상담',
      img: '/brand/svc-iot.jpg',
      bullets: ['스마트 도어락', '조명·난방 제어', '에너지 모니터링'],
      category: '스마트홈·보안',
    },
    {
      key: 'bnb',
      title: '에어비앤비 세팅',
      desc: '오픈 전 공간 점검',
      img: '/brand/svc-bnb.jpg',
      bullets: ['인테리어 컨설팅', '가구·소품 스타일링', '정비·청소 서비스'],
      category: '목공·가구',
    },
  ]

  const title = (id: LandingSectionId) => landingTitle(settings.landing, id)
  const renderSection = (id: LandingSectionId) => {
    switch (id) {
      case 'categories':
        return (
          <section key={id} className="land-section" data-landing-section="categories">
            <h3 className="land-title">{title(id)}</h3>
            <CategoryPicker categories={cats} selected={[]} onPick={(c) => onPostJob(c)} groups={false} compact />
          </section>
        )
      case 'steps':
        return (
          <section key={id} className="land-section" data-landing-section="steps">
            <h3 className="land-title">{title(id)}</h3>
            <div className="steps-row">
              {STEPS.map((s) => (
                <div key={s.n} className="step-card">
                  <span className="step-badge">{s.n}</span>
                  <div>
                    <div className="step-title">{s.title}</div>
                    <div className="meta">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      case 'services':
        return (
          <section key={id} className="land-section" data-landing-section="services">
            <div className="svc-grid">
              {SERVICES.map((s) => (
                <div key={s.key} className="svc-card">
                  <img className="svc-img" src={s.img} alt={s.title} loading="lazy" />
                  <div className="svc-body">
                    <span className="svc-tag">{s.title}</span>
                    <h4>{s.desc}</h4>
                    <ul>
                      {s.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                    <button className="btn-secondary" onClick={() => onPostJob(s.category)}>
                      작업 올리기 →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      case 'packages':
        if (packages.length === 0) return null
        return (
          <section key={id} className="land-section" data-landing-section="packages">
            <h3 className="land-title">{title(id)}</h3>
            <div className="card" style={{ marginBottom: 0 }}>
              {packages.map((p) => (
                <div key={p.id} className="list-row">
                  <div>
                    <div className="lr-title">
                      <span className="svc-tag">{p.category}</span> {p.name}
                    </div>
                    {p.description && <div className="lr-sub">{p.description}</div>}
                  </div>
                  <div className="lr-right">{krw(p.price)}</div>
                </div>
              ))}
              <div className="meta" style={{ marginTop: 8 }}>
                표준 시공 기준 정찰가입니다. 정확한 금액은 견적에서 확정됩니다.
              </div>
            </div>
          </section>
        )
      case 'faq':
        if (settings.faqs.length === 0) return null
        return (
          <section key={id} className="land-section" data-landing-section="faq">
            <h3 className="land-title">{title(id)}</h3>
            <div className="card" style={{ marginBottom: 0 }}>
              {settings.faqs.map((f, i) => (
                <details key={i} className="faq-item">
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )
      case 'cta':
        return (
          <section key={id} className="cta-band" data-landing-section="cta">
            <div>
              <div className="cta-head">지금 바로 견적을 받아보세요</div>
              <div className="cta-sub">등록은 무료입니다 — 비교 후 결정하세요.</div>
            </div>
            <button onClick={() => onPostJob()}>작업 올리기 →</button>
          </section>
        )
    }
  }

  return (
    <div className="landing">
      {settings.notice !== '' && <div className="notice-band">{settings.notice}</div>}
      <section className="hero-xl">
        <div className="hero-copy">
          <h2 className="hero-title">
            {settings.heroTitle.split('\n').map((line, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </h2>
          <p className="hero-sub">
            {settings.heroSub.split('\n').map((line, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
          <div className="hero-cta">
            <button onClick={() => onPostJob()}>작업 올리기 →</button>
            <button className="btn-secondary" data-browse onClick={onBrowse}>
              서비스 둘러보기
            </button>
          </div>
          <div className="trust-badges">
            <span>등록 무료</span>
            <span>견적 비교 후 결정</span>
            <span>수수료 투명 공개 3%</span>
            <span>진행 상황 실시간 확인</span>
          </div>
        </div>
        {/* 28-92: 홈이 곧 요청 폼이다(참고 v12) — 분야를 고르는 순간 접수가 시작된다 */}
        <div className="hero-form card" data-hero-form>
          <div className="hero-form-head">
            <strong>어떤 작업이 필요하세요?</strong>
            <span className="meta">분야를 고르면 바로 접수 화면으로 갑니다 · 전국 17개 시·도</span>
          </div>
          <CategoryPicker categories={cats} selected={[]} onPick={(c) => onPostJob(c)} />
        </div>
      </section>

      {/* 28-89-B: 섹션 순서·노출·제목은 관리자가 정한다(settings.landing). 히어로·진입·푸터는 고정 */}
      {settings.landing.sections.filter((x) => x.visible).map((x) => renderSection(x.id))}

      <section className="entry-links">
        <span>사업자이신가요?</span>
        <a href="#/partner">파트너 센터 →</a>
        <a href="#/admin">관리자 콘솔 →</a>
      </section>

      {/* 28-37-02: 약관·개인정보처리방침 — 로그인 없이 공개 */}
      <footer className="land-footer">
        <div className="legal-links">
          <button
            type="button"
            className="link-btn"
            onClick={() => setDoc(doc === 'terms' ? null : 'terms')}
            aria-expanded={doc === 'terms'}
          >
            이용약관
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="link-btn"
            onClick={() => setDoc(doc === 'privacy' ? null : 'privacy')}
            aria-expanded={doc === 'privacy'}
          >
            개인정보처리방침
          </button>
        </div>
        {doc && <pre className="legal-doc">{doc === 'terms' ? settings.terms : settings.privacy}</pre>}
        <div className="meta">© 반듯집수리 · 통신판매업 신고·사업자 정보는 개통 시 표기됩니다</div>
      </footer>
    </div>
  )
}
