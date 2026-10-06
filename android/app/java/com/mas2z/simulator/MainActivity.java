package com.mas2z.simulator;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;

/**
 * 游戏主界面：一个 WebView，把 assets 里的网页当成本地站点来跑。
 *
 * 关键点：
 *   1. 用 https://mas2z.local/ 这个虚拟域名 + shouldInterceptRequest 读 assets，
 *      否则 file:// 下 ES 模块会被 CORS 拦掉；
 *   2. 开 DomStorage，游戏用它做自动存档和跨局结局图鉴；
 *   3. 游戏逻辑完全在页面里（web/local-api.js），不需要任何服务端。
 */
public class MainActivity extends Activity {

    private static final String ORIGIN = "https://mas2z.local/";
    private static final String START_URL = ORIGIN + "www/index.html";

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF0D1117);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);          // localStorage：自动存档 + 图鉴
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);           // 资源都走拦截器，不需要真文件访问
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // 自适应屏幕：按网页自己的 viewport meta 排版，别让 WebView 再缩放一次
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setTextZoom(100);                    // 不受系统字体大小影响，版式才稳定

        webView.setWebViewClient(new AssetClient());
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        // 让网页能画到状态栏/导航栏后面，配合 CSS 的 env(safe-area-inset-*) 自适应刘海
        webView.setFitsSystemWindows(false);

        setContentView(webView);
        webView.loadUrl(START_URL);
    }

    /** 把 https://mas2z.local/xxx 映射到 assets/xxx。 */
    private class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (!url.startsWith(ORIGIN)) {
                // 外部地址交给系统处理：v2.6 的「内容包（热更新）」允许玩家自己填一个
                // https 地址去下载新内容，所以这里不再拦。需要 INTERNET 权限（见 Manifest），
                // 而且只放行 https（明文流量在 targetSdk 34 下默认关闭）。
                return null;
            }
            String path = url.substring(ORIGIN.length());
            int query = path.indexOf('?');
            if (query >= 0) path = path.substring(0, query);
            int fragment = path.indexOf('#');
            if (fragment >= 0) path = path.substring(0, fragment);
            if (path.isEmpty() || path.endsWith("/")) path = path + "index.html";

            try {
                InputStream stream = getAssets().open(path);
                HashMap<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                return new WebResourceResponse(mimeOf(path), "utf-8", 200, "OK", headers, stream);
            } catch (IOException notFound) {
                return new WebResourceResponse(
                        "text/plain", "utf-8", 404, "Not Found", new HashMap<>(),
                        new ByteArrayInputStream(("Not found: " + path).getBytes(StandardCharsets.UTF_8)));
            }
        }
    }

    private static String mimeOf(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json") || lower.endsWith(".webmanifest")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
        return "application/octet-stream";
    }

    /** 音量键当"返回"用，其它键交给 WebView（方便以后加键盘快捷键）。 */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            finish();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
