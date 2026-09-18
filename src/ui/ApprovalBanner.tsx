import { usePlatform } from '../app/PlatformContext'

/** 파트너 승인 상태 배너 (28-34-02, 시안 4): 승인 전에는 입찰 불가를 알린다 */
export default function ApprovalBanner() {
  const { auth } = usePlatform()
  const st = auth.partnerApproval()
  if (!st || st.approval === 'approved') return null
  return (
    <div className={`approval-banner ${st.approval}`} role="status">
      {st.approval === 'pending' ? (
        <>
          <strong>사업자 정보 검토 중</strong> — 관리자 승인 후 일감에 입찰할 수 있습니다. 대시보드·일정은 미리 둘러보실
          수 있어요.
        </>
      ) : (
        <>
          <strong>파트너 승인이 거절되었습니다</strong> — 사유: {st.rejectReason ?? '미기재'}. 정보를 정정한 뒤
          고객센터로 문의해 주세요.
        </>
      )}
    </div>
  )
}
