import type { MetadataRoute } from 'next'

/** 29-29: 운영자 문과 API 는 검색엔진에 내걸지 않는다 (vercel.json 의 X-Robots-Tag 와 짝) */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/login/admin', '/api/'] }] }
}
