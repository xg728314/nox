package kr.ai.nox;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

/**
 * NOX MainActivity.
 *
 * Capacitor BridgeActivity 를 상속받아 Android WebView 설정 커스터마이징.
 *
 * 핵심 설정:
 *   1. WebView UTF-8 인코딩 명시 (한글 깨짐 방지).
 *   2. WebView 캐시 정책 — LOAD_DEFAULT (HTTP 캐시 헤더 따름, NOX 서버는
 *      이미 최적화된 max-age + SWR 헤더 보냄).
 *   3. JavaScript / DOM Storage / Database 활성화.
 *   4. Mixed content 차단 (HTTPS only).
 *   5. UserAgent 에 "NOX-App" suffix 추가 — 서버에서 앱 사용자 식별 가능.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Capacitor Bridge 가 제공하는 WebView 핸들 가져오기
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebSettings settings = this.bridge.getWebView().getSettings();

            // 1. UTF-8 명시 — 한글 안전 표시 (Android WebView 는 default UTF-8
            //    이지만 charset 자동 감지 실패 케이스 대비).
            settings.setDefaultTextEncodingName("UTF-8");

            // 2. JavaScript + DOM Storage 활성화 (Capacitor 가 이미 켜지만
            //    명시 보강).
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);

            // 3. 캐시 — 서버 헤더 따름. NOX 서버가 max-age, SWR 적절히 보냄.
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);

            // 4. Mixed content 차단 — HTTPS 만 허용 (보안).
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

            // 5. UserAgent suffix — 서버에서 "NOX-App" 으로 앱 사용자 인식 가능.
            //    향후 서버 측에서 라벨 모드 자동 결정 등에 활용.
            String ua = settings.getUserAgentString();
            if (ua != null && !ua.contains("NOX-App")) {
                settings.setUserAgentString(ua + " NOX-App/1.0");
            }

            // 6. 줌 차단 (운영 화면 의도치 않은 줌 방지).
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);

            // 7. 폰트 크기 — 시스템 설정 따름 (사용자 접근성 존중).
            //    카운터 화면은 자체 디자인으로 처리, 시스템 글꼴 변경은 그대로 반영.
        }
    }
}
