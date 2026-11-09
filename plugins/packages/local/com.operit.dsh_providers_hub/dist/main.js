"use strict";
/** 包入口：注册侧栏导航 + UI 路由 + 设置页入口。 */

const hubUi = require("./ui/hub.ui.js");

const ROUTE = "toolpkg:com.operit.dsh_providers_hub:ui:jet_hub_panel";

function registerToolPkg() {
  ToolPkg.registerUiRoute({
    id: "jet_hub_panel",
    route: ROUTE,
    runtime: "compose_dsl",
    screen: hubUi.default,
    params: {},
    keepAlive: true,
    title: { zh: "Jet Hub", en: "Jet Hub" },
  });

  // ⚠️ icon 用 "ScubaDiving"：这是已验证可用的图标名（现有 DSH 包就用它）。
  // 未知名字可能让 registerNavigationEntry 直接抛错 —— 表现就是「侧栏什么都没出现」。
  ToolPkg.registerNavigationEntry({
    id: "jet_hub_panel_sidebar",
    route: ROUTE,
    surface: "main_sidebar_plugins",
    title: { zh: "Jet Hub", en: "Jet Hub" },
    icon: "ScubaDiving",
    order: 132,
  });

  return true;
}

exports.registerToolPkg = registerToolPkg;