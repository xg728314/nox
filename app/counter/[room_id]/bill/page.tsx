"use client"

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import PrintAndArchiveButton from "./PrintAndArchiveButton"

type LiquorItem = { name: string; qty: number; unit_price: number; amount: number }
type TimeEntry = { category: string; time_minutes: number; amount: number }
type CardSurcharge = { card_fee: number; manager_margin: number; total: number }

type BillData = {
  session_id: string
  room_name: string | null
  session_status: string
  started_at: string
  ended_at: string | null
  liquor: { items: LiquorItem[]; total: number }
  time: { entries: TimeEntry[]; count: number; total: number }
  waiter_tip: number
  other: { items: LiquorItem[]; total: number }
  card_surcharge: CardSurcharge | null
  payment_method: string | null
  subtotal: number
  grand_total: number
}

export default function BillPage({
  params,
}: {
  params: Promise<{ room_id: string }>
}) {
  const { room_id } = use(params)
  const router = useRouter()
  const [bill, setBill] = useState<BillData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // 2026-04-24 P1 fix: room_id 변경 시 refetch 안 되던 버그.
  useEffect(() => {
    fetchBill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room_id])

  async function fetchBill() {
    try {
      // 방의 세션 ID 조회
      const roomRes = await apiFetch(`/api/rooms?room_uuid=${room_id}`)
      if (!roomRes.ok) { setError("방 정보를 불러올 수 없습니다."); return }
      const roomData = await roomRes.json()
      const room = (roomData.rooms ?? []).find((r: { room_uuid: string }) => r.room_uuid === room_id)
      const sessionId = room?.active_session_id
      if (!sessionId) { setError("활성 세션이 없습니다."); return }

      // 청구서 조회
      const billRes = await apiFetch(`/api/sessions/bill?session_id=${sessionId}`)
      if (billRes.ok) {
        setBill(await billRes.json())
      } else {
        setError("청구서를 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  function fmt(v: number): string {
    return v.toLocaleString() + "원"
  }

  function fmtTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-400 text-sm">로딩 중...</div>
      </div>
    )
  }

  if (error || !bill) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
        <p className="text-red-500 text-sm">{error || "청구서를 불러올 수 없습니다."}</p>
        <button onClick={() => router.back()} className="text-blue-500 text-sm underline">뒤로가기</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200 pb-20 print:bg-white print:text-gray-900">
      {/* 2026-04-25: 화면에선 다크 (앱 일관성), 인쇄 시만 밝게. */}
      <div className="max-w-md mx-auto px-6 py-8 bg-white text-gray-900 rounded-2xl my-4 shadow-2xl print:shadow-none print:rounded-none print:my-0">
      {/* 손님용 청구서 — 밝은 테마, 인쇄 친화적 */}
        {/* 헤더 */}
        <div className="text-center border-b-2 border-gray-900 pb-4 mb-6">
          <h1 className="text-2xl font-bold tracking-wide">NOX</h1>
          <p className="text-sm text-gray-500 mt-1">{bill.room_name || "Room"}</p>
          <div className="flex justify-center gap-4 mt-2 text-xs text-gray-400">
            <span>IN {fmtTime(bill.started_at)}</span>
            {bill.ended_at && <span>OUT {fmtTime(bill.ended_at)}</span>}
          </div>
        </div>

        {/* 양주 내역 */}
        {bill.liquor.items.length > 0 && (
          <div className="mb-5">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">LIQUOR</h2>
            <div className="space-y-1">
              {bill.liquor.items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-700">
                    {item.name}
                    {item.qty > 1 && <span className="text-gray-400 ml-1">x{item.qty}</span>}
                  </span>
                  <span className="font-medium">{fmt(item.amount)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm font-semibold mt-2 pt-2 border-t border-gray-200">
              <span>양주 소계</span>
              <span>{fmt(bill.liquor.total)}</span>
            </div>
          </div>
        )}

        {/* 기타 주문 */}
        {bill.other.items.length > 0 && (
          <div className="mb-5">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">OTHER</h2>
            <div className="space-y-1">
              {bill.other.items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-700">
                    {item.name}
                    {item.qty > 1 && <span className="text-gray-400 ml-1">x{item.qty}</span>}
                  </span>
                  <span className="font-medium">{fmt(item.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 스태프 타임 */}
        {bill.time.count > 0 && (
          <div className="mb-5">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">TIME</h2>
            <div className="space-y-1">
              {bill.time.entries.map((e, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-700">
                    {e.category} <span className="text-gray-400">{e.time_minutes}분</span>
                  </span>
                  <span className="font-medium">{fmt(e.amount)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm font-semibold mt-2 pt-2 border-t border-gray-200">
              <span>타임 소계 ({bill.time.count}건)</span>
              <span>{fmt(bill.time.total)}</span>
            </div>
          </div>
        )}

        {/* 웨이터 팁 */}
        {bill.waiter_tip > 0 && (
          <div className="mb-5">
            <div className="flex justify-between text-sm">
              <span className="text-gray-700">웨이터 봉사비</span>
              <span className="font-medium">{fmt(bill.waiter_tip)}</span>
            </div>
          </div>
        )}

        {/* 소계 */}
        <div className="border-t-2 border-gray-300 pt-3 mb-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">소계</span>
            <span className="font-semibold">{fmt(bill.subtotal)}</span>
          </div>
        </div>

        {/* 카드 수수료 */}
        {bill.card_surcharge && (
          <div className="mb-3 space-y-1">
            <div className="flex justify-between text-sm text-gray-500">
              <span>카드수수료</span>
              <span>{fmt(bill.card_surcharge.card_fee)}</span>
            </div>
            {bill.card_surcharge.manager_margin > 0 && (
              <div className="flex justify-between text-sm text-gray-500">
                <span>카드 추가</span>
                <span>{fmt(bill.card_surcharge.manager_margin)}</span>
              </div>
            )}
          </div>
        )}

        {/* 총액 */}
        <div className="border-t-2 border-gray-900 pt-4 mb-6">
          <div className="flex justify-between items-center">
            <span className="text-lg font-bold">TOTAL</span>
            <span className="text-2xl font-bold">{fmt(bill.grand_total)}</span>
          </div>
          {bill.payment_method && (
            <div className="text-right mt-1">
              <span className="text-xs text-gray-400 uppercase">
                {bill.payment_method === "cash" ? "CASH" :
                 bill.payment_method === "card" ? "CARD" :
                 bill.payment_method === "credit" ? "CREDIT" : "MIXED"}
              </span>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="text-center text-xs text-gray-300 border-t border-gray-200 pt-4">
          <p>Thank you for visiting NOX</p>
        </div>

        {/* 관리자 버튼 (인쇄 시 숨김) */}
        <div className="mt-8 space-y-2 print:hidden">
          <button
            onClick={() => window.print()}
            className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-medium"
          >
            인쇄
          </button>
          {/* 2026-04-24: 인쇄 + 기록 숨김(archive) 원샷 버튼.
              archive 는 hard delete 가 아니라 archived_at 타임스탬프만 찍어
              운영 UI 에서 숨기고 DB 에는 그대로 남긴다 (세법 5년 보관 +
              분쟁 증빙). owner/manager + finalized 영수증 전용. */}
          <PrintAndArchiveButton
            roomId={room_id}
            onDone={() => router.push(`/counter`)}
          />
          <button
            onClick={() => router.push(`/counter/${room_id}`)}
            className="w-full py-3 rounded-xl bg-gray-100 text-gray-600 text-sm"
          >
            돌아가기
          </button>
        </div>
      </div>
    </div>
  )
}
