"use strict";
/**
 * Jet Hub 内置面板：点开即用。
 *
 * 流程：onLoad 触发一次 → ensureServer() 幂等启动 DSH Web 并拿到带 token 的地址
 * → WebView 加载该地址 → 页面里注入 JS 自动切到 Jet Hub 面板并隐藏 DSH 其它 UI 干扰。
 */

const runtime = require("../shared/runtime.js");

/** 在 DSH 页面里自动点开 Jet Hub 侧栏入口，免去手动找。 */
const AUTO_OPEN_SCRIPT = `
(function () {
  if (window.__dshHubAutoOpenBound) return "bound";
  window.__dshHubAutoOpenBound = true;

  var attempts = 0;
  var timer = window.setInterval(function () {
    attempts += 1;
    if (attempts > 40) { window.clearInterval(timer); return; }

    var nodes = document.querySelectorAll('button, [role="button"], [role="tab"]');
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      var label = (el.getAttribute("aria-label") || "") + " " + (el.textContent || "");
      if (label.indexOf("Jet Hub") === -1) continue;
      if (el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-current")) {
        window.clearInterval(timer);
        return "already";
      }
      el.click();
      window.clearInterval(timer);
      return "clicked";
    }
    return "pending";
  }, 500);
  return "scheduled";
})();
`;

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "未知错误");
}

function Screen(ctx) {
  const { UI } = ctx;
  const colors = ctx.MaterialTheme.colorScheme;
  const webViewController = ctx.createWebViewController("dsh_hub_webview");

  const [booting, setBooting] = ctx.useState("booting", false);
  const [serverUrl, setServerUrl] = ctx.useState("serverUrl", "");
  const [statusText, setStatusText] = ctx.useState("statusText", "正在准备");
  const [errorText, setErrorText] = ctx.useState("errorText", "");
  const [reloadToken, setReloadToken] = ctx.useState("reloadToken", "0");
  const [started, setStarted] = ctx.useState("started", false);
  const [recovered, setRecovered] = ctx.useState("recovered", false);

  async function boot(force) {
    if (booting) return;
    setBooting(true);
    setErrorText("");
    setStatusText(force ? "正在重启服务" : "正在启动服务");
    try {
      if (force) await runtime.stopServer();
      const result = await runtime.ensureServer();
      if (!result.ok) {
        setErrorText(result.message);
        setStatusText("启动失败");
        return;
      }
      setServerUrl(result.url);
      setStatusText(result.message);
      setReloadToken(String(Number(reloadToken) + 1));
    } catch (error) {
      setErrorText(errorMessage(error));
      setStatusText("启动失败");
    } finally {
      setBooting(false);
    }
  }

  const overlay = serverUrl && !errorText ? [] : [
    UI.Box({
      fillMaxSize: true,
      contentAlignment: "center",
      background: colors.surface,
    }, [
      UI.Column({
        spacing: 14,
        horizontalAlignment: "centerHorizontally",
        padding: { horizontal: 24 },
      }, [
        UI.Text({
          text: booting ? statusText + "…" : (errorText ? "启动失败" : "Jet Hub"),
          style: "titleMedium",
          color: colors.onSurface,
        }),
        errorText ? UI.Text({
          text: errorText,
          style: "bodySmall",
          color: colors.error,
        }) : UI.Text({
          text: "首次启动约需 30 秒，之后会直接复用已运行的服务。",
          style: "bodySmall",
          color: colors.onSurfaceVariant,
        }),
        booting ? UI.CircularProgressIndicator({ size: 28 }) : UI.Button({
          onClick: async () => { await boot(false); },
        }, [UI.Text({ text: "重试" })]),
      ]),
    ]),
  ];

  const web = serverUrl ? [
    UI.WebView({
      key: `dsh_hub_webview_${reloadToken}`,
      controller: webViewController,
      fillMaxSize: true,
      url: serverUrl,
      javaScriptEnabled: true,
      domStorageEnabled: true,
      allowFileAccess: false,
      allowContentAccess: false,
      supportZoom: false,
      useWideViewPort: true,
      loadWithOverviewMode: true,
      onPageFinished: async () => {
        try {
          await webViewController.evaluateJavascript(AUTO_OPEN_SCRIPT);
        } catch (error) {
          console.warn("[dsh-providers-hub] auto open failed", error);
        }
      },
      onReceivedError: async () => {
        // token 失效或服务已重启时，自动重新取一次地址（只恢复一次，避免死循环）
        if (recovered || booting) return;
        setRecovered(true);
        await boot(false);
      },
    }),
  ] : [];

  return UI.Box({
    fillMaxSize: true,
    background: colors.surface,
    onLoad: async () => {
      if (started) return;
      setStarted(true);
      await boot(false);
    },
  }, [
    ...web,
    ...overlay,
  ]);
}

exports.default = Screen;