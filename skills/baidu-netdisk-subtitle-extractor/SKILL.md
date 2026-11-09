---
name: baidu-netdisk-subtitle-extractor
description: Batch-extract AI-generated subtitles from Baidu Netdisk (pan.baidu.com) videos and export TXT/SRT/ZIP grouped by folder; also covers group shared file libraries, request sniffing and API diagnostics, group-to-personal transfer, batch rename and video duration export. This skill should be used when a user asks to download or export 百度网盘 AI/智能字幕 or SRT subtitles in bulk, work with 群组共享文件库 files, troubleshoot missing subtitle tracks, or transfer group files before extraction. All scripts are pasted into the logged-in pan.baidu.com browser Console and never run in Node.
---

# 百度网盘 AI 字幕批量提取与导出

Marketplace summary: Extract AI-generated subtitles from Baidu Netdisk videos and export them in batches as TXT, SRT or ZIP.

## 概述

把 `BaiduNetdiskVideoExtractor` 项目的浏览器 Console 脚本集合封装为一个可分发、可由 Agent 调用的 Skill。核心能力：扫描网盘目录中的视频 → 解析智能字幕 M3U8 轨道 → 抓取 SRT → 生成纯文本稿 → 按目录分层打包 ZIP。附带群组共享文件库支持、请求嗅探与诊断、群文件转存、批量重命名、视频时长导出。

## 适用范围与边界

- 仅提取字幕文本，不下载视频本体；不读写 BDUSS/Cookie，不把凭据或用户文件回传到任何服务器。所有请求在用户已登录的浏览器会话中以 `credentials: "include"` 同源发出。
- 所有脚本必须在 `https://pan.baidu.com` 页面的 F12 Console 中整段粘贴执行，不得用 `node`、`python` 或服务端直接运行；无 npm 依赖、无构建步骤。
- 首次粘贴前向用户说明「Console 粘贴脚本」的固有风险，并让用户自行确认脚本来源可信。
- `scripts/group-transfer-*.js` 中的 `PASTE_` 占位值必须在本机填写；提醒用户不要把真实 `bdstoken`、`logId`、`dp_logid` 发给他人的 Agent 或提交到公开仓库。
- 本 Skill 不改变原项目任何授权，也不包含原项目中第三方 GPL3 油猴脚本。对外分发前自行确认许可，详见 `references/troubleshooting.md`。

## 前置条件

1. Chrome/Edge 已登录百度网盘网页版，且能正常打开目标目录或群「文件库」。
2. 允许浏览器下载多个文件；打包 ZIP 时需能访问 JSZip CDN（4 个备用源，全部失败会自动降级为逐个下载）。
3. 群文件模式：先在网页里点开目标群的「文件库」并浏览目录，让脚本记录页面真实请求，再粘贴脚本。
4. 需要单视频播放页下载时才安装 Tampermonkey（本 Skill 未分发该第三方脚本）。

## 工作流决策表

| 用户需求 | 使用资源 |
|---|---|
| 批量导出我的网盘 / 群文件 AI 字幕为 TXT、SRT、ZIP | `scripts/subtitle-batch-export.js` |
| 群文件没有智能字幕，需先转存到自己的网盘 | `scripts/group-transfer-compare.js`（先对比已存在文件、断点续传）或 `scripts/group-transfer-recursive.js`（按目录递归） |
| 字幕接口失败、轨道为空、群列表为空，需要定位原因 | `scripts/subtitle-batch-export.js` 的「接口诊断 / 查看嗅探 / 导出诊断」+ `references/troubleshooting.md` |
| 批量重命名网盘文件（清理课程编号前缀等） | `scripts/batch-rename.js` |
| 导出某目录下所有视频时长为 Excel | `scripts/duration-to-xlsx.js` |
| 需要接口参数、返回结构、错误码细节 | `references/api.md` |
| 需要各脚本完整操作步骤、配置与产物说明 | `references/workflows.md` |

## 主流程：批量导出字幕

1. 引导用户登录 `pan.baidu.com`，进入目标目录；群模式先点开「文件库」浏览一次。
2. 打开 F12 → Console，读取 `scripts/subtitle-batch-export.js` 全文并交给用户粘贴执行（Agent 不得代填任何凭据）。页面右下角出现「百度网盘 · 字幕批量导出」面板。
3. 选择「来源」：`我的网盘` 或 `群组共享文件库`；按需勾选「含子目录」「跟随当前页面」（群模式无跟随选项）。
4. 点「浏览选择…」在目录树弹窗中多选目录，或点「用当前页面目录」；弹窗支持根路径、上级、名称过滤、选中当前层全部、清空选择。
5. 设置导出参数（默认值：轨道 `中文优先`、格式 `纯文本 TXT`、拆分 `每个文件夹一个文件（按目录分层）`、并发 `3`、间隔 `300` ms、`bdstoken` 留空自动获取）。需要时间轴时把格式改为 `SRT（带时间轴）` 或 `两种都要`。
6. 点「扫描视频」，在结果表格中勾选要处理的视频（可「全选/不选」）。
7. 首次使用或失败时先点「接口诊断」；必要时「查看嗅探」「导出诊断」得到 `百度网盘-诊断数据.txt`，据此按 `references/troubleshooting.md` 判断。
8. 点「开始导出」，可用「停止」「重试失败」；成功后脚本自动打包下载 `<目录名>-字幕.zip`。也可手动点「打包下载 ZIP」「下载合并文稿」「逐个下载」。
9. 从浏览器默认下载目录取回产物。ZIP 内含 `文本稿/*.txt`（含 `## 视频标题`、轨道信息、正文、`---` 分隔）与 `srt/*.srt`，所有文本文件带 UTF-8 BOM；多选目录时文件名前缀会补一层根目录名以免同名子目录混淆。
10. 若日志提示「无字幕」，按排障决策树处理，不要反复重试同一批视频。

需要程序化操作时，可调用脚本暴露的 `window.__BD_SUB__`：`scan`、`probe`、`run`、`exportZip`、`exportMerged`、`exportDiag`、`loadGroupRoot`、`state`、`sniff`。

## 两种来源的差异

| 维度 | 我的网盘 | 群组共享文件库 |
|---|---|---|
| 目录来源 | `location.hash` 的 `path` / `#/dir/` | 群组列表 → `listshare` → `shareinfo` 树 |
| 字幕接口 | 稳定：`method=streaming&type=M3U8_SUBTITLE_SRT` | 无公开接口：优先复用嗅探到的真实请求模板，再试探 `streaming` / `mediainfo` 组合 |
| 分页 | `list.length < 100` 停止，上限 500 页 | `has_more` + `last_msg_time` / 页码，guard 200 |
| 主要风险 | 字幕尚未生成，需播放页手动打开一次 | 群文件常无智能字幕、字幕直链跨域，建议先转存 |

## 鉴权与接口速查

- 鉴权：浏览器登录 Cookie（`credentials: "include"`） + `bdstoken`；`bdstoken` 从被嗅探的 URL、`window.locals.bdstoken`、`window.yunData.MYBDSTOKEN`、`localStorage`、页面脚本文本自动获取，面板可手填兜底。公共参数：`app_id=250528`、`clienttype=0`、`web=1`、`channel=chunlei`、`dp-logid`（20 位随机串）。
- 列表：`GET /rest/2.0/xpan/file?method=list&dir=&page=&num=100&web=web&order=name&desc=0`。
- 字幕轨道：`GET /rest/2.0/xpan/file?method=streaming&path=<网盘路径>&type=M3U8_SUBTITLE_SRT` → M3U8 文本 → 解析 `#EXT-X-MEDIA:TYPE=SUBTITLES` 的 `NAME/LANGUAGE/URI` → 字幕直链 → SRT 或 JSON 数组 → 纯文本。
- 群组：`/mbox/group/list`、`/mbox/group/listshare`（**必须 `type=2`**）、`/mbox/msg/shareinfo`（目录内容）。
- 完整参数、返回结构、错误码、转存/重命名/时长端点见 `references/api.md`。

## 快速排障

1. 「无字幕」数量多 → 先在播放页手动打开一次字幕确认百度已生成；群文件改为「先转存到我的网盘，再回来用我的网盘模式」。
2. 群列表为空 → 回到网页打开「文件库」浏览，再点「刷新群组」；检查「查看嗅探」是否抓到 `listshare` 请求。
3. 字幕直链跨域 / 权限错误 → 换用播放页手动下载，或先转存后再导出。
4. `errno 111`（bdstoken 失效）/ `-6`（未登录）→ 刷新页面，必要时在面板手填 `bdstoken`。
5. `31034`（操作过频繁）→ 降低并发、增大间隔，稍后重试。
6. ZIP 未生成 → 查看 JSZip CDN 是否被拦截，用「下载合并文稿」或「逐个下载」兜底。
7. 仍无法定位 → 「导出诊断」下载 `百度网盘-诊断数据.txt`，按 `references/troubleshooting.md` 逐项核对；发给他人前先删除其中的 URL 与 token 等敏感信息。

## 资源索引

`scripts/` 全部为自包含 IIFE Console 脚本，中文原文件名已改为 ASCII 便于跨平台分发；文件内容与原始项目一致（仅两个转存脚本做了脱敏与占位检查）：

| 文件 | 原文件 | 用途 | 额外依赖 |
|---|---|---|---|
| `subtitle-batch-export.js` | `字幕批量导出.js` | 主面板：扫描、嗅探、诊断、导出 | JSZip CDN（可选） |
| `group-transfer-compare.js` | `转存.txt` | 群文件转存，先对比已存在文件 | 需手填 `CONFIG` |
| `group-transfer-recursive.js` | `end.txt` | 按目录递归转存群文件 | 需手填 `CONFIG` |
| `batch-rename.js` | `rename.js` | 批量重命名面板 | 无 |
| `duration-to-xlsx.js` | `run.js` | 视频时长导出 xlsx | SheetJS CDN |

注意：`转存.txt`、`end.txt` 扩展名是历史遗留，内容是 JavaScript；本 Skill 中已改为 `.js`。

`references/`：

- `api.md`：全部接口、参数、返回结构、错误码、字幕格式解析。
- `workflows.md`：各脚本逐步操作流程、面板选项、CONFIG 填写方法、产物结构、编程接口。
- `troubleshooting.md`：限制、失败决策树、安全与对外分发检查清单。

## 安装与分发

- 安装到 CodeBuddy：把整个 `baidu-netdisk-subtitle-extractor/` 目录复制到 `~/.codebuddy/skills/`（用户级）或项目的 `.codebuddy/skills/`（项目级），Agent 会按 description 自动触发。
- 打包分发：保留顶层目录名，压缩为 zip；或用 skill-creator 的 `package_skill.py` 校验并打包，得到的 zip 可直接用于其他支持 SKILL.md 的 Agent / 市场。
- 对外上架前：确认所有 `PASTE_` 占位符仍在、包内无真实 token 或用户私有群 ID、补齐 LICENSE 与英文商品描述，并核对第三方代码授权。
