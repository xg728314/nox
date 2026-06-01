"""
nox-mock HTML 일괄 변환 스크립트
iOS App Store 심사 통과를 위한 단어 추상화

- nox-mock 의 HTML/CSS 를 변환
- public/m 으로 복사
- 파일별 변환 통계 출력
"""
import os
import re
import shutil
from pathlib import Path

SRC_DIR = Path(r"C:\work\nox-mock")
DST_DIR = Path(r"C:\work\nox\public\m")

# 변환 매핑 — 순서 매우 중요 (긴 패턴 먼저)
# 각 항목: (정규식, 치환값, 통계용 키)

# 카운트 대상 패턴 (변환 전 카운트)
COUNT_PATTERNS = {
    "셔츠": r"셔츠",
    "퍼블릭": r"퍼블릭",
    "하퍼": r"하퍼",
    "셔하": r"셔하",
    "완티": r"완티",
    "반티": r"반티",
    "차3": r"차3",
    "빵3": r"빵3",
    "반차3": r"반차3",
    "메이드": r"메이드",
    "떼는": r"떼는",
    "인센": r"인센",
    "손님": r"손님",
    "마블": r"마블",
    "라이브": r"라이브",
    "신세계": r"신세계",
    "아지트": r"아지트",
    "7층": r"7층",
    "8층": r"8층",
    "파티": r"파티",
    "버닝": r"버닝",
    "흑백": r"흑백",
    "아라요": r"아라요",
    "아우라": r"아우라",
    "라엔": r"라엔",
    "황진이": r"황진이",
    "새벽": r"새벽",
}

# 변환 규칙 — 순서대로 적용 (긴 것 먼저!)
# (pattern, replacement) — re.sub 로 적용
TRANSFORMS = [
    # ─── 종목 + 시간 조합 (가장 긴 것부터) ───
    (r"셔츠\s*\+\s*하퍼", "S+H 타입"),
    (r"셔하", "S+H"),
    (r"반차3", "하프+추가"),

    # ─── 종목 단독 ───
    (r"셔츠", "S 타입"),
    (r"퍼블릭", "P 타입"),
    (r"퍼블", "P 타입"),       # "퍼블" 약자 → P 타입
    (r"하퍼", "H 타입"),

    # ─── 시간 약자 ───
    (r"완티", "풀 (60분)"),
    (r"반티", "하프 (30분)"),
    (r"차3", "추가 (15분)"),
    (r"빵3", "추가 (15분)"),

    # ─── 단독 약자 "완" / "반" → 시간 (종목 변환 직후, 문맥 = "타입 완"/"타입 반") ───
    # "S 타입 완" / "P 타입 완" / "H 타입 완" → "S 타입 풀 (60분)" 등
    (r"(S 타입|P 타입|H 타입) 완(?![가-힣])", r"\1 풀 (60분)"),
    (r"(S 타입|P 타입|H 타입) 반(?![가-힣])", r"\1 하프 (30분)"),

    # ─── 메이드 (복합어 먼저) ───
    (r"곧 끝나는 메이드", "곧 끝나는 세션"),
    (r"메이드당 떼는 돈", "세션당 매니저 수익"),
    (r"메이드 시작", "세션 시작"),
    (r"메이드 등록", "세션 등록"),
    (r"메이드 추가", "세션 추가"),
    (r"메이드 갯수", "세션 갯수"),
    (r"메이드 대기", "세션 대기"),
    (r"메이드 없음", "세션 없음"),
    (r"메이드 알림", "세션 알림"),
    (r"메이드", "세션"),

    # ─── 정산 단어 ───
    (r"떼는 금액", "매니저 수익"),
    (r"떼는 돈", "매니저 수익"),
    (r"떼는", "공제"),
    (r"인센티브", "인센티브"),  # 이미 인센티브이면 그대로
    (r"인센", "인센티브"),
    (r"손님", "고객"),

    # ─── 매장 이름 (긴 것부터) ───
    (r"황진이", "지점 L"),
    (r"아라요", "지점 I"),
    (r"아우라", "지점 J"),
    (r"신세계", "지점 B"),
    (r"아지트", "지점 C"),
    (r"마블", "본 매장"),
    (r"라이브", "지점 A"),
    (r"버닝", "지점 G"),
    (r"흑백", "지점 H"),
    (r"파티", "지점 F"),
    (r"라엔", "지점 K"),
    (r"새벽", "지점 M"),
    (r"7층", "지점 D"),
    (r"8층", "지점 E"),
]

# 변환 후 카운트 (변환 결과가 잘 되었는지)
AFTER_COUNT_PATTERNS = {
    "셔츠": r"셔츠",
    "퍼블릭": r"퍼블릭",
    "하퍼": r"하퍼",
    "셔하": r"셔하",
    "완티": r"완티",
    "반티": r"반티",
    "차3": r"차3",
    "빵3": r"빵3",
    "반차3": r"반차3",
    "메이드": r"메이드",
    "떼는": r"떼는",
    "손님": r"손님",
    "마블": r"마블",
    "라이브": r"라이브",
    "신세계": r"신세계",
    "아지트": r"아지트",
    "7층": r"7층",
    "8층": r"8층",
    "파티": r"파티",
    "버닝": r"버닝",
    "흑백": r"흑백",
    "아라요": r"아라요",
    "아우라": r"아우라",
    "라엔": r"라엔",
    "황진이": r"황진이",
    "새벽": r"새벽",
}


def count_words(text, patterns):
    """주어진 패턴들의 등장 횟수를 카운트."""
    return {k: len(re.findall(p, text)) for k, p in patterns.items()}


def transform_text(text):
    """변환 규칙을 순서대로 적용."""
    for pattern, replacement in TRANSFORMS:
        text = re.sub(pattern, replacement, text)
    return text


def process_file(src_path: Path, dst_path: Path):
    """파일 1개 변환 + 복사."""
    text = src_path.read_text(encoding="utf-8")

    # CSS 파일은 변환 안 함 (변수만 있음)
    if src_path.suffix == ".css":
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        dst_path.write_text(text, encoding="utf-8")
        return {}, {}

    before = count_words(text, COUNT_PATTERNS)
    transformed = transform_text(text)
    after = count_words(transformed, AFTER_COUNT_PATTERNS)

    dst_path.parent.mkdir(parents=True, exist_ok=True)
    dst_path.write_text(transformed, encoding="utf-8")

    return before, after


def main():
    print("[변환 시작]")
    print(f"src: {SRC_DIR}")
    print(f"dst: {DST_DIR}")
    print()

    files = sorted(SRC_DIR.iterdir())
    summary = []

    for src_file in files:
        if not src_file.is_file():
            continue
        dst_file = DST_DIR / src_file.name
        before, after = process_file(src_file, dst_file)

        if src_file.suffix == ".css":
            print(f"{src_file.name}: 변경 없음 (변수만 유지)")
            continue

        # 변환 통계 (before > 0 인 항목만 표시)
        changed = [
            f"{k} {before[k]}→{after.get(k, 0)}"
            for k in before
            if before[k] > 0
        ]
        line = f"{src_file.name}: " + " / ".join(changed) if changed else f"{src_file.name}: 변환 없음"
        print(line)
        summary.append((src_file.name, before, after))

    print()
    print("[변환 완료]")
    print(f"총 {len(summary)} 개 HTML 파일 변환")


if __name__ == "__main__":
    main()
