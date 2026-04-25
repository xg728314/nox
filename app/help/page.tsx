"use client"

/**
 * NOX 사용 가이드. role 별로 자주 하는 작업 + 팁.
 *
 * 2026-04-25: 실장/사장/스태프가 처음 쓸 때 막히는 지점 최소화.
 *   각 role 로 로그인하면 해당 role 섹션이 펼쳐져서 보임.
 */

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"

type Section = {
  id: string
  title: string
  icon: string
  roles: string[]
  items: { q: string; a: string | React.ReactNode }[]
}

const SECTIONS: Section[] = [
  {
    id: "counter",
    title: "카운터 운영 (실장 기준)",
    icon: "⊞",
    roles: ["manager", "owner"],
    items: [
      {
        q: "방에 손님 받기",
        a: "빈 방 카드 클릭 → 자동으로 세션 생성 → 실장 지정 + 손님 정보 입력 → 스태프 추가.",
      },
      {
        q: "스태프 여러 명 한번에 추가",
        a: "방 카드 열고 [스태프 일괄 추가] 입력창에 '이름 시간 종목' 형식으로 여러 줄 입력 → 등록. 예: '지수 60 퍼' 또는 '라 시은 은지 미자 퍼 완메' (이름만 나열).",
      },
      {
        q: "연장하기",
        a: "카드에서 [연장] 버튼 → 완티/반티/차3 선택. 스태프 선택된 경우 그 사람들만, 아니면 방 전체.",
      },
      {
        q: "외상으로 처리",
        a: "방 카드 시간 바 옆 [외상] 버튼 → 손님 이름+금액 입력 → 등록. 손님 DB 에도 자동 등록됨.",
      },
      {
        q: "체크아웃이 안 돼요",
        a: "1) 실장 미지정 → 실장 배정. 2) 스태프 종목/시간 미확정 → 확정 먼저. 3) 진행률 바를 끝까지 밀어야 완료.",
      },
      {
        q: "실수로 체크아웃 했어요",
        a: "닫힌 방 카드 우상단 ↶ (복구) 버튼 클릭. 단, 정산 확정(finalize) 후엔 불가.",
      },
    ],
  },
  {
    id: "settlement",
    title: "정산 & 매출",
    icon: "💰",
    roles: ["manager", "owner"],
    items: [
      {
        q: "정산 확정(finalize) 의미",
        a: "한번 확정하면 수정 불가. 수정하려면 새 버전 생성. 확정 전엔 draft 상태에서 자유 수정 가능.",
      },
      {
        q: "타매장 스태프 정산",
        a: "스태프는 origin_store (원소속) 기준으로 정산 귀속. 근무매장은 장소만 제공. [정산 트리] 에서 누가 누구한테 얼마 줘야 하는지 확인.",
      },
      {
        q: "정산 트리 1 / 2 / 3 단계",
        a: "[정산 트리] 상단의 1·2·3 탭은 정산 데이터의 보관 단계입니다. 매일 17:00 에 자동 진행. \n• 정산트리 1 — 오늘 발생한 정산 (이튿날 17:00 까지) \n• 정산트리 2 — 1에서 옮겨온 것 (이틀 보관) \n• 정산트리 3 — 2에서 옮겨온 것 (삼일 보관) \n• 6일 후 자동 삭제. 정산 완료된 항목은 즉시 삭제. \n인쇄가 필요하면 우상단 [🖨 인쇄] 클릭 — 모든 매장/실장/스태프 펼친 채 출력됩니다.",
      },
      {
        q: "특정 매장 정산 내역 숨기기",
        a: "[정산 트리] 의 매장 카드 우측 [내역삭제] 버튼 클릭 → **본인(실장) 시점에서만** 그 매장이 트리에서 사라집니다. 다른 실장은 그대로 보임. \n• 1·2·3 단계 자동 진행은 그대로 (cron 이 매일 17:00 처리) \n• 정산트리 3에서 3일 경과 시 모두에게서 글로벌 삭제 \n숨김 해제는 추후 설정 페이지에서 가능 (현재는 6일 후 자동 정리).",
      },
      {
        q: "월간 매출 보기",
        a: "[상세매출] 메뉴 → 상단 '기간 리포트' 버튼 → 이번달/지난달 프리셋 또는 임의 기간.",
      },
      {
        q: "양주 목표치",
        a: "[상세매출] 하단 '📈 양주 매출 목표'. 월세+관리비+기타 운영비 설정하면 '오늘 몇 병 팔아야 하는지' 자동 계산.",
      },
    ],
  },
  {
    id: "staff_mgmt",
    title: "스태프/실장 관리",
    icon: "👤",
    roles: ["owner", "manager"],
    items: [
      {
        q: "스태프 등록",
        a: "[스태프] 메뉴 → 배정, 근무기록 확인. 신규 등록은 /admin/members/create 에서.",
      },
      {
        q: "출근/퇴근 처리",
        a: "스태프 카드 [출근 ON/OFF] 토글. 담당 실장만 조작 가능.",
      },
    ],
  },
  {
    id: "issues",
    title: "문제 발견 시",
    icon: "🐞",
    roles: ["owner", "manager", "staff", "hostess"],
    items: [
      {
        q: "버그 / 이상 상황 신고",
        a: "화면 우하단 🐞 플로팅 버튼 클릭 → 종류/심각도/제목/설명 입력 → 신고. owner 가 /ops/issues 에서 확인.",
      },
      {
        q: "실시간 감시 현황 (owner)",
        a: "[감시] 메뉴 → 미등록 접근, 장시간 미체크아웃, 중복 세션 등 24시간 이상 징후를 한 화면에서. 빨간 점 배지 = 주의 필요.",
      },
    ],
  },
  {
    id: "owner",
    title: "사장 전용",
    icon: "🏪",
    roles: ["owner"],
    items: [
      {
        q: "매장 정산 전체 보기",
        a: "[매장관리] → 대시보드. 미배정 스태프 배정, 공지, 설정.",
      },
      {
        q: "영업일 마감",
        a: "[리포트] → 일일 리포트 → 하단 '영업일 마감' 버튼. draft 정산 있으면 경고.",
      },
      {
        q: "운영비 설정 (양주 목표용)",
        a: "[상세매출] → 양주 매출 목표 카드 → '설정하기' / '수정' → 월세, 관리비, 기타 입력.",
      },
    ],
  },
]

export default function HelpPage() {
  const router = useRouter()
  const profile = useCurrentProfile()
  const role = profile?.role ?? ""
  const [openId, setOpenId] = useState<string | null>(null)

  const visible = SECTIONS.filter(s =>
    s.roles.length === 0 || s.roles.includes(role),
  )

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200 pb-20">
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        <button onClick={() => router.push("/counter")} className="text-cyan-400 text-sm">← 뒤로</button>
        <span className="font-semibold">📖 사용 가이드</span>
        <div className="w-16" />
      </div>

      <div className="px-4 py-4 space-y-3 max-w-2xl mx-auto">
        <div className="rounded-xl bg-cyan-500/5 border border-cyan-500/20 p-4 text-sm text-cyan-100">
          <div className="font-semibold mb-1">NOX 카운터 OS</div>
          <p className="text-cyan-200/70 text-xs leading-relaxed">
            현재 role: <b className="text-cyan-200">{role || "비로그인"}</b>.
            자주 쓰는 기능부터 찾아볼 수 있습니다. 화면에 없는 내용은
            우하단 🐞 버튼으로 신고해주세요.
          </p>
        </div>

        {visible.map(sec => {
          const open = openId === sec.id || visible.length === 1
          return (
            <div key={sec.id} className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
              <button
                onClick={() => setOpenId(open ? null : sec.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.05]"
              >
                <span className="text-xl">{sec.icon}</span>
                <span className="flex-1 text-left font-semibold">{sec.title}</span>
                <span className="text-slate-500 text-sm">{open ? "▲" : "▼"}</span>
              </button>
              {open && (
                <div className="px-4 pb-4 space-y-3 border-t border-white/[0.05]">
                  {sec.items.map((item, i) => (
                    <div key={i} className="pt-3">
                      <div className="text-sm font-semibold text-cyan-200 mb-1">Q. {item.q}</div>
                      <div className="text-xs text-slate-400 leading-relaxed pl-3">{item.a}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {visible.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">
            로그인하시면 역할에 맞는 가이드가 표시됩니다.
          </div>
        )}

        <div className="pt-4 text-center text-[11px] text-slate-600">
          추가 도움이 필요하면 우하단 🐞 버튼으로 신고 — 운영자가 확인합니다.
        </div>
      </div>
    </div>
  )
}
