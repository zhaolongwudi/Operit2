"use strict";
/* METADATA
{
  "name": "dsh_providers_hub",
  "display_name": {
    "zh": "Jet Hub 服务",
    "en": "Jet Hub Service"
  },
  "description": {
    "zh": "启停 Jet Hub（DSH + providers-hub 插件）本地服务，查询运行状态与本机 OpenAI 网关密钥。",
    "en": "Start or stop the local Jet Hub service and inspect its status or OpenAI gateway key."
  },
  "enabled_by_default": true,
  "category": "System",
  "tools": [
    {
      "name": "get_jet_hub_status",
      "description": {
        "zh": "查询 Jet Hub 服务是否运行、访问地址、网关密钥与可用模型数。",
        "en": "Inspect whether the Jet Hub service is running, its URL, gateway key, and model count."
      },
      "parameters": []
    },
    {
      "name": "start_jet_hub",
      "description": {
        "zh": "启动 Jet Hub 服务（已运行则复用），返回可访问地址。",
        "en": "Start the Jet Hub service (reuse if running) and return its URL."
      },
      "parameters": []
    },
    {
      "name": "stop_jet_hub",
      "description": {
        "zh": "停止 Jet Hub 服务。",
        "en": "Stop the Jet Hub service."
      },
      "parameters": []
    },
    {
      "name": "list_jet_hub_models",
      "description": {
        "zh": "列出 Jet Hub 网关当前可用的模型 id（来自已登录渠道）。",
        "en": "List model ids currently available through the Jet Hub gateway."
      },
      "parameters": []
    }
  ]
}
*/

const runtime = require("../shared/runtime.js");

async function fetchJson(url, headers) {
  const response = await Tools.Net.httpGet(url, { headers });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HTTP ${response.statusCode}`);
  }
  const raw = typeof response.body === "string" ? response.body : String(response.content || "");
  return JSON.parse(raw);
}

async function get_jet_hub_status() {
  const started = await runtime.ensureServer();
  const keyResult = await runtime.readGatewayKey();
  let modelCount = 0;
  if (started.ok && keyResult.ok) {
    try {
      const payload = await fetchJson("http://127.0.0.1:8326/v1/models", {
        Authorization: `Bearer ${keyResult.key}`,
      });
      modelCount = Array.isArray(payload.data) ? payload.data.length : 0;
    } catch (error) {
      modelCount = 0;
    }
  }
  return {
    success: started.ok,
    message: started.message,
    url: started.url,
    gatewayUrl: "http://127.0.0.1:8326/v1",
    gatewayKey: keyResult.ok ? keyResult.key : "",
    modelCount,
  };
}

async function start_jet_hub() {
  const result = await runtime.ensureServer();
  return { success: result.ok, message: result.message, url: result.url };
}

async function stop_jet_hub() {
  return runtime.stopServer();
}

async function list_jet_hub_models() {
  const started = await runtime.ensureServer();
  if (!started.ok) return { success: false, message: started.message, models: [] };
  const keyResult = await runtime.readGatewayKey();
  if (!keyResult.ok) return { success: false, message: keyResult.message, models: [] };
  const payload = await fetchJson("http://127.0.0.1:8326/v1/models", {
    Authorization: `Bearer ${keyResult.key}`,
  });
  const models = (payload.data || []).map((item) => ({
    id: item.id,
    name: item.name,
    owner: item.owned_by,
  }));
  return { success: true, message: `共 ${models.length} 个模型`, models };
}

exports.get_jet_hub_status = get_jet_hub_status;
exports.start_jet_hub = start_jet_hub;
exports.stop_jet_hub = stop_jet_hub;
exports.list_jet_hub_models = list_jet_hub_models;