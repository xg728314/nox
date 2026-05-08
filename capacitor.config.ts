import type { CapacitorConfig } from "@capacitor/cli"

/**
 * Capacitor 설정 — NOX 앱스토어 배포용 native shell.
 *
 * 전략 (Hybrid 방식):
 *   - 앱은 Cloud Run 위 nox.ai.kr 을 WebView 로 로드.
 *   - 서버 코드 (Next.js + Supabase) 는 그대로 사용.
 *   - native 기능 (BLE, Push, Splash) 만 Capacitor 플러그인 통해 호출.
 *
 * 한글 인코딩:
 *   - WebView 는 UTF-8 default 로 처리 (Android WebView, iOS WKWebView 모두).
 *   - Next.js 응답 Content-Type: text/html; charset=utf-8 (default).
 *   - meta charset 도 layout.tsx 에서 utf-8 명시 (Next.js auto).
 *
 * 라벨:
 *   - 앱 빌드는 X-App-Mode: app 헤더 전송 → 서버가 generic 라벨 default.
 *   - 점주 매장 설정에서 라벨 customization 가능 (DB 저장).
 *
 * 빌드:
 *   - npm run build:app — Capacitor 호환 빌드 + sync.
 *   - npx cap open android — Android Studio 에서 .aab 생성.
 */
const config: CapacitorConfig = {
  appId: "kr.ai.nox",
  appName: "NOX",
  // Hybrid 모드: 빈 webDir + server.url 로 라이브 사이트 로드.
  // Static export 시엔 webDir 를 "out" 으로 변경하고 server.url 제거.
  webDir: "public",
  server: {
    // 프로덕션: nox.ai.kr 의 라이브 서버 사용.
    // dev: capacitor.config.ts 의 server.url 을 localhost:3000 으로 변경.
    url: "https://nox.ai.kr",
    cleartext: false,
    // App 모드 헤더 전달 — 서버에서 generic 라벨 default 적용.
    androidScheme: "https",
  },
  // Android WebView 한글 폰트 처리.
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: "always",
    scrollEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      launchFadeOutDuration: 300,
      backgroundColor: "#030814", // NOX 다크 테마와 일치
      androidScaleType: "CENTER_CROP",
      showSpinner: true,
      androidSpinnerStyle: "small",
      iosSpinnerStyle: "small",
      spinnerColor: "#00ADFF", // NOX cyan
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#030814",
    },
    BluetoothLe: {
      // BLE 게이트웨이 통신용. 위치 권한 필요 (Android 12 미만).
      displayStrings: {
        scanning: "BLE 게이트웨이 검색 중...",
        cancel: "취소",
        availableDevices: "사용 가능한 기기",
        noDeviceFound: "기기를 찾을 수 없습니다",
      },
    },
  },
}

export default config
