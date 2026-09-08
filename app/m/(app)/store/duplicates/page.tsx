"use client"
/**
 * /m/store/duplicates — 동명이인 정리 전용 페이지
 *
 * R35 (2026-09-09): 「이름이 같은 아가씨」 를 병합 or 구분.
 *   - 병합: 같은 사람 실수로 여러 계정 생김 → 하나로 통합
 *   - 구분: 다른 사람인데 이름만 같음 → A/B/C suffix
 *
 * 진입:
 *   - 전체메뉴 → 매장 → 「동명이인 정리」
 *   - 출근 페이지에서 「동명이인 N건」 배너 클릭 → 자동 open (?sheet=1)
 */
import { useEffect, useState } from "react"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { DuplicateHostessSheet } from "../../../_components/DuplicateHostessSheet"

export default function DuplicatesPage() {
  const [open, setOpen] = useState(true) // 진입 즉시 시트 오픈

  return (
    <div className="min-h-dvh bg-[#F5F0E5] pb-24">
      <PageHeader title="동명이인 정리" backHref="/m/me" />
      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-white border border-[#D8D2C8] p-5 text-center">
          <div className="text-[48px] mb-2">👥</div>
          <div className="text-[14px] font-black text-[#2D2B26] mb-1">동명이인 정리</div>
          <div className="text-[11px] font-bold text-[#7A746A] leading-relaxed mb-4">
            같은 이름 아가씨를 감지해서 병합 or 이름 구분을 도와줍니다.
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="w-full rounded-xl bg-[#C49B61] py-3 text-[13px] font-extrabold text-white active:bg-[#A87D45]"
          >
            👀 동명 그룹 열기
          </button>
        </div>

        <div className="mt-4 rounded-2xl bg-[#FAF5EC] border border-[#EDE7DA] p-4">
          <div className="text-[11px] font-black text-[#8C6A3A] mb-2 uppercase tracking-wider">
            언제 쓰나요?
          </div>
          <ul className="text-[11px] font-bold text-[#7A746A] leading-relaxed space-y-1 pl-4 list-disc">
            <li>채팅 파서가 오탈자로 새 hostess 를 만든 경우</li>
            <li>손동 등록 + 파서 자동 등록으로 중복이 쌓인 경우</li>
            <li>실제로 이름이 같은 아가씨 2명 (구분 필요) 인 경우</li>
          </ul>
        </div>

        <div className="mt-3 rounded-2xl bg-red-50 border border-red-200 p-4">
          <div className="text-[11px] font-black text-red-800 mb-1">⚠ 병합 주의</div>
          <div className="text-[11px] font-bold text-red-700 leading-relaxed">
            병합은 <b>되돌리기 불가</b>. 세션 이력이 keeper 로 이관되고 나머지 membership 은 삭제됩니다.
            같은 사람이 확실할 때만 사용하세요.
          </div>
        </div>
      </div>

      <DuplicateHostessSheet open={open} onClose={() => setOpen(false)} />
      <TabBar />
    </div>
  )
}
