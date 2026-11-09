# 本机插件保护区（勿删）

本目录是 **Jet Hub 插件**（包 ID `com.operit.dsh_providers_hub`）的唯一版本管理副本。
它位于 `plugins/packages/local/`，**故意放在上游打包脚本的扫描范围之外**。

## 为什么上游碰不到它（已查证，非推测）

- `tools/build_apk.sh:65`、`tools/build_release_apk.sh:66` 都执行
  `python plugins/tools/sync_plugin_packages.py --source runtime`；
- 该脚本 `--source` 的 `choices` 只有 `buildin / external / runtime / examples / all`（第 727 行）；
- 其中 `runtime` 分支只处理 `packages/buildin` 与 `packages/external`（第 755–759 行）；
- `packages/local/` **不在任何分支内**，因此打包脚本不会读取、更不会改写本目录。

## 这层保护防得住什么、防不住什么

| 风险 | 是否防得住 |
|---|---|
| 上游提交覆盖本目录文件 | 防得住（脚本不扫描该路径） |
| 合并时误改/误删本目录 | 防得住（`check_local_plugins.js` 会报差异） |
| 上游改动插件 API，导致插件失效 | **防不住**，需装新包后实测 |
| 卸载 App 导致插件数据丢失 | **防不住**，需靠本目录 + 提交到仓库兜底 |

## 常用操作

```bash
# 校验保护区是否完好（退出码 0 = 一致）
node plugins/packages/local/com.operit.dsh_providers_hub/.protect/check_local_plugins.js

# 有意修改插件后，重新登记基线
node plugins/packages/local/com.operit.dsh_providers_hub/.protect/check_local_plugins.js --update
```

## 同步上游后的固定动作

每次 `Sync fork` 或合并上游后，**先跑一次校验**，确认本目录没有被波及：

```bash
node plugins/packages/local/com.operit.dsh_providers_hub/.protect/check_local_plugins.js
```

## 记录

- 来源：本地开发的工作区副本 `pkg/src`，逐字节复制，未做改动。
- 首次入仓时间：2026-11-10