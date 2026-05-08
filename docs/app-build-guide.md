# NOX 앱스토어 배포 가이드

## 빌드 모드 2개

| 모드 | 명령 | 라벨 | 배포 대상 |
|------|------|------|-----------|
| **web** | `npm run build:web` | 실장/퍼블릭/셔츠/하퍼 | nox.ai.kr (현재 매장) |
| **app** | `npm run build:app` | 매니저/P이용권/S이용권/H이용권 | Google Play / App Store / 원스토어 |

---

## 한글 인코딩 — 안전 보장

### Web (nox.ai.kr)
- Next.js 가 `Content-Type: text/html; charset=utf-8` 자동 전송
- 모든 .ts/.tsx 파일 UTF-8 BOM 없음 — 정상

### App (Capacitor Android WebView)
- `MainActivity.java` 에서 `setDefaultTextEncodingName("UTF-8")` 명시
- AndroidManifest 에 `android:networkSecurityConfig` 적용 (HTTPS only)
- 한글 파일명/리소스 경로 사용 안 함

---

## 라벨 시스템

### 빌드 시점 default
```typescript
// lib/labels/index.ts
const BUILD_MODE = process.env.NEXT_PUBLIC_BUILD_MODE === "app" ? "app" : "web"
```

- `app` 모드: `lib/labels/default.ts` 의 generic 라벨
- `web` 모드 (default): `lib/labels/industry.ts` 의 industry 라벨

### 매장별 override
```sql
-- 점주가 매장 설정에서 라벨 직접 입력
ALTER TABLE store_settings
  ADD COLUMN display_labels JSONB DEFAULT '{}';

-- 예: 매니저 라벨을 "실장"으로 override
UPDATE store_settings
SET display_labels = '{"manager":"실장","service_p":"퍼블릭"}'::jsonb
WHERE store_uuid = '...';
```

코드 사용:
```typescript
import { getLabel } from "@/lib/labels"
const label = getLabel("manager", { storeOverrides: settings.display_labels })
// "실장" (점주 override) 또는 "매니저" (default)
```

---

## Android 빌드 절차

### 1. 환경 준비
- Android Studio 설치 (Hedgehog 이상)
- JDK 17 설정
- `ANDROID_HOME` 환경 변수

### 2. App 모드 빌드
```bash
npm run build:app   # Next.js 빌드 + Capacitor sync
npm run android:open  # Android Studio 열기
```

### 3. Android Studio 에서
- Build → Generate Signed Bundle/APK
- 키스토어 생성/선택
- `release` 타입 선택
- `.aab` 파일 생성 → Google Play 업로드

또는 명령행:
```bash
npm run android:build  # gradlew bundleRelease
# 출력: android/app/build/outputs/bundle/release/app-release.aab
```

---

## Google Play 등록 시 description 권장

```
NOX 매장 운영 관리

다중 매장 운영 통합 관리 솔루션입니다.

주요 기능:
- 룸/방 단위 이용권 관리
- 직원·고객 정산
- 매장별 매출 분석
- 매니저별 수수료 자동 계산
- 카드/현금/후불 결제 통합
- 외상/미수금 관리
- 영업일 자동 마감

소상공인 / 프랜차이즈 본사를 위한 운영 시스템.
```

**금지 단어** (절대 description/스크린샷에 포함하지 말 것):
- 유흥업소, 룸살롱, 단란주점, 노래방
- 아가씨, 호스티스
- 차3, 반티 (industry 슬랭)

---

## 푸시 알림 (선택)

Capacitor Push Notifications 플러그인은 Firebase Cloud Messaging (FCM) 연동 필요:

```bash
npm install @capacitor/push-notifications
```

FCM 프로젝트 생성 → `google-services.json` 다운로드 →
`android/app/` 에 배치 → `npx cap sync android`.

---

## 보안 체크리스트

- ✅ HTTPS only (`network_security_config.xml`)
- ✅ Mixed content 차단 (`MIXED_CONTENT_NEVER_ALLOW`)
- ✅ usesCleartextTraffic="false"
- ✅ 한글 UTF-8 명시
- ✅ JavaScript / DOM Storage 활성 (Capacitor 동작 필수)
- ✅ Zoom controls 차단 (운영 화면 보호)
- ✅ BLE 권한 (Android 12+ 분리 권한)
- ✅ POST_NOTIFICATIONS (Android 13+)

---

## 디버깅

### Chrome DevTools 로 Android WebView 디버깅
```bash
adb devices  # 기기 연결 확인
# Chrome 에서 chrome://inspect 접속 → Capacitor WebView 선택
```

### 로그 확인
```bash
adb logcat | findstr "Capacitor"
adb logcat | findstr "NOX"
```

---

## 자주 발생하는 문제

### 한글 깨짐
- 원인: 서버 응답 Content-Type 누락
- 해결: 모든 API route 가 NextResponse.json() 사용 (자동 charset=utf-8)

### BLE 권한 거부
- Android 12+: 사용자가 권한 명시 허용 필요
- 앱 내에서 `BleClient.initialize()` 후 자동 prompt

### 앱 시작 후 빈 화면
- 원인: HTTPS 인증서 / cleartext 차단
- 해결: nox.ai.kr SSL 정상인지 확인 (`curl -I https://nox.ai.kr`)
