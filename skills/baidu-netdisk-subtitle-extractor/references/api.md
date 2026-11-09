# 百度网盘接口参考（本项目实抓校正）

全部端点为 `https://pan.baidu.com` 下的同源相对 URL，仅在已登录的浏览器 Console 中可用。接口为网页版私有接口，百度可能随时变更；脚本的策略是「优先复用页面自己发出的真实请求，再按模板试探」。

## 1. 通用约定

| 项 | 说明 |
|---|---|
| 会话 | `fetch(url, { credentials: "include" })`，靠浏览器 Cookie，脚本不读取 BDUSS / STOKEN / `document.cookie` |
| bdstoken | 依次从被嗅探 URL 的 `bdstoken=` 参数、`window.locals.bdstoken`、`window.yunData.MYBDSTOKEN`、`capturedToken`、含 `bdstoken` 的 `localStorage` 项获取；面板可手填 |
| 公共参数 | `app_id=250528`、`clienttype=0`、`web=1`、`channel=chunlei`、`bdstoken`、`dp-logid`（20 位数字随机串，可用 `Date.now()` + 7 位随机数生成） |
| 超时 | 列表/群接口 20 s，字幕接口 15 s，字幕直链 20 s；`AbortController` 控制 |
| 规模保护 | 目录分页上限 500 页；目录层级 guard 3000；群 `shareinfo` guard 200；并发 1–8，默认 3；默认间隔 300 ms |
| 路径 | `path` 为网盘绝对路径；页面 hash 中的 `?path=`、`#/dir/` 需 `decodeURIComponent` |

请求嗅探：脚本 hook `window.fetch` 与 `XMLHttpRequest.prototype.open`，命中 `/mbox/(group|msg)/|method=streaming|mediainfo|subtitle/i` 时保存 URL 与完整响应文本（最多 120 条），并分类为 `groups` / `listshare` / `shareinfo` / `streaming` 模板。群模式优先复用这些真实请求，只替换 `gid`、`fs_id`、`msg_id`、`page` 等 ID 类参数。

## 2. 我的网盘

### 目录列表

```
GET /rest/2.0/xpan/file?method=list&dir=<绝对目录>&page=1&num=100&web=web&order=name&desc=0
→ { errno: 0, list: [ { server_filename, path, fs_id, isdir, category } ] }
```

`list.length < 100` 视为最后一页。`isdir` 可能是 `1`、`"1"` 或 `true`；`category === 1` 或后缀命中 16 种视频扩展名视为视频。扫描用 BFS 递归子目录。

### 字幕轨道

```
GET /rest/2.0/xpan/file?method=streaming&path=<视频绝对路径>&type=M3U8_SUBTITLE_SRT
→ M3U8 文本（不是 JSON）
```

主脚本按顺序试探 4 组组合，成功后记住命中的组合：

| 组合 | 追加参数 |
|---|---|
| A 基础 | `type=M3U8_SUBTITLE_SRT` |
| B 带 web 参数 | `app_id=250528&clienttype=0&web=1&bdstoken=<token>` |
| C 带 fs_id | `fs_id=<fs_id>` |
| D M3U8_SUBTITLE | `type=M3U8_SUBTITLE` |

解析 M3U8 中的 `#EXT-X-MEDIA:TYPE=SUBTITLES` 行，取 `NAME`、`LANGUAGE`、`URI`；`URI` 为 `//` 或 `/` 开头时补全协议/源。按名称中的「中文 / Chinese / zh」「英文 / English / en」标记轨道语言，供「中文优先」筛选。

### 字幕内容

对轨道直链依次用 `credentials: "include"`、`"omit"` 请求，校验响应含 `-->` 才认为成功：

- 标准 SRT 文本直接使用；
- 若内容是 JSON 数组（或 `{list|subtitles|data}` 数组），按 `from/to`（或 `begin/end`）+ `content`（或 `text`）转换成 SRT；
- 去掉时间轴、按空行分块得到纯文本稿。

## 3. 群组共享文件库

### 群组列表

```
GET /mbox/group/list?start=0&limit=50&type=1&t=<时间戳>&bdstoken=<token>&channel=chunlei&web=1&app_id=250528&clienttype=0
```

响应中的数组可能位于 `group_list` / `groups` / `list` / `data` / `result` / `records.*`，脚本用 `pickArray()` 容错提取，取 `gid`（或 `group_id`/`id`）与 `group_name`（或 `name`/`title`/`nick_name`）。

### 群文件库顶层项

```
GET /mbox/group/listshare?clienttype=0&app_id=250528&web=1&dp-logid=<20位>&type=2&gid=<gid>&limit=50&desc=1[&last_msg_time=<游标>]
→ records.msg_list[].file_list[]
```

**`type=2` 是实测关键**：用 `type=1` 会返回 `errno=0` 但 `msg_list` 为空。翻页由 `has_more` + `last_msg_time` 控制。

`msg_list[].file_list[]` 字段：`server_filename`、`fs_id`、`isdir`（`"1"`）、`path`（URL 编码）、`category`；`msg` 层字段：`msg_id`、`group_id`/`gid`、`uk`/`from_uk`。脚本把顶层项规范化为 `{name, fs_id, isdir, category, msg_id, uk, gid, rawPath}`。

### 目录内容

```
GET /mbox/msg/shareinfo?from_uk=<uk>&msg_id=<msg_id>&type=2&num=100&page=1&fs_id=<目录fs_id>&gid=<gid>&limit=100&desc=1&clienttype=0&app_id=250528&web=1
```

响应记录数组可能藏在 `records` / `list` / `file_list` / `data.list` / `records.list`；`has_more === 1|true|"1"` 时继续翻页。若页面曾手动点开该目录，脚本会直接复用嗅探到的响应。

### 群文件字幕（无公开接口）

按以下顺序试探；全部失败即判定「无字幕」：

1. **S 嗅探模板**：把页面播放时抓到的 `streaming` / `subtitle` 请求当模板，用 `applyTemplate()` 只替换 `fs_id`、`msg_id`、`gid`/`group_id`、`uk`/`from_uk`、`share_id`。
2. **G1**：`/rest/2.0/xpan/file?method=streaming&fs_id&msg_id&from_uk&gid&type=M3U8_SUBTITLE_SRT&...`
3. **G2**：同接口改用 `path=<群内相对路径>` + `fs_id`。
4. **G3**：`/api/mediainfo?type=VideoURL&fs_id&msg_id&uk&gid&media=1&dlink=1&...`

三者都解析 M3U8 字幕轨道；群文件很可能压根没有智能字幕，此时应转存到自己的网盘后再按「我的网盘」流程处理。

## 4. 辅助脚本使用的端点

| 用途 | 端点与关键参数 |
|---|---|
| 群文件转存（目录扫描） | `GET /mbox/msg/shareinfo?from_uk=&msg_id=&type=2&num=100&page=&fs_id=&gid=&limit=100&desc=1&clienttype=0&app_id=250528&web=1` |
| 我的网盘目录（转存对比） | `GET /api/list?dir=&order=name&desc=0&showempty=1&...&bdstoken=` |
| 创建文件夹 | `POST /api/create?a=commit&bdstoken=&dp-logid=`，body：`path`、`isdir=1`、`block_list=[]` |
| 批量转存 | `POST /mbox/msg/transfer?channel=chunlei&clienttype=0&web=1&app_id=250528&logId=&bdstoken=&dp-logid=`，body：`from_uk`、`msg_id`、`path=<目标目录>`、`ondup=newcopy`、`async=4`、`fs_ids=<JSON 数组>`、`type=2`、`gid` |
| 重命名 | `POST /api/filemanager?async=2&onnest=fail&opera=rename&bdstoken=&clienttype=0&app_id=250528&web=1&dp-logid=`，body 同 query + `filelist=[{"id":fs_id,"path":"/a/b.mp4","newname":"b.mp4"}]` |
| 删除（改名冲突时） | `POST /api/filemanager?...&opera=delete&newVerify=1`，body `filelist=["/a/b.mp4"]`（进回收站，可恢复） |
| 视频时长 | `GET /api/mediainfo?type=VideoURL&path=&fs_id=&devuid=0%1&clienttype=1&channel=android_15_25010PN30C_bd-netdisk_1523&nom3u8=1&dlink=1&media=1&origin=dlna` → `json.info.duration`（秒） |

`Content-Type` 均为 `application/x-www-form-urlencoded; charset=UTF-8`；token、logId、dp-logid 需 `encodeURIComponent`。

## 5. 错误码（来自重命名脚本 `errnoText()`）

| errno | 含义 |
|---|---|
| `0` | 成功 |
| `-6` | 未登录或无权限（刷新页面重新登录） |
| `111` | bdstoken 已失效（刷新页面或手填新 token） |
| `12` | 目标位置已存在同名文件 |
| `-9` | 文件不存在或路径失效 |
| `-7` | 参数错误 |
| `31034` | 操作太频繁被限流（降低并发、加大间隔） |

其他端点返回的 `errno`/`errmsg` 直接透传到日志与诊断文件；诊断文件包含最近 25 条请求的 URL 与响应片段，外发前必须清理其中的 token 与个人信息。
