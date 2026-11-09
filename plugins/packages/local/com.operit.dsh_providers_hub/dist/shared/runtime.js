"use strict";
/**
 * dsh-providers-hub 的内置运行时：启停 DSH Web、读取鉴权 token。
 *
 * 设计前提（均在本机实测过）：
 * - DSH 宿主 + dsh-providers-hub 插件已装在 /root/dshtest，profile 名 web；
 * - `dsh web` 每次启动会在日志里打印带一次性 token 的 URL，首次访问下发 cookie；
 * - Operit 应用侧可直接访问 127.0.0.1 端口（proot 与 Android 共享 loopback）。
 */

const RUNTIME_DIR = "/root/dshtest";
const DSH_BIN = `${RUNTIME_DIR}/node_modules/.bin/dsh`;
const DSH_HOME = `${RUNTIME_DIR}/dsh-home`;
const HOST = "127.0.0.1";
const PORT = 8123;
const LOG_PATH = "/tmp/dsh_web.log";
const PID_MARKER = "node_modules/.bin/dsh web";

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

/** 启动/复用 DSH Web，返回 { ok, url, message }。幂等：已在跑就直接读日志取新地址。 */
async function ensureServer() {
  // ⚠️ 判据用「端口是否在监听」而不是 `pgrep -f`：实测 pgrep 会匹配到
  // 执行探测命令的 shell 自身（它的命令行里就含 marker），于是永远报 RUNNING，
  // 接着去读**上一次**的陈旧 token —— 表现为「一直转圈但打不开页面」。
  const healthy = await probeHealth();

  if (!healthy) {
    await stopServer(); // 清掉可能的僵死进程，避免端口占用
    await runLinux(
      [
        `cd ${shellQuote(RUNTIME_DIR)} || exit 1`,
        `: > ${shellQuote(LOG_PATH)}`,
        `export DSH_HOME=${shellQuote(DSH_HOME)}`,
        `export DSH_PROFILE=web`,
        `setsid nohup ${shellQuote(DSH_BIN)} web --host ${HOST} --port ${PORT} --no-open >> ${shellQuote(LOG_PATH)} 2>&1 &`,
        `echo STARTED`,
      ].join("\n"),
      30000,
    );
  }

  // 等端口就绪（冷启动实测 20-60 秒，给到 2 分钟）
  let ready = healthy;
  for (let i = 0; i < 60 && !ready; i += 1) {
    await sleep(2000);
    ready = await probeHealth();
  }
  if (!ready) {
    return { ok: false, url: "", message: "启动超时：DSH 未在 2 分钟内监听 8123" };
  }

  const url = extractUrl(await readLogTail());
  if (!url) {
    return { ok: false, url: "", message: "服务已监听，但日志里没有找到访问 token" };
  }
  return { ok: true, url, message: healthy ? "DSH 服务已在运行" : "DSH 服务已启动" };
}

function extractUrl(logTail) {
  if (typeof logTail !== "string") return "";
  const matches = [...logTail.matchAll(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/g)];
  if (matches.length === 0) return "";
  return matches[matches.length - 1][0];
}

/** 探测 8123 是否已在监听：用 node 连 TCP，不依赖 curl/wget。 */
async function probeHealth() {
  const probe = [
    "node -e \"",
    "const net=require('net');",
    "const s=net.connect(" + PORT + ",'" + HOST + "');",
    "s.setTimeout(3000);",
    "s.on('connect',()=>{console.log('UP');s.destroy();process.exit(0)});",
    "s.on('timeout',()=>{console.log('DOWN');s.destroy();process.exit(0)});",
    "s.on('error',()=>{console.log('DOWN');process.exit(0)});",
    "\"",
  ].join("");
  const result = await runLinux(probe, 20000);
  return String(result.output || "").includes("UP");
}

async function stopServer() {
  // ⚠️ marker 用 `[n]ode_modules` 的字符类写法：`pkill -f` 会把执行本命令的
  // shell 自己也匹配上（它的命令行含同一串），加方括号后 shell 命令行里是
  // 字面 `[n]ode_modules`，与实际进程名 `node_modules` 不再相同，避免自杀。
  const pattern = "[n]ode_modules/.bin/dsh web";
  await runLinux(
    [
      `pkill -f ${shellQuote(pattern)} >/dev/null 2>&1 || true`,
      `sleep 1`,
      `pkill -9 -f ${shellQuote(pattern)} >/dev/null 2>&1 || true`,
      `echo STOPPED`,
    ].join("\n"),
    20000,
  );
  return { ok: true, message: "DSH 服务已停止" };
}

/** 读网关密钥，供外部客户端配置 OpenAI 兼容 Provider 用。 */
async function readGatewayKey() {
  const path = `${DSH_HOME}/openai-gateway/api-key`;
  const exists = await Tools.Files.exists(path, "linux");
  if (!exists.exists) return { ok: false, key: "", message: "网关密钥尚未生成（服务未启动过）" };
  const result = await Tools.Files.read({ path, environment: "linux" });
  const key = String(result.content || "").trim();
  return key ? { ok: true, key, message: "已读取" } : { ok: false, key: "", message: "密钥文件为空" };
}

async function readLogTail() {
  try {
    const exists = await Tools.Files.exists(LOG_PATH, "linux");
    if (!exists.exists) return "";
    const result = await Tools.Files.read({ path: LOG_PATH, environment: "linux" });
    const content = String(result.content || "").trim();
    return content ? content.split(/\r?\n/).slice(-40).join("\n") : "";
  } catch (error) {
    return "";
  }
}

/** 在 proot Linux 里跑一条命令，返回 { exitCode, output }。 */
async function runLinux(script, timeoutMs) {
  const session = await Tools.System.terminal.create("dsh_providers_hub_runtime");
  const sessionId = typeof session === "string" ? session : String(session?.sessionId || session);
  let output = "";
  // ⚠️ 用 `bash -c` 而非 `bash -lc`：login shell 会重读 /etc/profile 改写 PATH，
  // 实测会把 node 挤到不可用（proot 的 profile 里没有 node 路径）。
  const result = await Tools.System.terminal.execStreaming(sessionId, `bash -c ${shellQuote(script)}`, {
    timeoutMs: timeoutMs || 60000,
    onIntermediateResult: (event) => {
      if (event && event.type === "chunk" && event.chunk !== null && event.chunk !== undefined) {
        output += String(event.chunk);
      }
    },
  });
  return {
    exitCode: typeof result?.exitCode === "number" ? result.exitCode : 0,
    output: output || String(result?.output || ""),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.ensureServer = ensureServer;
exports.stopServer = stopServer;
exports.readGatewayKey = readGatewayKey;
exports.readLogTail = readLogTail;
exports.runLinux = runLinux;
exports.extractUrl = extractUrl;
exports.CONSTANTS = { RUNTIME_DIR, DSH_HOME, HOST, PORT, LOG_PATH };