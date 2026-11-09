/**
 * 百度网盘工具箱 · 单文件融合版
 *
 * 用法：登录 https://pan.baidu.com → F12 → Console → 粘贴本文件全文 → 回车
 *       右下角出现工具箱面板，按需点击启动工具（各工具源码已内聚在本文件内）。
 *
 * 融合的 5 个功能：
 *   ① 字幕批量导出（我的网盘 / 群组共享文件库，TXT / SRT / ZIP、按目录分层、接口诊断）
 *   ② 群文件转存 · 对比断点版（先对比目标目录已存在文件，再批量转存）
 *   ③ 群文件转存 · 递归版（按目录递归创建并转存）
 *   ④ 批量重命名（正则 / 去前后缀 / 查找替换，先预览后执行）
 *   ⑤ 视频时长导出 Excel（运行即自动扫描当前目录）
 *
 * 群文件转存使用前：在下方 TRANSFER_CONFIG 填入本机参数（gid / msg_id / from_uk /
 * fs_id / bdstoken / logId / dp_logid），值从浏览器 Network 中一次成功请求复制。
 * 不要把真实 token 发给他人或提交到公开仓库。
 *
 * 说明：脚本只能在已登录的百度网盘网页 Console 中运行，不能用 node 执行；
 * 不读取 BDUSS / Cookie，只在当前浏览器会话内发起请求；不下载视频本体。
 * 未包含原项目中的第三方 GPL3 油猴脚本（已失效且选择器硬编码）。
 */

(async () => {
    // 外层不启用严格模式：保持各原脚本原有的执行语义（主脚本内部自带 'use strict'）。

    // ==========================================================
    // 统一配置：只需改这里（仅群文件转存工具需要）
    // ==========================================================
    const TRANSFER_CONFIG = {
        // 群与消息标识：从群「文件库」页面请求或主工具的诊断数据里取得
        gid: 'PASTE_GID',
        msg_id: 'PASTE_MSG_ID',
        from_uk: 'PASTE_FROM_UK',

        // 源目录：对比版用 source_fs_id + source_path；递归版用 root_fs_id
        source_fs_id: 'PASTE_SOURCE_FS_ID',
        source_path: '',
        root_fs_id: 'PASTE_ROOT_FS_ID',

        // 自己网盘中的目标根目录，例如 '/字幕转存'
        target_root: '/PASTE_TARGET_DIR',

        // 当前页面鉴权：从 Network 里一次成功的请求复制
        bdstoken: 'PASTE_BDSTOKEN',
        logId: 'PASTE_LOGID',
        dp_logid: 'PASTE_DP_LOGID'
    };

    // ==========================================================
    // 工具实现（各函数为独立作用域，互不干扰）
    // ==========================================================

    // ---------- ① 字幕批量导出 ----------
async function toolSubtitleExport() {
    'use strict';

    // ==========================================
    // 百度网盘 · 字幕批量导出（可视化面板）
    // 支持两种来源：我的网盘 / 群组共享文件库
    // ==========================================
    //
    // 用法：
    //   1. Chrome/Edge 登录百度网盘网页版
    //   2. F12 → Console → 粘贴整段 → 回车
    //   3. 右下角面板：选来源 → 选目录 → 扫描 → 开始导出
    //
    // 我的网盘接口：
    //   列表   GET /rest/2.0/xpan/file?method=list
    //   字幕   GET /rest/2.0/xpan/file?method=streaming&path=...&type=M3U8_SUBTITLE_SRT
    //
    // 群组文件库接口：
    //   群组   GET /mbox/group/list
    //   文件库 GET /mbox/group/listshare
    //   目录   GET /mbox/msg/shareinfo?from_uk=&msg_id=&fs_id=&gid=&type=2&num=100&page=1
    //           &limit=100&desc=1&clienttype=0&app_id=250528&web=1
    //   群文件字幕：无公开文档，脚本会先用“嗅探到的真实请求”当模板，再逐个试探
    // ==========================================

    const PAGE_SIZE = 100;
    const VIDEO_EXT = [
        ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".m4v",
        ".ts", ".webm", ".mpg", ".mpeg", ".3gp", ".rmvb", ".rm", ".vob"
    ];
    const ILLEGAL = /[\\/:*?"<>|\x00-\x1f]/g;
    const MAX_NAME = 80;
    const SNIFF_RE = /mbox\/(group|msg)\/|method=streaming|mediainfo|subtitle/i;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const esc = (s) =>
        String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    const $ = (id) => document.getElementById(id);
    const isDirItem = (f) =>
        f.isdir === 1 || f.isdir === "1" || f.isdir === true;

    // ==========================================
    // 0. bdstoken + 请求嗅探
    // ==========================================

    let capturedToken = "";
    const sniff = {
        hits: [],          // 请求 + 完整响应文本
        template: null,    // streaming 请求模板
        urls: {},          // 各类请求的真实 URL 模板
        data: {}           // 各类请求解析后的 JSON
    };

    function captureToken(url) {
        if (capturedToken) return;
        const m = String(url || "").match(/[?&]bdstoken=([^&#]+)/);
        if (m) capturedToken = decodeURIComponent(m[1]);
    }

    function sniffHit(kind, url, text) {
        const full = String(text || "");
        sniff.hits.push({
            t: Date.now(),
            kind: kind,
            url: String(url || ""),
            text: full.slice(0, 200000)
        });
        if (sniff.hits.length > 120) sniff.hits.shift();

        let j = null;
        try { j = JSON.parse(full); } catch (e) {}

        let key = null;
        if (/mbox\/group\/listshare|mbox\/group\/sharelist/.test(url)) key = "listshare";
        else if (/mbox\/group\/list(\?|$)/.test(url)) key = "groups";
        else if (/mbox\/msg\/shareinfo/.test(url)) key = "shareinfo";

        if (key) {
            sniff.urls[key] = String(url);
            if (!sniff.data[key]) sniff.data[key] = [];
            let gid = "";
            let fs_id = "";
            try {
                const sp = new URL(url, location.origin).searchParams;
                gid = sp.get("gid") || "";
                fs_id = sp.get("fs_id") || "";
            } catch (e) {}
            sniff.data[key].push({ url: String(url), gid: gid, fs_id: fs_id, json: j });
            if (sniff.data[key].length > 60) sniff.data[key].shift();
            console.log("%c[嗅探] 捕获 " + key + "：", "color:#d97706", url);
        }

        if (/method=streaming|subtitle/i.test(url)) {
            sniff.template = String(url);
            console.log("%c[嗅探] 捕获到字幕/播放请求模板：", "color:#d97706", url);
        }
    }

    (function hookNetwork() {
        try {
            const origFetch = window.fetch;
            window.fetch = function (...args) {
                const url =
                    typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
                try { captureToken(url); } catch (e) {}
                const p = origFetch.apply(this, args);
                if (SNIFF_RE.test(url)) {
                    p.then((r) => {
                        try {
                            const c = r.clone();
                            c.text().then((t) => sniffHit("fetch", url, t)).catch(() => {});
                        } catch (e) {}
                    }).catch(() => {});
                }
                return p;
            };
        } catch (e) {}

        try {
            const origOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                try {
                    captureToken(url);
                    this.__sniffUrl = url;
                } catch (e) {}
                const self = this;
                this.addEventListener("load", function () {
                    try {
                        if (self.__sniffUrl && SNIFF_RE.test(self.__sniffUrl)) {
                            sniffHit("xhr", self.__sniffUrl, self.responseText);
                        }
                    } catch (e) {}
                });
                return origOpen.call(this, method, url, ...rest);
            };
        } catch (e) {}
    })();

    function autoBdstoken() {
        const cands = [];
        try { if (window.locals && window.locals.bdstoken) cands.push(window.locals.bdstoken); } catch (e) {}
        try { if (window.yunData && window.yunData.MYBDSTOKEN) cands.push(window.yunData.MYBDSTOKEN); } catch (e) {}
        if (capturedToken) cands.push(capturedToken);
        try {
            for (const k of Object.keys(localStorage)) {
                if (/bdstoken/i.test(k)) {
                    const v = localStorage.getItem(k);
                    if (v && v.length <= 64) cands.push(v);
                }
            }
        } catch (e) {}
        return cands.find(Boolean) || "";
    }

    function getToken() {
        return ($("bs-token") && $("bs-token").value.trim()) || autoBdstoken();
    }

    function getMode() {
        const el = document.querySelector('input[name="bsmode"]:checked');
        return el ? el.value : "mine";
    }

    // ==========================================
    // 1. 当前页面目录（我的网盘模式）
    // ==========================================

    function getCurrentPath() {
        const hash = location.hash || "";
        let m = hash.match(/[?&]path=([^&]*)/i);
        if (m) return decodeURIComponent(m[1]);
        m = hash.match(/#\/dir\/([^?&]*)/i);
        if (m) return decodeURIComponent(m[1]);
        const sp = new URLSearchParams(location.search);
        if (sp.get("path")) return sp.get("path");
        if (sp.get("dir")) return sp.get("dir");
        return "/";
    }

    async function req(url, timeout) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeout || 15000);
        try {
            return await fetch(url, { credentials: "include", signal: ctl.signal });
        } finally {
            clearTimeout(timer);
        }
    }

    // ==========================================
    // 2. 我的网盘：列表 / 扫描
    // ==========================================

    async function listDirectory(dir) {
        let page = 1;
        const result = [];
        while (true) {
            const params = new URLSearchParams({
                method: "list",
                dir: dir,
                page: String(page),
                num: String(PAGE_SIZE),
                web: "web",
                order: "name",
                desc: "0"
            });
            const res = await req("/rest/2.0/xpan/file?" + params.toString(), 20000);
            const json = await res.json();
            if (json.errno !== 0) {
                throw new Error("读取目录失败：" + (json.errmsg || json.errno));
            }
            const list = json.list || [];
            result.push(...list);
            if (list.length < PAGE_SIZE) break;
            page++;
            if (page > 500) break;
            await sleep(30);
        }
        return result;
    }

    function isVideo(name, category) {
        const n = String(name || "").toLowerCase();
        return category === 1 || VIDEO_EXT.some((e) => n.endsWith(e));
    }

    function stripExt(name) {
        return String(name || "").replace(/\.[A-Za-z0-9]{1,10}$/, "");
    }

    async function scanVideos(root, recursive, onProgress) {
        const videos = [];
        const queue = [root];
        let guard = 0;
        while (queue.length) {
            if (++guard > 3000) throw new Error("目录层级过深，已中止");
            const d = queue.shift();
            const items = await listDirectory(d);
            for (const f of items) {
                if (isDirItem(f)) {
                    if (recursive) queue.push(f.path);
                    continue;
                }
                if (isVideo(f.server_filename, f.category)) {
                    videos.push({
                        src: "mine",
                        name: f.server_filename,
                        path: f.path,
                        fs_id: String(f.fs_id || ""),
                        root: root
                    });
                }
            }
            if (onProgress) onProgress(d, videos.length);
            await sleep(30);
        }
        videos.sort((a, b) => a.path.localeCompare(b.path));
        return videos;
    }

    // ==========================================
    // 3. 群组共享文件库
    // ==========================================

    async function groupList() {
        const caps = sniff.data.groups || [];
        for (const c of caps.slice().reverse()) {
            if (c.json && (c.json.errno === 0 || c.json.errno == null)) return c.json;
        }
        const q = new URLSearchParams({
            start: "0",
            limit: "50",
            type: "1",
            t: String(Date.now()),
            bdstoken: getToken(),
            channel: "chunlei",
            web: "1",
            app_id: "250528",
            clienttype: "0"
        });
        const r = await req("/mbox/group/list?" + q.toString(), 20000);
        return await r.json();
    }

    function pickArray(json) {
        if (!json || typeof json !== "object") return [];
        const r = json.records || {};
        const cands = [
            json.group_list, json.groups, json.list, json.data, json.result,
            r.group_list, r.groups, r.list, r.data,
            json.data && json.data.group_list,
            json.data && json.data.list,
            Array.isArray(json.records) ? json.records : null
        ];
        for (const c of cands) if (Array.isArray(c)) return c;
        return [];
    }

    // 群组列表：尽量容错地取出 gid / 名称
    function parseGroups(json) {
        const arr = pickArray(json);
        return arr.map((g) => ({
            gid: String(g.gid != null ? g.gid :
                (g.group_id != null ? g.group_id : (g.id != null ? g.id : ""))),
            name: g.group_name || g.name || g.title || g.nick_name || ("群组 " + (g.gid || g.group_id || ""))
        })).filter((g) => g.gid && g.gid !== "undefined" && g.gid !== "0");
    }

    async function fetchJson(url) {
        const r = await req(url, 20000);
        return await r.json();
    }

    // 用页面真实请求当模板：保留全部原始参数（dp-logid / type / desc ...），只替换必要参数
    function listShareUrl(gid, lastMsgTime) {
        let u = null;
        if (sniff.urls.listshare) {
            try { u = new URL(sniff.urls.listshare, location.origin); } catch (e) {}
        }
        if (!u || !/mbox\/group\/listshare|mbox\/group\/sharelist/.test(u.pathname)) {
            u = new URL("/mbox/group/listshare", location.origin);
            u.search = new URLSearchParams({
                clienttype: "0",
                app_id: "250528",
                web: "1",
                "dp-logid": String(Date.now()) + String(Math.floor(Math.random() * 1e7)).padStart(7, "0"),
                type: "2",
                limit: "50",
                desc: "1"
            }).toString();
        }
        u.searchParams.set("gid", String(gid));
        if (!u.searchParams.has("type")) u.searchParams.set("type", "2");
        if (!u.searchParams.has("limit")) u.searchParams.set("limit", "50");
        if (!u.searchParams.has("desc")) u.searchParams.set("desc", "1");
        if (!u.searchParams.has("dp-logid")) {
            u.searchParams.set("dp-logid",
                String(Date.now()) + String(Math.floor(Math.random() * 1e7)).padStart(7, "0"));
        }
        if (lastMsgTime) u.searchParams.set("last_msg_time", String(lastMsgTime));
        else u.searchParams.delete("last_msg_time");
        return u.pathname + "?" + u.searchParams.toString();
    }

    // 顶层项：优先直接复用页面自己发出的 listshare 响应
    async function fetchGroupRoots(gid) {
        const gidStr = String(gid);
        const caps = (sniff.data.listshare || []).filter((x) => !x.gid || x.gid === gidStr);
        for (const cap of caps.reverse()) {
            if (cap.json && cap.json.errno === 0) {
                const items = parseMsgList(cap.json, gidStr);
                if (items.length) {
                    log("直接复用页面抓取的 listshare 响应，顶层项 " + items.length + " 个");
                    return items;
                }
            }
        }
        const all = [];
        let lastTime = "";
        let lastErrno = 0;
        for (let i = 0; i < 20; i++) {
            let j;
            try {
                j = await fetchJson(listShareUrl(gidStr, lastTime));
            } catch (e) {
                lastErrno = -1;
                log("listshare 请求异常：" + (e.message || e));
                break;
            }
            if (!j || j.errno !== 0) {
                lastErrno = j && j.errno;
                break;
            }
            all.push(...parseMsgList(j, gidStr));
            const more = j.has_more === 1 || j.has_more === true || j.has_more === "1";
            if (!more || !j.last_msg_time) break;
            lastTime = String(j.last_msg_time);
            await sleep(200);
        }
        log("listshare 主动请求：errno=" + lastErrno + "，顶层项 " + all.length + " 个");
        return all;
    }

    // 从 listshare 响应里取出「顶层分享项」（文件夹和文件都保留）
    function parseMsgList(json, fallbackGid) {
        let rec = (json && json.records) || json || {};
        if (Array.isArray(rec)) rec = { msg_list: rec };
        const msgs = rec.msg_list || rec.list || rec.file_list || [];
        const out = [];
        for (const m of msgs) {
            const files = m.file_list || m.files || m.list || [];
            for (const f of files) {
                out.push({
                    name: f.server_filename || f.filename || f.name || f.file_name || "",
                    fs_id: String(f.fs_id != null ? f.fs_id : ""),
                    isdir: Number(f.isdir) === 1 || f.isdir === true,
                    category: f.category,
                    msg_id: String(m.msg_id != null ? m.msg_id : ""),
                    uk: String(m.uk != null ? m.uk : (m.from_uk != null ? m.from_uk : "")),
                    gid: String(m.group_id != null ? m.group_id :
                        (m.gid != null ? m.gid : (fallbackGid != null ? fallbackGid : ""))),
                    rawPath: f.path || ""
                });
            }
        }
        return out.filter((x) => x.name);
    }

    const itemName = (f) => f.server_filename || f.filename || f.name || f.file_name || "";
    const itemFsId = (f) => String(f.fs_id != null ? f.fs_id : "");

    // shareinfo 也优先复用页面真实请求的参数，只替换 id 类参数和页码
    function shareInfoUrl(o, page) {
        let u = null;
        if (sniff.urls.shareinfo) {
            try { u = new URL(sniff.urls.shareinfo, location.origin); } catch (e) {}
        }
        if (!u || !/mbox\/msg\/shareinfo/.test(u.pathname)) {
            u = new URL("/mbox/msg/shareinfo", location.origin);
            u.search = new URLSearchParams({
                from_uk: o.uk,
                msg_id: o.msg_id,
                type: "2",
                num: "100",
                page: "1",
                fs_id: String(o.fs_id),
                gid: String(o.gid),
                limit: "100",
                desc: "1",
                clienttype: "0",
                app_id: "250528",
                web: "1"
            }).toString();
        }
        const over = {
            from_uk: o.uk,
            msg_id: o.msg_id,
            fs_id: String(o.fs_id),
            gid: String(o.gid),
            page: String(page)
        };
        for (const k of Object.keys(over)) {
            if (over[k]) u.searchParams.set(k, String(over[k]));
        }
        return u.pathname + "?" + u.searchParams.toString();
    }

    // 不同版本 shareinfo 的记录数组可能藏在 records / list / data.list / records.list
    function recordsOf(j) {
        const cands = [j.records, j.list, j.file_list, j.data && j.data.list, j.data && j.data.records];
        for (const c of cands) {
            if (Array.isArray(c)) return c;
            if (c && typeof c === "object") {
                for (const x of [c.msg_list, c.list, c.file_list, c.records]) {
                    if (Array.isArray(x)) return x;
                }
            }
        }
        return [];
    }

    async function shareInfoAll(o) {
        const out = [];
        let page = 1;
        let guard = 0;
        // 先复用页面已经抓到的该目录响应（用户手动点开过文件夹时）
        const cap = (sniff.data.shareinfo || []).filter((x) => x.fs_id && x.fs_id === String(o.fs_id)).slice(-1)[0];
        if (cap && cap.json && cap.json.errno === 0) {
            const rec = recordsOf(cap.json);
            if (rec.length) out.push(...rec);
        }
        while (guard++ < 200) {
            let j;
            try {
                j = await fetchJson(shareInfoUrl(o, page));
            } catch (e) {
                if (page === 1 && !out.length) throw new Error("读取群目录失败：" + (e.message || e));
                break;
            }
            if (!j || j.errno !== 0) {
                if (page === 1 && !out.length) {
                    throw new Error("读取群目录失败：errno=" + ((j && j.errno) || "?"));
                }
                break;
            }
            const rec = recordsOf(j);
            // 第 1 页若已由嗅探提供，避免重复
            if (!(page === 1 && out.length)) out.push(...rec);
            const more = j.has_more === 1 || j.has_more === true || j.has_more === "1";
            if (!more || rec.length === 0) break;
            page++;
            await sleep(120);
        }
        return out;
    }

    function gNode(o, name, fs_id, relPath) {
        return {
            name: name,
            fs_id: String(fs_id),
            msg_id: o.msg_id,
            uk: o.uk,
            gid: o.gid,
            rel: relPath
        };
    }

    // 递归扫描群目录里的视频
    async function scanGroupDir(node, recursive, prefix, out, onProgress) {
        const records = await shareInfoAll(node);
        if (onProgress) onProgress(node.name, out.length);
        const kids = [];
        for (const f of records) {
            const nm = itemName(f);
            if (!nm) continue;
            const rel = (prefix ? prefix + "/" : "") + nm;
            if (isDirItem(f)) {
                if (recursive) kids.push(gNode(node, nm, itemFsId(f), rel));
            } else if (isVideo(nm, f.category)) {
                out.push({
                    src: "group",
                    name: nm,
                    fs_id: itemFsId(f),
                    msg_id: node.msg_id,
                    uk: node.uk,
                    gid: node.gid,
                    rel: rel,
                    folder: prefix ? prefix.split("/")[0] : node.name,
                    rootName: node.rootName || node.name
                });
            }
        }
        for (const k of kids) {
            k.rootName = node.rootName || node.name;
            await scanGroupDir(k, recursive, k.rel, out, onProgress);
            await sleep(120);
        }
        return out;
    }

    // ==========================================
    // 4. 字幕获取
    // ==========================================

    function parseM3U8(text) {
        const out = [];
        if (!text || !/EXT-X-MEDIA:TYPE=SUBTITLES/i.test(text)) return out;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!/EXT-X-MEDIA:TYPE=SUBTITLES/i.test(line)) continue;
            const name = (line.match(/NAME="([^"]*)"/) || [])[1] || "";
            const lang = (line.match(/LANGUAGE="([^"]*)"/) || [])[1] || "";
            let uri = (line.match(/URI="([^"]*)"/) || [])[1] || "";
            if (!uri) {
                const next = (lines[i + 1] || "").trim();
                if (/^https?:\/\//i.test(next)) uri = next;
            }
            if (!uri) continue;
            if (/^\/\//.test(uri)) uri = location.protocol + uri;
            else if (/^\//.test(uri)) uri = location.origin + uri;
            let lan = "und";
            const tag = name + " " + lang;
            if (/中文|Chinese|chi|zh/i.test(tag)) lan = "zh";
            else if (/英文|English|eng|en/i.test(tag)) lan = "en";
            out.push({ label: name || lang || ("轨道" + (out.length + 1)), lan: lan, url: uri });
        }
        return out;
    }

    function buildCombos(v) {
        const token = getToken();
        const base = { method: "streaming", path: v.path };
        return [
            { label: "A 基础", q: Object.assign({}, base, { type: "M3U8_SUBTITLE_SRT" }) },
            {
                label: "B 带 web 参数",
                q: Object.assign({}, base, {
                    type: "M3U8_SUBTITLE_SRT",
                    app_id: "250528",
                    clienttype: "0",
                    web: "1",
                    bdstoken: token
                })
            },
            {
                label: "C 带 fs_id",
                q: Object.assign({}, base, { type: "M3U8_SUBTITLE_SRT", fs_id: v.fs_id })
            },
            { label: "D M3U8_SUBTITLE", q: Object.assign({}, base, { type: "M3U8_SUBTITLE" }) }
        ];
    }

    // 群文件：优先复用嗅探到的真实请求，再逐个试探
    function buildGroupCombos(v) {
        const token = getToken();
        const list = [];
        if (sniff.template) {
            list.push({ label: "S 嗅探模板", url: applyTemplate(sniff.template, v) });
        }
        list.push({
            label: "G1 streaming+fs_id",
            q: {
                method: "streaming",
                fs_id: v.fs_id,
                msg_id: v.msg_id,
                from_uk: v.uk,
                gid: v.gid,
                type: "M3U8_SUBTITLE_SRT",
                app_id: "250528",
                clienttype: "0",
                web: "1",
                bdstoken: token
            }
        });
        list.push({
            label: "G2 streaming+path",
            q: {
                method: "streaming",
                path: v.rel,
                fs_id: v.fs_id,
                type: "M3U8_SUBTITLE_SRT",
                app_id: "250528",
                clienttype: "0",
                web: "1",
                bdstoken: token
            }
        });
        list.push({
            label: "G3 mediainfo",
            q: {
                type: "VideoURL",
                fs_id: v.fs_id,
                msg_id: v.msg_id,
                uk: v.uk,
                gid: v.gid,
                media: "1",
                dlink: "1",
                app_id: "250528",
                clienttype: "0",
                web: "1",
                bdstoken: token
            },
            path: "/api/mediainfo"
        });
        return list;
    }

    function applyTemplate(tplUrl, v) {
        let u;
        try {
            u = new URL(tplUrl, location.origin);
        } catch (e) {
            return tplUrl;
        }
        const map = {
            fs_id: v.fs_id,
            msg_id: v.msg_id,
            gid: v.gid,
            group_id: v.gid,
            uk: v.uk,
            from_uk: v.uk,
            share_id: v.msg_id
        };
        for (const k of Object.keys(map)) {
            if (u.searchParams.has(k) && map[k]) u.searchParams.set(k, String(map[k]));
        }
        return u.pathname + "?" + u.searchParams.toString();
    }

    async function getTracksMine(v) {
        const combos = buildCombos(v);
        const used = state.comboIndex || 0;
        const order = [used].concat([0, 1, 2, 3].filter((i) => i !== used));
        let lastRaw = "";
        for (const idx of order) {
            const c = combos[idx];
            if (!c) continue;
            try {
                const url = "/rest/2.0/xpan/file?" + new URLSearchParams(c.q).toString();
                const r = await req(url, 15000);
                const raw = await r.text();
                lastRaw = raw;
                const tracks = parseM3U8(raw);
                if (tracks.length) {
                    state.comboIndex = idx;
                    return { tracks: tracks, combo: c.label, raw: raw };
                }
                try {
                    const j = JSON.parse(raw);
                    if (j && j.errno) state.lastErrno = j.errno;
                } catch (e) {}
            } catch (e) {
                lastRaw = "请求异常：" + (e.message || e);
            }
        }
        return { tracks: [], combo: combos[used] ? combos[used].label : "A 基础", raw: lastRaw };
    }

    async function getTracksGroup(v) {
        const combos = buildGroupCombos(v);
        let lastRaw = "";
        for (const c of combos) {
            const url = c.url || ((c.path || "/rest/2.0/xpan/file") + "?" + new URLSearchParams(c.q).toString());
            try {
                const r = await req(url, 15000);
                const raw = await r.text();
                lastRaw = raw;
                const tracks = parseM3U8(raw);
                if (tracks.length) {
                    state.groupCombo = c.label;
                    return { tracks: tracks, combo: c.label, raw: raw };
                }
            } catch (e) {
                lastRaw = "请求异常：" + (e.message || e);
            }
        }
        return { tracks: [], combo: "(全部失败)", raw: lastRaw };
    }

    function fmtTime(sec) {
        const ms = Math.round(Math.max(0, Number(sec) || 0) * 1000);
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        const milli = ms % 1000;
        return (
            String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" +
            String(s).padStart(2, "0") + "," + String(milli).padStart(3, "0")
        );
    }

    function srtFromJson(items) {
        if (!Array.isArray(items)) return "";
        return items.map((it, i) => {
            const from = Number(it.from != null ? it.from : (it.begin != null ? it.begin : 0));
            const to = Number(it.to != null ? it.to : (it.end != null ? it.end : from));
            const c = String(it.content != null ? it.content : (it.text || "")).trim();
            if (!c) return "";
            return (i + 1) + "\n" + fmtTime(from) + " --> " + fmtTime(to) + "\n" + c;
        }).filter(Boolean).join("\n\n");
    }

    function normalizeSrt(text) {
        let t = String(text || "").replace(/^\uFEFF/, "").trim();
        if (!t) return "";
        const head = t[0];
        if (head === "[" || head === "{") {
            try {
                const json = JSON.parse(t);
                const arr = Array.isArray(json) ? json : (json.list || json.subtitles || json.data);
                if (Array.isArray(arr)) return srtFromJson(arr);
            } catch (e) {}
        }
        return t;
    }

    async function fetchSubtitle(url) {
        let lastErr = "";
        for (const cred of ["include", "omit"]) {
            try {
                const ctl = new AbortController();
                const timer = setTimeout(() => ctl.abort(), 20000);
                let r;
                try {
                    r = await fetch(url, { credentials: cred, signal: ctl.signal });
                } finally {
                    clearTimeout(timer);
                }
                if (!r.ok) { lastErr = "HTTP " + r.status; continue; }
                const srt = normalizeSrt(await r.text());
                if (!srt) { lastErr = "内容为空"; continue; }
                if (!/-->/.test(srt)) { lastErr = "返回内容不是字幕"; continue; }
                return { srt: srt };
            } catch (e) {
                lastErr = (e && e.message) || String(e);
            }
        }
        return { srt: "", err: lastErr || "未知错误" };
    }

    function srtToPlain(srt) {
        const blocks = String(srt || "").replace(/\r\n/g, "\n").split(/\n\s*\n/);
        const out = [];
        for (const b of blocks) {
            const lines = b.split("\n");
            if (!lines.length) continue;
            let i = 0;
            if (/^\s*\d+\s*$/.test(lines[0])) i = 1;
            if (/-->/.test(lines[i] || "")) i++;
            const txt = lines.slice(i).join("\n").trim();
            if (txt) out.push(txt);
        }
        return out.join("\n");
    }

    function countCues(srt) {
        const m = String(srt || "").match(/-->/g);
        return m ? m.length : 0;
    }

    function safeName(name) {
        let n = String(name || "subtitle").replace(ILLEGAL, "_").trim();
        if (n.length > MAX_NAME) n = n.slice(0, MAX_NAME);
        return n || "subtitle";
    }

    // ==========================================
    // 5. 状态
    // ==========================================

    const state = {
        mode: "mine",
        dir: "/",
        dirs: [],          // 我的网盘：路径数组
        groupDirs: [],     // 群：节点对象数组
        videos: [],
        comboIndex: 0,
        groupCombo: "",
        lastErrno: null,
        running: false,
        stop: false
    };

    // ==========================================
    // 6. 面板 UI
    // ==========================================

    const oldPanel = $("__BD_SUB_PANEL__");
    if (oldPanel) oldPanel.remove();

    const panel = document.createElement("div");
    panel.id = "__BD_SUB_PANEL__";
    panel.style.cssText = `
        position:fixed; right:16px; bottom:16px; width:720px;
        max-height:92vh; display:flex; flex-direction:column;
        background:#fff; border-radius:14px;
        box-shadow:0 8px 40px rgba(0,0,0,.25);
        z-index:999999999;
        font:13px/1.6 Arial,'Microsoft YaHei',sans-serif;
        color:#222; overflow:hidden;
    `;
    panel.innerHTML = `
        <div style="padding:10px 16px; background:#1677ff; color:#fff;
                    display:flex; justify-content:space-between; align-items:center;">
            <b style="font-size:15px;">百度网盘 · 字幕批量导出</b>
            <span>
                <button id="bs-min" style="margin-right:6px; padding:0 8px; cursor:pointer;
                    border:none; background:rgba(255,255,255,.25); color:#fff; border-radius:6px;">—</button>
                <button id="bs-close" style="padding:0 8px; cursor:pointer;
                    border:none; background:rgba(255,255,255,.25); color:#fff; border-radius:6px;">×</button>
            </span>
        </div>

        <div id="bs-body" style="padding:12px 16px; overflow:auto; flex:1;">

            <div style="display:flex; gap:14px; align-items:center; margin-bottom:8px; flex-wrap:wrap;">
                <span style="flex:0 0 auto;">来源</span>
                <label><input type="radio" name="bsmode" value="mine" checked> 我的网盘</label>
                <label><input type="radio" name="bsmode" value="group"> 群组共享文件库</label>
                <span style="flex:1"></span>
                <label style="white-space:nowrap;">
                    <input type="checkbox" id="bs-recursive" checked> 含子目录
                </label>
                <label style="white-space:nowrap;" id="bs-followwrap">
                    <input type="checkbox" id="bs-follow" checked> 跟随当前页面
                </label>
            </div>

            <div style="margin-bottom:8px;">
                <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px; flex-wrap:wrap;">
                    <span style="flex:0 0 auto;">目录</span>
                    <button id="bs-pick" style="padding:4px 14px; cursor:pointer;
                        border:none; background:#1677ff; color:#fff; border-radius:6px;">浏览选择…</button>
                    <button id="bs-curdir" style="padding:4px 10px; cursor:pointer;
                        border:1px solid #1677ff; color:#1677ff; background:#fff; border-radius:6px;">用当前页面目录</button>
                    <button id="bs-cleardir" style="padding:4px 10px; cursor:pointer;
                        border:1px solid #999; color:#555; background:#fff; border-radius:6px;">清空</button>
                </div>
                <div id="bs-dirlist" style="min-height:30px; padding:4px 6px; border:1px solid #eee;
                    border-radius:6px; background:#fafafa; font-size:12px; color:#555;"></div>
                <input id="bs-dir" style="display:none;">
            </div>

            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap;">
                <span>轨道</span>
                <select id="bs-track" style="padding:4px 6px; border:1px solid #ddd; border-radius:6px;">
                    <option value="zh" selected>中文优先</option>
                    <option value="first">第一条</option>
                    <option value="all">全部轨道</option>
                </select>
                <span>格式</span>
                <select id="bs-format" style="padding:4px 6px; border:1px solid #ddd; border-radius:6px;">
                    <option value="plain" selected>纯文本 TXT</option>
                    <option value="srt">SRT（带时间轴）</option>
                    <option value="both">两种都要</option>
                </select>
                <span>拆分</span>
                <select id="bs-grain" style="padding:4px 6px; border:1px solid #ddd; border-radius:6px;">
                    <option value="folder" selected>每个文件夹一个文件（按目录分层）</option>
                    <option value="video">每个视频一个文件</option>
                    <option value="all">全部合并成一个文件</option>
                </select>
            </div>

            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap;">
                <span>并发</span>
                <input id="bs-conc" value="3" size="3" style="padding:2px 4px; border:1px solid #ddd; border-radius:6px;">
                <span>间隔</span>
                <input id="bs-delay" value="300" size="5" style="padding:2px 4px; border:1px solid #ddd; border-radius:6px;"> ms
                <label style="white-space:nowrap;">
                    <input type="checkbox" id="bs-onlyfail"> 只处理失败的
                </label>
                <span style="flex:1"></span>
                <span style="font-size:12px; color:#888;">bdstoken</span>
                <input id="bs-token" placeholder="自动获取，留空即可" size="14"
                    style="padding:2px 4px; border:1px solid #ddd; border-radius:6px;">
            </div>

            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap;">
                <button id="bs-scan" style="padding:4px 14px; cursor:pointer;
                    border:none; background:#1677ff; color:#fff; border-radius:6px;">扫描视频</button>
                <button id="bs-selall" style="padding:4px 10px; cursor:pointer;
                    border:1px solid #999; color:#555; background:#fff; border-radius:6px;">全选/不选</button>
                <button id="bs-probe" style="padding:4px 12px; cursor:pointer;
                    border:1px solid #1677ff; color:#1677ff; background:#fff; border-radius:6px;">接口诊断</button>
                <button id="bs-sniff" style="padding:4px 12px; cursor:pointer;
                    border:1px solid #d97706; color:#d97706; background:#fff; border-radius:6px;">查看嗅探</button>
                <button id="bs-diag" style="padding:4px 12px; cursor:pointer;
                    border:1px solid #16a34a; color:#16a34a; background:#fff; border-radius:6px;">导出诊断</button>
                <button id="bs-run" disabled style="padding:4px 14px; cursor:pointer;
                    border:none; background:#16a34a; color:#fff; border-radius:6px;">开始导出</button>
                <button id="bs-stop" disabled style="padding:4px 10px; cursor:pointer;
                    border:1px solid #dc2626; color:#dc2626; background:#fff; border-radius:6px;">停止</button>
                <button id="bs-retry" disabled style="padding:4px 10px; cursor:pointer;
                    border:1px solid #d97706; color:#d97706; background:#fff; border-radius:6px;">重试失败</button>
                <span id="bs-summary" style="font-size:12px; color:#555;"></span>
            </div>

            <div style="height:8px; background:#eee; border-radius:8px; overflow:hidden; margin-bottom:8px;">
                <div id="bs-bar" style="width:0%; height:100%; background:#16a34a; transition:width .2s;"></div>
            </div>

            <div id="bs-tablewrap" style="max-height:32vh; overflow:auto;
                border:1px solid #eee; border-radius:8px;"></div>

            <div style="display:flex; gap:8px; align-items:center; margin:10px 0 8px; flex-wrap:wrap;">
                <button id="bs-zip" style="padding:4px 14px; cursor:pointer;
                    border:none; background:#1677ff; color:#fff; border-radius:6px;">打包下载 ZIP</button>
                <button id="bs-txt" style="padding:4px 12px; cursor:pointer;
                    border:1px solid #1677ff; color:#1677ff; background:#fff; border-radius:6px;">下载合并文稿</button>
                <button id="bs-each" style="padding:4px 12px; cursor:pointer;
                    border:1px solid #999; color:#555; background:#fff; border-radius:6px;">逐个下载</button>
                <span id="bs-progress" style="font-size:12px; color:#555;"></span>
            </div>

            <div id="bs-log" style="max-height:120px; overflow:auto; font-size:12px; color:#666;
                background:#fafafa; border:1px solid #eee; border-radius:8px;
                padding:6px 8px; white-space:pre-wrap;"></div>
        </div>
    `;
    document.body.appendChild(panel);

    const dirInput = $("bs-dir");
    const recursiveChk = $("bs-recursive");
    const followChk = $("bs-follow");
    const trackSel = $("bs-track");
    const formatSel = $("bs-format");
    const grainSel = $("bs-grain");
    const concInput = $("bs-conc");
    const delayInput = $("bs-delay");
    const onlyFailChk = $("bs-onlyfail");
    const scanBtn = $("bs-scan");
    const probeBtn = $("bs-probe");
    const sniffBtn = $("bs-sniff");
    const diagBtn = $("bs-diag");
    const runBtn = $("bs-run");
    const stopBtn = $("bs-stop");
    const retryBtn = $("bs-retry");
    const zipBtn = $("bs-zip");
    const txtBtn = $("bs-txt");
    const eachBtn = $("bs-each");
    const barEl = $("bs-bar");
    const progressEl = $("bs-progress");
    const summaryEl = $("bs-summary");
    const tableWrap = $("bs-tablewrap");
    const logEl = $("bs-log");

    function log(msg) {
        const t = new Date().toLocaleTimeString();
        logEl.textContent += "[" + t + "] " + msg + "\n";
        if (logEl.textContent.length > 20000) logEl.textContent = logEl.textContent.slice(-12000);
        logEl.scrollTop = logEl.scrollHeight;
        console.log("%c[字幕导出] " + msg, "color:#16a34a");
    }

    function updateProgress(done, total) {
        const pct = total ? Math.round((done / total) * 100) : 0;
        barEl.style.width = pct + "%";
        progressEl.textContent = done + "/" + total + "（" + pct + "%）";
    }

    const STATUS_COLOR = { pending: "#999", running: "#1677ff", ok: "#16a34a", nosub: "#d97706", fail: "#dc2626" };
    const STATUS_TEXT = { pending: "待处理", running: "获取中…", ok: "已获取", nosub: "无字幕", fail: "失败" };

    function renderTable() {
        const vs = state.videos;
        if (!vs.length) {
            tableWrap.innerHTML =
                '<div style="padding:18px; text-align:center; color:#999;">选好目录后点“扫描视频”</div>';
            return;
        }
        let html = `
            <table style="width:100%; border-collapse:collapse; font-size:12px;">
                <thead>
                    <tr style="background:#f5f6f7;">
                        <th style="width:30px; padding:6px; border-bottom:1px solid #eee;">
                            <input type="checkbox" id="bs-all"></th>
                        <th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">文件名</th>
                        <th style="text-align:left; padding:6px; border-bottom:1px solid #eee; width:150px;">所在目录</th>
                        <th style="text-align:left; padding:6px; border-bottom:1px solid #eee; width:100px;">轨道</th>
                        <th style="text-align:left; padding:6px; border-bottom:1px solid #eee; width:45px;">条数</th>
                        <th style="text-align:left; padding:6px; border-bottom:1px solid #eee; width:170px;">状态</th>
                    </tr>
                </thead>
                <tbody>`;
        for (let i = 0; i < vs.length; i++) {
            const v = vs[i];
            html += `
                <tr style="border-bottom:1px solid #f2f2f2;">
                    <td style="text-align:center; padding:4px 6px;">
                        <input type="checkbox" class="bs-chk" data-i="${i}"${v.checked === false ? "" : " checked"}></td>
                    <td style="padding:4px 6px; word-break:break-all;">${esc(v.name)}</td>
                    <td style="padding:4px 6px; color:#888; word-break:break-all;">${esc(folderLabel(v))}</td>
                    <td id="bs-tk-${i}" style="padding:4px 6px; color:#555;">${esc(v.trackLabel || "")}</td>
                    <td id="bs-ct-${i}" style="padding:4px 6px; color:#555;">${v.cues || ""}</td>
                    <td id="bs-st-${i}" style="padding:4px 6px; color:${STATUS_COLOR[v.status] || "#222"};"
                        >${esc(STATUS_TEXT[v.status] || "")}${v.err ? "（" + esc(v.err) + "）" : ""}</td>
                </tr>`;
        }
        html += "</tbody></table>";
        tableWrap.innerHTML = html;

        const all = $("bs-all");
        if (all) {
            const checked = vs.filter((v) => v.checked !== false).length;
            all.checked = checked > 0 && checked === vs.length;
            all.addEventListener("change", () => {
                const on = all.checked;
                state.videos.forEach((v) => { v.checked = on; });
                renderTable();
                updateSummary();
                updateButtons();
            });
        }
        tableWrap.querySelectorAll(".bs-chk").forEach((el) => {
            el.addEventListener("change", () => {
                state.videos[Number(el.dataset.i)].checked = el.checked;
                updateSummary();
                updateButtons();
            });
        });
    }

    function folderLabel(v) {
        if (v.src === "group") return v.folder || v.rootName || "";
        const rel = relPath(v);
        const i = rel.lastIndexOf("/");
        return i > 0 ? rel.slice(0, i) : "";
    }

    function updateRow(i) {
        const v = state.videos[i];
        const st = $("bs-st-" + i);
        if (st) {
            st.style.color = STATUS_COLOR[v.status] || "#222";
            st.textContent = (STATUS_TEXT[v.status] || "") + (v.err ? "（" + v.err + "）" : "");
        }
        const tk = $("bs-tk-" + i);
        if (tk) tk.textContent = v.trackLabel || "";
        const ct = $("bs-ct-" + i);
        if (ct) ct.textContent = v.cues || "";
    }

    function okChecked() {
        return state.videos.filter((v) => v.status === "ok" && v.checked !== false);
    }

    function updateSummary() {
        const vs = state.videos;
        const sel = vs.filter((v) => v.checked !== false).length;
        const ok = vs.filter((v) => v.status === "ok").length;
        const nosub = vs.filter((v) => v.status === "nosub").length;
        const fail = vs.filter((v) => v.status === "fail").length;
        summaryEl.innerHTML =
            `共 <b>${vs.length}</b> 个｜已勾选 <b>${sel}</b>｜` +
            `<span style="color:#16a34a">成功 ${ok}</span>｜` +
            `<span style="color:#d97706">无字幕 ${nosub}</span>｜` +
            `<span style="color:#dc2626">失败 ${fail}</span>`;
    }

    function updateButtons() {
        const has = state.videos.length > 0;
        const hasOk = okChecked().length > 0;
        runBtn.disabled = state.running || !has;
        stopBtn.disabled = !state.running;
        retryBtn.disabled = state.running || !state.videos.some((v) => v.status === "fail");
        zipBtn.disabled = state.running || !hasOk;
        txtBtn.disabled = zipBtn.disabled;
        eachBtn.disabled = zipBtn.disabled;
    }

    // ==========================================
    // 6.5 可视化目录选择器（我的网盘 / 群组）
    // ==========================================

    const treeCache = new Map();
    const treeOpen = new Set();
    let pickerSel = new Set();
    let pickerRoot = "/";
    let treeFilter = "";

    // 群模式
    let gGroups = [];
    let gCurGid = "";
    let gRootItems = [];
    const gTreeCache = new Map();
    const gTreeOpen = new Set();
    let gSel = new Set();   // key = gid|msg_id|uk|fs_id

    function parentPath(p) {
        const s = String(p || "/").replace(/\/+$/, "");
        if (!s) return "/";
        const i = s.lastIndexOf("/");
        return i <= 0 ? "/" : s.slice(0, i);
    }

    async function loadChildren(path) {
        if (treeCache.has(path)) return treeCache.get(path);
        treeCache.set(path, { loading: true, children: [] });
        let kids = [];
        try {
            const items = await listDirectory(path);
            kids = items.filter(isDirItem)
                .map((f) => ({ name: f.server_filename, path: f.path }))
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch (e) { kids = []; }
        const rec = { loading: false, children: kids };
        treeCache.set(path, rec);
        return rec;
    }

    function collectRows(path, depth, out) {
        const rec = treeCache.get(path);
        if (!rec || rec.loading) return;
        const kw = treeFilter.trim().toLowerCase();
        for (const kid of rec.children) {
            const match = !kw || kid.name.toLowerCase().indexOf(kw) >= 0;
            if (match) {
                out.push({ node: kid, depth: depth, open: treeOpen.has(kid.path), sel: pickerSel.has(kid.path) });
            }
            if (treeOpen.has(kid.path)) collectRows(kid.path, depth + 1, out);
        }
    }

    const gKey = (n) => [n.gid, n.msg_id, n.uk, n.fs_id].join("|");

    async function gLoadChildren(node) {
        const key = gKey(node);
        if (gTreeCache.has(key)) return gTreeCache.get(key);
        gTreeCache.set(key, { loading: true, children: [] });
        let kids = [];
        try {
            const records = await shareInfoAll(node);
            kids = records.filter(isDirItem).map((f) =>
                gNode(node, f.server_filename, f.fs_id, (node.rel ? node.rel + "/" : "") + f.server_filename)
            ).sort((a, b) => a.name.localeCompare(b.name));
        } catch (e) { kids = []; }
        const rec = { loading: false, children: kids };
        gTreeCache.set(key, rec);
        return rec;
    }

    function gCollect(node, depth, out) {
        const key = gKey(node);
        const rec = gTreeCache.get(key);
        if (!rec || rec.loading) return;
        const kw = treeFilter.trim().toLowerCase();
        for (const kid of rec.children) {
            const k = gKey(kid);
            const match = !kw || kid.name.toLowerCase().indexOf(kw) >= 0;
            if (match) {
                out.push({ node: kid, key: k, depth: depth, open: gTreeOpen.has(k), sel: gSel.has(k) });
            }
            if (gTreeOpen.has(k)) gCollect(kid, depth + 1, out);
        }
    }

    function rowHtml(pad, open, sel, key, name, isDir) {
        const icon = isDir === false ? "🎬" : "📁";
        const arrow = isDir === false ? "·" : (open ? "▾" : "▸");
        return '<div style="display:flex; align-items:center; gap:6px; padding:3px 4px; ' +
            'padding-left:' + pad + 'px; border-radius:4px;">' +
            '<span class="bs-toggle" data-k="' + esc(key) + '" title="展开/收起" ' +
            'style="cursor:pointer; width:14px; color:#888; user-select:none;">' + arrow + '</span>' +
            '<input type="checkbox" class="bs-treeck" data-k="' + esc(key) + '"' + (sel ? " checked" : "") + '>' +
            '<span class="bs-treename" data-k="' + esc(key) + '" style="cursor:pointer; word-break:break-all;">' +
            icon + " " + esc(name) + '</span></div>';
    }

    function renderTree() {
        const wrap = $("bs-tree");
        if (!wrap) return;
        const rows = [];
        let html = "";

        if (getMode() === "group") {
            if (!gCurGid) {
                wrap.innerHTML = '<div style="padding:16px; text-align:center; color:#999;">请先在下方选择一个群组</div>';
                return;
            }
            for (const item of gRootItems) {
                rows.push({ node: item, key: gKey(item), depth: 0 });
            }
            for (const r of rows.slice()) {
                const k = r.key;
                if (gTreeOpen.has(k)) {
                    const sub = [];
                    gCollect(r.node, 1, sub);
                    for (const s of sub) {
                        rows.push({ node: s.node, key: s.key, depth: s.depth, open: s.open, sel: s.sel });
                    }
                }
            }
            if (!rows.length) {
                wrap.innerHTML = '<div style="padding:16px; text-align:center; color:#999;">该群文件库没有取到内容</div>';
                return;
            }
            for (const r of rows) {
                const sel = r.sel != null ? r.sel : gSel.has(r.key);
                const open = r.open != null ? r.open : gTreeOpen.has(r.key);
                html += rowHtml(6 + r.depth * 16, open, sel, r.key, r.node.name, r.node.isdir);
            }
        } else {
            const rec = treeCache.get(pickerRoot);
            if (!rec || rec.loading) {
                wrap.innerHTML = '<div style="padding:16px; text-align:center; color:#999;">加载中…</div>';
                return;
            }
            collectRows(pickerRoot, 0, rows);
            if (!rows.length) {
                wrap.innerHTML = '<div style="padding:16px; text-align:center; color:#999;">' +
                    (treeFilter ? "没有匹配的文件夹" : "该目录下没有子文件夹") + '</div>';
                return;
            }
            for (const r of rows) {
                html += rowHtml(6 + r.depth * 16, r.open, r.sel, r.node.path, r.node.name, true);
            }
        }

        wrap.innerHTML = html;

        wrap.querySelectorAll(".bs-toggle").forEach((el) => {
            el.addEventListener("click", async () => {
                const k = el.dataset.k;
                if (getMode() === "group") {
                    const nd = gFindNode(k);
                    if (nd && nd.isdir === false) {
                        log("这是视频文件，直接勾选即可，不需要展开");
                        return;
                    }
                    if (gTreeOpen.has(k)) { gTreeOpen.delete(k); renderTree(); return; }
                    const node = nd;
                    if (node) await gLoadChildren(node);
                    gTreeOpen.add(k);
                } else {
                    if (treeOpen.has(k)) { treeOpen.delete(k); renderTree(); return; }
                    await loadChildren(k);
                    treeOpen.add(k);
                }
                renderTree();
            });
        });
        wrap.querySelectorAll(".bs-treename").forEach((el) => {
            el.addEventListener("click", async () => {
                const k = el.dataset.k;
                if (getMode() === "group") {
                    const nd = gFindNode(k);
                    if (nd && nd.isdir === false) { renderTree(); return; }
                    if (gTreeOpen.has(k)) gTreeOpen.delete(k);
                    else {
                        const node = nd;
                        if (node) await gLoadChildren(node);
                        gTreeOpen.add(k);
                    }
                } else {
                    if (treeOpen.has(k)) treeOpen.delete(k);
                    else { await loadChildren(k); treeOpen.add(k); }
                }
                renderTree();
            });
        });
        wrap.querySelectorAll(".bs-treeck").forEach((el) => {
            el.addEventListener("change", () => {
                const k = el.dataset.k;
                if (getMode() === "group") {
                    if (el.checked) gSel.add(k); else gSel.delete(k);
                } else {
                    if (el.checked) pickerSel.add(k); else pickerSel.delete(k);
                }
                updatePickerCount();
            });
        });
    }

    function gFindNode(key) {
        for (const it of gRootItems) {
            if (gKey(it) === key) return it;
        }
        for (const rec of gTreeCache.values()) {
            for (const c of (rec.children || [])) {
                if (gKey(c) === key) return c;
            }
        }
        return null;
    }

    function updatePickerCount() {
        const el = $("bs-pickcount");
        if (!el) return;
        const n = getMode() === "group" ? gSel.size : pickerSel.size;
        el.textContent = "已选 " + n + " 个目录";
    }

    async function setPickerRoot(path) {
        pickerRoot = path || "/";
        const inp = $("bs-pickroot");
        if (inp) inp.value = pickerRoot;
        await loadChildren(pickerRoot);
        renderTree();
    }

    function renderGroupBar() {
        const bar = $("bs-gbar");
        if (!bar) return;
        if (getMode() !== "group") { bar.style.display = "none"; return; }
        bar.style.display = "block";
        if (!gGroups.length) {
            bar.innerHTML = '<span style="color:#999;">群组加载中…（失败请点“刷新群组”）</span>';
            return;
        }
        bar.innerHTML = gGroups.map((g) =>
            '<button class="bs-gbtn" data-g="' + esc(g.gid) + '" style="margin:0 6px 4px 0; padding:3px 10px;' +
            ' font-size:12px; cursor:pointer; border-radius:12px; border:1px solid ' +
            (g.gid === gCurGid ? "#1677ff; background:#1677ff; color:#fff" : "#ddd; background:#fff; color:#333") +
            ';">' + esc(g.name) + '</button>'
        ).join("");
        bar.querySelectorAll(".bs-gbtn").forEach((b) => {
            b.addEventListener("click", () => loadGroupRoot(b.dataset.g));
        });
    }

    async function loadGroupRoot(gid) {
        gCurGid = String(gid);
        renderGroupBar();
        const wrap = $("bs-tree");
        if (wrap) wrap.innerHTML = '<div style="padding:16px; text-align:center; color:#999;">正在读取该群文件库…</div>';
        try {
            const items = await fetchGroupRoots(gid);
            gRootItems = items;
            gTreeCache.clear();
            gTreeOpen.clear();
            const dirs = items.filter((x) => x.isdir).length;
            const vids = items.filter((x) => !x.isdir && isVideo(x.name, x.category)).length;
            log("群文件库：顶层 " + items.length + " 项（文件夹 " + dirs + "、可扫描视频 " + vids + "）");
            if (!items.length) {
                log("仍未取到内容：请在网页里点开该群「文件库」，再点一次「刷新群组」→ 点该群按钮");
                log("也可点「导出诊断」把抓到的请求发我");
            }
        } catch (e) {
            log("读取群文件库失败：" + (e.message || e));
            gRootItems = [];
        }
        renderTree();
    }

    async function refreshGroups() {
        try {
            const j = await groupList();
            gGroups = parseGroups(j);
            if (!gGroups.length) {
                log("群组列表为空/解析失败，原始响应：" + JSON.stringify(j).slice(0, 300));
            } else {
                log("加载群组 " + gGroups.length + " 个：" + gGroups.map((g) => g.name).join("、"));
            }
        } catch (e) {
            log("加载群组列表失败：" + (e.message || e));
            gGroups = [];
        }
        renderGroupBar();
    }

    function openDirPicker() {
        const oldOv = $("__BS_PICKER__");
        if (oldOv) oldOv.remove();

        if (getMode() === "group") gSel = new Set(state.groupDirs.map(gKey));
        else pickerSel = new Set(state.dirs);

        const overlay = document.createElement("div");
        overlay.id = "__BS_PICKER__";
        overlay.style.cssText =
            "position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:9999999999;" +
            "display:flex; justify-content:center; align-items:center;";
        overlay.innerHTML =
            '<div style="background:#fff; border-radius:12px; width:780px; max-width:94vw;' +
            ' max-height:86vh; display:flex; flex-direction:column; overflow:hidden;' +
            ' font:13px/1.6 Arial,\'Microsoft YaHei\',sans-serif; color:#222;">' +

            '<div style="padding:10px 16px; background:#1677ff; color:#fff; display:flex;' +
            ' justify-content:space-between; align-items:center;">' +
            '<b style="font-size:15px;">选择要导出字幕的目录（可多选）</b>' +
            '<span id="bs-pickclose" style="cursor:pointer; font-size:18px;">×</span>' +
            '</div>' +

            '<div id="bs-gbar" style="padding:8px 14px; border-bottom:1px solid #eee; display:none;' +
            ' align-items:center; flex-wrap:wrap;">' +
            '<span style="margin-right:6px;">群组</span>' +
            '<button id="bs-grefresh" style="padding:3px 10px; cursor:pointer; border:1px solid #1677ff;' +
            ' color:#1677ff; background:#fff; border-radius:6px;">刷新群组</button>' +
            '</div>' +

            '<div id="bs-mbar" style="padding:10px 14px; border-bottom:1px solid #eee;">' +
            '<div style="display:flex; gap:6px; align-items:center; margin-bottom:8px;">' +
            '<span>根路径</span>' +
            '<input id="bs-pickroot" style="flex:1; min-width:0; padding:4px 8px;' +
            ' border:1px solid #ddd; border-radius:6px;">' +
            '<button id="bs-pickgo" style="padding:4px 12px; cursor:pointer; border:none;' +
            ' background:#1677ff; color:#fff; border-radius:6px;">打开</button>' +
            '<button id="bs-pickup" style="padding:4px 10px; cursor:pointer; border:1px solid #999;' +
            ' color:#555; background:#fff; border-radius:6px;">上级</button>' +
            '<button id="bs-pickcur" style="padding:4px 10px; cursor:pointer; border:1px solid #1677ff;' +
            ' color:#1677ff; background:#fff; border-radius:6px;">回到当前页面目录</button>' +
            '</div>' +
            '<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">' +
            '<input id="bs-pickfilter" placeholder="按名称过滤已展开的文件夹"' +
            ' style="flex:1; min-width:160px; padding:4px 8px; border:1px solid #ddd; border-radius:6px;">' +
            '<button id="bs-pickall" style="padding:4px 10px; cursor:pointer; border:1px solid #1677ff;' +
            ' color:#1677ff; background:#fff; border-radius:6px;">选中当前层全部</button>' +
            '<button id="bs-pickself" style="padding:4px 10px; cursor:pointer; border:1px solid #16a34a;' +
            ' color:#16a34a; background:#fff; border-radius:6px;">把当前根加入选择</button>' +
            '<button id="bs-picknone" style="padding:4px 10px; cursor:pointer; border:1px solid #999;' +
            ' color:#555; background:#fff; border-radius:6px;">清空选择</button>' +
            '</div></div>' +

            '<div id="bs-tree" style="flex:1; overflow:auto; padding:8px 10px; background:#fff;"></div>' +

            '<div style="padding:10px 14px; border-top:1px solid #eee; display:flex;' +
            ' align-items:center; gap:10px;">' +
            '<span id="bs-pickcount" style="font-size:12px; color:#555;">已选 0 个目录</span>' +
            '<span style="flex:1"></span>' +
            '<button id="bs-pickcancel" style="padding:5px 14px; cursor:pointer; border:1px solid #999;' +
            ' color:#555; background:#fff; border-radius:6px;">取消</button>' +
            '<button id="bs-pickok" style="padding:5px 16px; cursor:pointer; border:none;' +
            ' background:#16a34a; color:#fff; border-radius:6px;">确定</button>' +
            '</div></div>';
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        $("bs-pickclose").addEventListener("click", close);
        $("bs-pickcancel").addEventListener("click", close);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

        $("bs-pickgo").addEventListener("click", () => setPickerRoot($("bs-pickroot").value.trim() || "/"));
        $("bs-pickup").addEventListener("click", () => setPickerRoot(parentPath(pickerRoot)));
        $("bs-pickcur").addEventListener("click", () => setPickerRoot(getCurrentPath()));
        $("bs-pickfilter").addEventListener("input", () => {
            treeFilter = $("bs-pickfilter").value || "";
            renderTree();
        });
        $("bs-pickall").addEventListener("click", async () => {
            if (getMode() === "group") {
                for (const it of gRootItems) gSel.add(gKey(it));
                for (const rec of gTreeCache.values()) {
                    for (const c of (rec.children || [])) {
                        if (gTreeOpen.has(gKey(c))) gSel.add(gKey(c));
                    }
                }
            } else {
                const rec = await loadChildren(pickerRoot);
                for (const k of rec.children) pickerSel.add(k.path);
            }
            renderTree();
            updatePickerCount();
        });
        $("bs-pickself").addEventListener("click", () => {
            if (getMode() === "group") {
                log("群模式请直接勾选文件库里的顶层文件夹");
            } else {
                pickerSel.add(pickerRoot);
            }
            renderTree();
            updatePickerCount();
        });
        $("bs-picknone").addEventListener("click", () => {
            if (getMode() === "group") gSel.clear(); else pickerSel.clear();
            renderTree();
            updatePickerCount();
        });
        $("bs-pickok").addEventListener("click", () => {
            if (getMode() === "group") {
                state.groupDirs = Array.from(gSel).map(gFindNode).filter(Boolean);
                renderDirChips();
                log("已选择 " + state.groupDirs.length + " 个群目录：" +
                    state.groupDirs.map((d) => d.name).join("、"));
            } else {
                state.dirs = Array.from(pickerSel).sort();
                renderDirChips();
                log("已选择 " + state.dirs.length + " 个目录：" + state.dirs.join("、"));
            }
            close();
            if (state.videos.length) doScan();
        });
        $("bs-grefresh").addEventListener("click", refreshGroups);

        if (getMode() === "group") {
            $("bs-mbar").style.display = "none";
            refreshGroups();
            if (state.groupDirs.length) {
                gCurGid = state.groupDirs[0].gid;
                loadGroupRoot(gCurGid);
            }
            renderTree();
        } else {
            setPickerRoot(state.dirs[0] || getCurrentPath());
        }
        updatePickerCount();
    }

    function renderDirChips() {
        const el = $("bs-dirlist");
        if (!el) return;
        const items = getMode() === "group"
            ? state.groupDirs.map((d) => d.name)
            : state.dirs;
        if (!items.length) {
            el.innerHTML = '<span style="color:#999;">未选择目录 —— 点“浏览选择…”，' +
                (getMode() === "group"
                    ? '或先在网页里打开群「文件库」再点“刷新群组”'
                    : '或直接点“扫描视频”用当前页面目录') + '</span>';
            return;
        }
        el.innerHTML = items.map((d, i) =>
            '<span style="display:inline-block; margin:2px 6px 2px 0; padding:2px 8px;' +
            ' background:#e8f2ff; color:#0958d9; border-radius:10px;">📁 ' + esc(d) +
            '<b class="bs-chipx" data-i="' + i + '" style="margin-left:6px; cursor:pointer;' +
            ' color:#888;">×</b></span>'
        ).join("");
        el.querySelectorAll(".bs-chipx").forEach((b) => {
            b.addEventListener("click", () => {
                if (getMode() === "group") state.groupDirs.splice(Number(b.dataset.i), 1);
                else state.dirs.splice(Number(b.dataset.i), 1);
                renderDirChips();
            });
        });
    }

    // ==========================================
    // 7. 扫描
    // ==========================================

    function relPath(v) {
        if (v.src === "group") return v.rel || v.name;
        const root = String(v.root || state.dir || "").replace(/\/+$/, "");
        const p = String(v.path || "").replace(/\/+$/, "");
        if (root && p.indexOf(root) === 0) return p.slice(root.length).replace(/^\//, "");
        return v.name;
    }

    async function doScan() {
        const mode = getMode();
        try {
            scanBtn.disabled = true;
            summaryEl.textContent = "扫描中…";
            const videos = [];
            const seen = new Set();

            if (mode === "group") {
                const dirs = state.groupDirs.length ? state.groupDirs.slice() : [];
                if (!dirs.length) {
                    log("请先点“浏览选择…”选择群里的文件夹");
                    scanBtn.disabled = false;
                    updateButtons();
                    return;
                }
                for (const d of dirs) {
                    const part = [];
                    if (d.isdir === false) {
                        // 顶层就是散装视频文件，不需要再请求 shareinfo
                        if (isVideo(d.name, d.category)) {
                            part.push({
                                src: "group",
                                name: d.name,
                                fs_id: d.fs_id,
                                msg_id: d.msg_id,
                                uk: d.uk,
                                gid: d.gid,
                                rel: d.name,
                                folder: "",
                                rootName: d.name
                            });
                        }
                    } else {
                        const node = Object.assign({}, d, { rootName: d.name });
                        await scanGroupDir(node, recursiveChk.checked, "", part, (cur, n) => {
                            summaryEl.textContent = "扫描中… " + cur + "（已发现 " + (videos.length + n) + " 个）";
                        });
                    }
                    for (const v of part) {
                        const key = (v.rootName || "") + "/" + v.rel;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        videos.push(v);
                    }
                }
                state.dir = "群组文件库（" + dirs.length + " 个目录）";
            } else {
                const dirs = state.dirs.length
                    ? state.dirs.slice()
                    : [dirInput.value.trim() || getCurrentPath() || "/"];
                for (const d of dirs) {
                    const part = await scanVideos(d, recursiveChk.checked, (cur, n) => {
                        summaryEl.textContent = "扫描中… " + cur + "（已发现 " + (videos.length + n) + " 个）";
                    });
                    for (const v of part) {
                        if (seen.has(v.path)) continue;
                        seen.add(v.path);
                        videos.push(v);
                    }
                }
                state.dirs = dirs;
                state.dir = dirs.length === 1 ? dirs[0] : "（" + dirs.length + " 个目录）";
            }

            state.mode = mode;
            state.videos = videos.map((v) => Object.assign(v, {
                status: "pending",
                checked: true,
                trackLabel: "",
                cues: "",
                err: "",
                srt: "",
                plain: ""
            }));
            renderTable();
            renderDirChips();
            updateSummary();
            updateButtons();
            log("扫描完成，共 " + videos.length + " 个视频");
            if (!videos.length) log("没有找到视频，确认目录是否正确");
        } catch (e) {
            summaryEl.textContent = "扫描失败";
            log("扫描失败：" + (e.message || e));
        } finally {
            scanBtn.disabled = false;
            updateButtons();
        }
    }

    // ==========================================
    // 8. 诊断 / 嗅探
    // ==========================================

    async function doProbe() {
        if (!state.videos.length) { log("请先扫描视频"); return; }
        const v = state.videos[0];
        probeBtn.disabled = true;
        log("诊断视频：" + v.name + "（" + (v.src === "group" ? "群文件" : "我的网盘") + "）");
        const combos = v.src === "group" ? buildGroupCombos(v) : buildCombos(v);
        if (v.src === "group") {
            log("群文件先确认：脚本是否已抓到字幕请求模板 = " + (sniff.template ? "是" : "否"));
            if (!sniff.template) {
                log("建议：在网页里打开这个群视频播放一次（并打开字幕），脚本会自动记下真实请求，再回来诊断");
            }
        }
        for (const c of combos) {
            const url = c.url || ((c.path || "/rest/2.0/xpan/file") + "?" + new URLSearchParams(c.q).toString());
            try {
                const r = await req(url, 15000);
                const text = await r.text();
                const tracks = parseM3U8(text);
                log("  [" + c.label + "] " + (tracks.length ? "✅ 解析到 " + tracks.length + " 条轨道" : "❌ 无字幕轨道"));
                log("      响应：" + text.slice(0, 200).replace(/\s+/g, " "));
                if (tracks.length) log("      轨道：" + tracks[0].label + " → " + tracks[0].url.slice(0, 120));
            } catch (e) {
                log("  [" + c.label + "] 请求异常：" + (e.message || e));
            }
        }
        try {
            const info = v.src === "group" ? await getTracksGroup(v) : await getTracksMine(v);
            const body = info.tracks.length ? await fetchSubtitle(info.tracks[0].url) : { err: "无轨道" };
            if (body.srt) {
                log("字幕抓取成功，前 200 字：" + body.srt.slice(0, 200).replace(/\s+/g, " "));
            } else {
                log("字幕内容抓取失败：" + (body.err || "未知"));
                log("  → 若提示跨域/权限，说明该来源的字幕直链浏览器取不到，需要改用油猴版或先转存到自己网盘");
            }
        } catch (e) {
            log("诊断异常：" + (e.message || e));
        }
        probeBtn.disabled = false;
    }

    function doShowSniff() {
        log("—— 嗅探到的请求（最近 " + sniff.hits.length + " 条）——");
        if (!sniff.hits.length) {
            log("还没有抓到相关请求。请到网盘里点开群「文件库」/点开一个视频播放，再点这个按钮");
            return;
        }
        const recent = sniff.hits.slice(-12);
        for (const h of recent) {
            log("● " + h.url.replace(/^https:\/\/pan\.baidu\.com/, ""));
            log("   " + h.text.slice(0, 120).replace(/\s+/g, " "));
        }
        if (sniff.template) log("已保存字幕/播放请求模板：" + sniff.template);
        try {
            const text = sniff.hits.map((h) => h.url + "\n  " + h.text.slice(0, 300)).join("\n\n");
            navigator.clipboard.writeText(text).then(
                () => log("（全部嗅探结果已复制到剪贴板，可以直接贴给开发者排查）"),
                () => {}
            );
        } catch (e) {}
    }

    function doExportDiag() {
        const L = [];
        L.push("百度网盘字幕导出 · 诊断数据");
        L.push("时间：" + new Date().toLocaleString());
        L.push("页面：" + location.href);
        L.push("模式：" + getMode());
        L.push("");
        L.push("=== 状态 ===");
        L.push("dirs：" + JSON.stringify(state.dirs));
        L.push("groupDirs：" + JSON.stringify(state.groupDirs.map((d) => ({
            name: d.name, fs_id: d.fs_id, msg_id: d.msg_id,
            uk: d.uk, gid: d.gid, isdir: d.isdir
        }))));
        L.push("视频数：" + state.videos.length);
        L.push("顶层群项数：" + gRootItems.length);
        L.push("群组数：" + gGroups.length + " / 当前 gid：" + gCurGid);
        L.push("弹窗已勾选：" + gSel.size);
        L.push("请求模板：" + JSON.stringify(sniff.urls));
        L.push("streaming 模板：" + (sniff.template || "无"));
        L.push("");
        L.push("=== 顶层群项（前 30）===");
        for (const it of gRootItems.slice(0, 30)) {
            L.push((it.isdir ? "[目录] " : "[文件] ") + it.name +
                " | fs_id=" + it.fs_id + " msg_id=" + it.msg_id +
                " uk=" + it.uk + " gid=" + it.gid);
        }
        L.push("");
        L.push("=== 日志 ===");
        L.push(logEl.textContent);
        L.push("");
        L.push("=== 抓到的请求（最近 25 条，URL + 响应）===");
        for (const h of sniff.hits.slice(-25)) {
            L.push("---");
            L.push(new Date(h.t).toLocaleString() + " [" + h.kind + "]");
            L.push(h.url);
            L.push((h.text || "").slice(0, 30000));
        }
        const text = L.join("\n");
        downloadBlob(new Blob(["\uFEFF" + text], { type: "text/plain;charset=utf-8" }),
            "百度网盘-诊断数据.txt");
        log("✅ 诊断数据已下载（约 " + Math.round(text.length / 1024) + " KB），把这个文件发我即可");
    }

    // ==========================================
    // 9. 批量导出
    // ==========================================

    function pickTrack(tracks) {
        if (!tracks.length) return null;
        const mode = trackSel.value;
        if (mode === "first") return tracks[0];
        if (mode === "all") return null;
        const zh = tracks.find((t) => t.lan === "zh");
        return zh || tracks[0];
    }

    async function processOne(v, index) {
        v.status = "running";
        v.err = "";
        v.srt = "";
        v.plain = "";
        v.cues = "";
        updateRow(index);
        try {
            const info = v.src === "group" ? await getTracksGroup(v) : await getTracksMine(v);
            if (!info.tracks.length) {
                v.status = "nosub";
                v.err = state.lastErrno ? "errno=" + state.lastErrno : "";
                updateRow(index);
                return;
            }
            const mode = trackSel.value;
            const targets = mode === "all" ? info.tracks : [pickTrack(info.tracks)];
            let totalCues = 0;
            let got = 0;
            const srts = [];
            const plains = [];
            for (const tk of targets) {
                const body = await fetchSubtitle(tk.url);
                if (!body.srt) { v.err = body.err || "字幕获取失败"; continue; }
                got++;
                totalCues += countCues(body.srt);
                srts.push(body.srt);
                plains.push(srtToPlain(body.srt));
                v.trackLabel = tk.label;
            }
            if (!got) {
                v.status = "fail";
                updateRow(index);
                return;
            }
            v.srt = srts.join("\n\n");
            v.plain = plains.join("\n");
            v.cues = totalCues;
            v.status = "ok";
            updateRow(index);
        } catch (e) {
            v.status = "fail";
            v.err = (e && e.message) || String(e);
            updateRow(index);
        }
    }

    async function runBatch(onlyFail) {
        const list = state.videos
            .map((v, i) => ({ v: v, i: i }))
            .filter((x) => x.v.checked !== false)
            .filter((x) => (onlyFail ? x.v.status === "fail" || x.v.status === "nosub" : x.v.status !== "ok"));
        if (!list.length) {
            log("没有待处理的视频（检查是否勾选，或都已处理完）");
            return;
        }
        state.running = true;
        state.stop = false;
        updateButtons();

        const conc = Math.max(1, Math.min(8, parseInt(concInput.value, 10) || 1));
        const delay = Math.max(0, parseInt(delayInput.value, 10) || 0);
        let done = 0;
        let cursor = 0;

        const worker = async () => {
            while (true) {
                if (state.stop) return;
                const k = cursor++;
                if (k >= list.length) return;
                const item = list[k];
                await processOne(item.v, item.i);
                done++;
                updateProgress(done, list.length);
                updateSummary();
                if (delay) await sleep(delay);
            }
        };

        await Promise.all(Array.from({ length: Math.min(conc, list.length) }, worker));

        state.running = false;
        updateButtons();
        const ok = state.videos.filter((v) => v.status === "ok").length;
        const nosub = state.videos.filter((v) => v.status === "nosub").length;
        const fail = state.videos.filter((v) => v.status === "fail").length;
        log("导出结束：成功 " + ok + "，无字幕 " + nosub + "，失败 " + fail + (state.stop ? "（已手动停止）" : ""));
        if (nosub > 0) {
            log("提示：无字幕多为百度尚未生成智能字幕。" +
                (getMode() === "group"
                    ? "群文件尤其常见——可先把文件夹转存到自己的网盘，再回来用“我的网盘”模式跑"
                    : "先在播放页手动打开一次字幕，确认百度已生成"));
        }
        if (ok > 0) await doExportZip();
    }

    // ==========================================
    // 10. 导出（txt / srt，按目录分层）
    // ==========================================

    function downloadBlob(blob, filename) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    }

    function sectionTitle(v) {
        if (v.src === "group") return stripExt(v.rel || v.name).replace(/\//g, " / ");
        const rel = relPath(v);
        return stripExt(rel).replace(/\//g, " / ");
    }

    function mergedPlain(list) {
        const out = [];
        for (const v of list) {
            out.push("## " + sectionTitle(v));
            out.push("");
            out.push("> 轨道：" + (v.trackLabel || "-") + " ｜ 共 " + (v.cues || 0) + " 条");
            out.push("");
            out.push(v.plain || "");
            out.push("");
            out.push("---");
            out.push("");
        }
        return out.join("\n");
    }

    // 视频所属的「所选根目录」名称（多选目录时用它区分层级）
    function rootLabel(v) {
        if (v.src === "group") return v.rootName || "";
        return String(v.root || "").split("/").filter(Boolean).pop() || "";
    }

    // 生成待打包的文件列表：[{path, text}]
    function buildFiles() {
        const fmt = formatSel.value;
        const grain = grainSel.value;
        const list = okChecked();
        const files = [];
        const wantSrt = fmt === "srt" || fmt === "both";
        const wantTxt = fmt === "plain" || fmt === "both";
        const roots = getMode() === "group" ? state.groupDirs : state.dirs;
        const multi = roots.length > 1;
        // 多选目录时，在最前面补一层「根目录名」，避免不同目录的同名子目录混在一起
        const prefixOf = (v) => (multi && rootLabel(v) ? safeName(rootLabel(v)) + "/" : "");

        if (grain === "all") {
            const name = safeName(
                getMode() === "group" ? "群文件字幕合集" : (state.dir.split("/").filter(Boolean).pop() || "字幕合集")
            );
            if (wantTxt) files.push({ path: name + ".txt", text: mergedPlain(list) });
            if (wantSrt) {
                files.push({
                    path: name + ".srt",
                    text: list.map((v) => "## " + sectionTitle(v) + "\n\n" + (v.srt || "")).join("\n\n")
                });
            }
            return files;
        }

        if (grain === "folder") {
            const groups = new Map();
            for (const v of list) {
                const key = prefixOf(v) +
                    (folderLabel(v) || safeName(state.dir.split("/").filter(Boolean).pop() || "字幕"));
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(v);
            }
            const used = new Set();
            for (const [folder, items] of groups) {
                let base = safeName(String(folder).replace(/\//g, "_"));
                let n = 1;
                while (used.has(base)) base = safeName(String(folder).replace(/\//g, "_")) + "_" + (++n);
                used.add(base);
                if (wantTxt) files.push({ path: "文本稿/" + base + ".txt", text: mergedPlain(items) });
                if (wantSrt) {
                    files.push({
                        path: "srt/" + base + ".srt",
                        text: items.map((v) => "## " + sectionTitle(v) + "\n\n" + (v.srt || "")).join("\n\n")
                    });
                }
            }
            return files;
        }

        for (const v of list) {
            const rel = relPath(v);
            const sub = rel.indexOf("/") > 0 ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
            const pre = prefixOf(v);
            const base = safeName(stripExt(v.name));
            if (wantTxt) files.push({ path: "文本稿/" + pre + sub + base + ".txt", text: v.plain || "" });
            if (wantSrt) files.push({ path: "srt/" + pre + sub + base + ".srt", text: v.srt || "" });
        }
        return files;
    }

    async function loadJSZip() {
        if (window.JSZip) return window.JSZip;
        const urls = [
            "https://cdn.bootcdn.net/ajax/libs/jszip/3.10.1/jszip.min.js",
            "https://cdn.staticfile.org/jszip/3.10.1/jszip.min.js",
            "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
            "https://unpkg.com/jszip@3.10.1/dist/jszip.min.js"
        ];
        for (const url of urls) {
            try {
                await new Promise((resolve, reject) => {
                    const s = document.createElement("script");
                    s.src = url;
                    s.onload = resolve;
                    s.onerror = () => reject(new Error("fail"));
                    document.head.appendChild(s);
                });
                if (window.JSZip) return window.JSZip;
            } catch (e) {}
        }
        return null;
    }

    async function doExportZip() {
        const files = buildFiles();
        if (!files.length) { log("没有可导出的字幕"); return; }
        const zipName = safeName(
            getMode() === "group" ? "群文件字幕" : (state.dir.split("/").filter(Boolean).pop() || "字幕")
        );
        const JSZip = await loadJSZip();
        if (!JSZip) {
            log("JSZip 加载失败，改为逐个下载");
            await doExportEach(files);
            return;
        }
        log("正在打包 " + files.length + " 个文件…");
        const zip = new JSZip();
        const used = new Set();
        for (const f of files) {
            let p = f.path;
            let n = 1;
            while (used.has(p)) {
                p = f.path.replace(/(\.[^.]+)$/, "_" + (++n) + "$1");
            }
            used.add(p);
            zip.file(p, "\uFEFF" + (f.text || ""));
        }
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, zipName + "-字幕.zip");
        log("✅ ZIP 已下载：" + zipName + "-字幕.zip");
    }

    function doExportMerged() {
        const list = okChecked();
        if (!list.length) { log("没有可导出的字幕"); return; }
        const name = safeName(
            getMode() === "group" ? "群文件字幕合集" : (state.dir.split("/").filter(Boolean).pop() || "字幕合集")
        );
        const text = mergedPlain(list);
        downloadBlob(new Blob(["\uFEFF" + text], { type: "text/plain;charset=utf-8" }), name + ".txt");
        log("✅ 合并文稿已下载：" + name + ".txt");
    }

    async function doExportEach(prebuilt) {
        const files = prebuilt || buildFiles();
        if (!files.length) return;
        if (!confirm("将依次下载 " + files.length + " 个文件，浏览器可能询问“是否允许下载多个文件”，请允许。继续？")) return;
        for (const f of files) {
            downloadBlob(new Blob(["\uFEFF" + (f.text || "")], { type: "text/plain;charset=utf-8" }),
                f.path.split("/").pop());
            await sleep(700);
        }
        log("逐个下载完成");
    }

    // ==========================================
    // 11. 事件
    // ==========================================

    scanBtn.addEventListener("click", doScan);
    $("bs-pick").addEventListener("click", openDirPicker);
    $("bs-curdir").addEventListener("click", () => {
        state.dirs = [getCurrentPath() || "/"];
        renderDirChips();
        log("已使用当前页面目录：" + state.dirs[0]);
        doScan();
    });
    $("bs-cleardir").addEventListener("click", () => {
        if (getMode() === "group") state.groupDirs = []; else state.dirs = [];
        renderDirChips();
    });
    $("bs-selall").addEventListener("click", () => {
        if (!state.videos.length) return;
        const on = state.videos.some((v) => v.checked === false);
        state.videos.forEach((v) => { v.checked = on; });
        renderTable();
        updateSummary();
        updateButtons();
    });
    probeBtn.addEventListener("click", doProbe);
    sniffBtn.addEventListener("click", doShowSniff);
    diagBtn.addEventListener("click", doExportDiag);
    runBtn.addEventListener("click", () => runBatch(onlyFailChk.checked));
    retryBtn.addEventListener("click", () => runBatch(true));
    stopBtn.addEventListener("click", () => { state.stop = true; log("正在停止…"); });
    zipBtn.addEventListener("click", doExportZip);
    txtBtn.addEventListener("click", doExportMerged);
    eachBtn.addEventListener("click", () => doExportEach());

    document.querySelectorAll('input[name="bsmode"]').forEach((el) => {
        el.addEventListener("change", () => {
            const m = getMode();
            state.mode = m;
            state.videos = [];
            $("bs-followwrap").style.display = m === "group" ? "none" : "";
            renderTable();
            renderDirChips();
            updateSummary();
            updateButtons();
            log(m === "group"
                ? "切到「群组共享文件库」：点“浏览选择…” → 选群 → 勾选文件夹 → 扫描"
                : "切到「我的网盘」：可用当前页面目录或浏览选择");
        });
    });

    $("bs-close").addEventListener("click", () => {
        clearInterval(followTimer);
        panel.remove();
        window.__BD_SUB__ = null;
    });
    $("bs-min").addEventListener("click", () => {
        const b = $("bs-body");
        b.style.display = b.style.display === "none" ? "block" : "none";
    });
    recursiveChk.addEventListener("change", () => { if (state.videos.length) doScan(); });

    let lastDir = getCurrentPath();
    dirInput.value = lastDir;
    state.dirs = [lastDir || "/"];
    const followTimer = setInterval(() => {
        if (!followChk.checked || getMode() !== "mine") return;
        const p = getCurrentPath();
        if (p && p !== lastDir) {
            lastDir = p;
            dirInput.value = p;
            if (state.dirs.length <= 1) {
                state.dirs = [p];
                renderDirChips();
                if (state.videos.length) doScan();
            }
        }
    }, 800);

    // ==========================================
    // 12. 启动
    // ==========================================

    window.__BD_SUB__ = {
        state: state,
        sniff: sniff,
        scan: doScan,
        probe: doProbe,
        run: runBatch,
        exportZip: doExportZip,
        exportMerged: doExportMerged,
        exportDiag: doExportDiag,
        loadGroupRoot: loadGroupRoot
    };

    renderTable();
    renderDirChips();
    updateSummary();
    updateButtons();
    log("面板已就绪。步骤：选来源 → 浏览选择目录 → 扫描视频 → （可选）接口诊断 → 开始导出");
    log("群文件模式：先在网页里打开群的「文件库」浏览一下，脚本会自动记录页面请求，成功率更高");

}

    // ---------- ② 群文件转存（对比断点） ----------
async function toolTransferCompare() {
  console.clear();

  // =========================================================
  // 配置：统一在文件顶部 TRANSFER_CONFIG 填写，勿在此处改
  // =========================================================
  const CONFIG = {
    source_fs_id: TRANSFER_CONFIG.source_fs_id,
    source_path: TRANSFER_CONFIG.source_path,
    target_root: TRANSFER_CONFIG.target_root,
    from_uk: TRANSFER_CONFIG.from_uk,
    msg_id: TRANSFER_CONFIG.msg_id,
    gid: TRANSFER_CONFIG.gid,
    bdstoken: TRANSFER_CONFIG.bdstoken,
    logId: TRANSFER_CONFIG.logId,
    dp_logid: TRANSFER_CONFIG.dp_logid,
    batch_size: 500,
    retry_count: 3,
    delay: 500
  };


  // =========================================================
  //                 以下全部不用修改
  // =========================================================


  // ---------------------------------------------------------
  // 基础工具
  // ---------------------------------------------------------

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));


  // ---------------------------------------------------------
  // 参数检查
  // ---------------------------------------------------------

  const missing = Object.keys(CONFIG).filter(
    (k) => typeof CONFIG[k] === 'string' && CONFIG[k].indexOf('PASTE_') >= 0
  );
  if (missing.length) {

    console.error(
      '❌ 请先在 CONFIG 中填写：' + missing.join('、')
    );

    return;
  }


  // ---------------------------------------------------------
  // 浮动进度框
  // ---------------------------------------------------------

  document
    .getElementById('__BAIDU_TRANSFER_BOX__')
    ?.remove();

  const box =
    document.createElement('div');

  box.id =
    '__BAIDU_TRANSFER_BOX__';

  box.style.cssText = `
    position:fixed;
    right:20px;
    bottom:20px;
    z-index:999999;
    width:390px;
    background:#fff;
    color:#222;
    padding:16px;
    border-radius:14px;
    box-shadow:0 5px 30px rgba(0,0,0,.25);
    font:13px/1.6 Arial,"Microsoft YaHei",sans-serif;
  `;

  box.innerHTML = `
    <div style="
      font-size:16px;
      font-weight:bold;
    ">
      百度网盘群文件转存
    </div>

    <div id="__BT_STATUS__"
         style="margin-top:8px">
      初始化...
    </div>

    <div style="
      margin-top:10px;
      height:8px;
      background:#eee;
      border-radius:8px;
      overflow:hidden;
    ">
      <div id="__BT_BAR__"
           style="
             width:0%;
             height:100%;
             background:#1677ff;
             transition:.2s;
           ">
      </div>
    </div>

    <div id="__BT_DETAIL__"
         style="
           margin-top:8px;
           max-height:150px;
           overflow:auto;
           color:#666;
         ">
    </div>
  `;

  document.body.appendChild(box);

  const statusEl =
    document.getElementById(
      '__BT_STATUS__'
    );

  const detailEl =
    document.getElementById(
      '__BT_DETAIL__'
    );

  const barEl =
    document.getElementById(
      '__BT_BAR__'
    );


  function progress(
    status,
    percent,
    detail = ''
  ) {

    statusEl.textContent =
      status;

    barEl.style.width =
      Math.max(
        0,
        Math.min(
          100,
          percent
        )
      ) + '%';

    detailEl.textContent =
      detail;
  }


  // ---------------------------------------------------------
  // 获取群文件目录
  // ---------------------------------------------------------

  async function getGroupChildren(
    fs_id,
    page = 1
  ) {

    const url =
      new URL(
        '/mbox/msg/shareinfo',
        location.origin
      );

    url.searchParams.set(
      'from_uk',
      CONFIG.from_uk
    );

    url.searchParams.set(
      'msg_id',
      CONFIG.msg_id
    );

    url.searchParams.set(
      'type',
      '2'
    );

    url.searchParams.set(
      'num',
      '100'
    );

    url.searchParams.set(
      'page',
      String(page)
    );

    url.searchParams.set(
      'fs_id',
      String(fs_id)
    );

    url.searchParams.set(
      'gid',
      CONFIG.gid
    );

    url.searchParams.set(
      'limit',
      '100'
    );

    url.searchParams.set(
      'desc',
      '1'
    );

    url.searchParams.set(
      'clienttype',
      '0'
    );

    url.searchParams.set(
      'app_id',
      '250528'
    );

    url.searchParams.set(
      'web',
      '1'
    );

    const response =
      await fetch(
        url.toString(),
        {
          credentials: 'include'
        }
      );

    const data =
      await response.json();

    if (
      data.errno !== 0
    ) {

      throw new Error(
        `群文件列表失败 errno=${data.errno}`
      );
    }

    return data;
  }


  // ---------------------------------------------------------
  // 递归扫描群文件夹
  // ---------------------------------------------------------

  async function scanGroup(
    fs_id,
    currentPath,
    files = []
  ) {

    let page = 1;

    while (true) {

      const data =
        await getGroupChildren(
          fs_id,
          page
        );

      const list =
        data.list ||
        data.records ||
        data.data ||
        [];

      if (
        !Array.isArray(list) ||
        list.length === 0
      ) {

        break;
      }


      for (
        const item of list
      ) {

        const name =
          item.server_filename ||
          item.name ||
          item.filename ||
          '';

        const childFsId =
          item.fs_id ||
          item.fsId;

        if (
          !name ||
          !childFsId
        ) {

          continue;
        }


        const isDir =
          item.isdir === 1 ||
          item.isdir === '1' ||
          item.isdir === true ||
          item.is_dir === 1;


        const path =
          currentPath +
          '/' +
          name;


        if (isDir) {

          await scanGroup(
            childFsId,
            path,
            files
          );

        } else {

          files.push({

            fs_id:
              childFsId,

            name,

            source_path:
              path,

            target_path:
              CONFIG.target_root +
              path

          });
        }
      }


      if (
        list.length < 100
      ) {

        break;
      }

      page++;

      await sleep(80);
    }

    return files;
  }


  // ---------------------------------------------------------
  // 获取自己网盘某目录
  // ---------------------------------------------------------

  async function getMyChildren(
    dir,
    page = 1
  ) {

    const url =
      new URL(
        '/api/list',
        location.origin
      );

    url.searchParams.set(
      'dir',
      dir
    );

    url.searchParams.set(
      'order',
      'name'
    );

    url.searchParams.set(
      'desc',
      '0'
    );

    url.searchParams.set(
      'showempty',
      '1'
    );

    url.searchParams.set(
      'page',
      String(page)
    );

    url.searchParams.set(
      'num',
      '100'
    );

    url.searchParams.set(
      'channel',
      'chunlei'
    );

    url.searchParams.set(
      'clienttype',
      '0'
    );

    url.searchParams.set(
      'app_id',
      '250528'
    );

    url.searchParams.set(
      'bdstoken',
      CONFIG.bdstoken
    );


    const response =
      await fetch(
        url.toString(),
        {
          credentials: 'include'
        }
      );

    const data =
      await response.json();


    if (
      data.errno !== 0 &&
      data.errno !== undefined
    ) {

      throw new Error(
        `我的网盘列表失败 errno=${data.errno}`
      );
    }

    return data;
  }


  // ---------------------------------------------------------
  // 递归扫描自己网盘
  // ---------------------------------------------------------

  async function scanMyDisk(
    dir,
    files = []
  ) {

    let page = 1;

    while (true) {

      const data =
        await getMyChildren(
          dir,
          page
        );

      const list =
        data.list ||
        [];

      if (
        !Array.isArray(list) ||
        list.length === 0
      ) {

        break;
      }


      for (
        const item of list
      ) {

        const name =
          item.server_filename ||
          item.name ||
          '';

        if (!name) {
          continue;
        }


        const isDir =
          item.isdir === 1 ||
          item.isdir === '1' ||
          item.isdir === true;


        const current =
          dir === '/'
            ? '/' + name
            : dir + '/' + name;


        if (isDir) {

          await scanMyDisk(
            current,
            files
          );

        } else {

          files.push({
            path: current,
            name,
            fs_id: item.fs_id
          });
        }
      }


      if (
        list.length < 100
      ) {

        break;
      }

      page++;

      await sleep(80);
    }

    return files;
  }


  // ---------------------------------------------------------
  // 创建目标目录
  // ---------------------------------------------------------

  async function createDir(
    path
  ) {

    const url =
      '/api/create' +
      '?a=commit' +
      '&bdstoken=' +
      encodeURIComponent(
        CONFIG.bdstoken
      ) +
      '&clienttype=0' +
      '&app_id=250528' +
      '&web=1' +
      '&dp-logid=' +
      encodeURIComponent(
        CONFIG.dp_logid
      );


    const body =
      new URLSearchParams();


    body.set(
      'path',
      path
    );

    body.set(
      'isdir',
      '1'
    );

    body.set(
      'block_list',
      '[]'
    );


    const response =
      await fetch(
        url,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded'
          },
          body
        }
      );


    return await response.json();
  }


  // ---------------------------------------------------------
  // 确保目录存在
  // ---------------------------------------------------------

  const knownDirs =
    new Set([
      CONFIG.target_root
    ]);


  async function ensureDir(
    path
  ) {

    if (
      knownDirs.has(path)
    ) {

      return;
    }


    const parts =
      path
        .split('/')
        .filter(Boolean);


    let current = '';


    for (
      const part of parts
    ) {

      current +=
        '/' + part;


      if (
        knownDirs.has(current)
      ) {

        continue;
      }


      try {

        const data =
          await createDir(
            current
          );

        if (
          data.errno === 0 ||
          data.errno === -8 ||
          data.errno === -9
        ) {

          knownDirs.add(
            current
          );

        } else {

          console.warn(
            '创建目录返回：',
            current,
            data
          );

          knownDirs.add(
            current
          );
        }

      } catch (e) {

        console.warn(
          '创建目录异常：',
          current,
          e
        );

        knownDirs.add(
          current
        );
      }


      await sleep(100);
    }
  }


  // ---------------------------------------------------------
  // 转存
  // ---------------------------------------------------------

  async function transferBatch(
    fs_ids,
    targetDir
  ) {

    const url =
      '/mbox/msg/transfer' +
      '?channel=chunlei' +
      '&clienttype=0' +
      '&web=1' +
      '&app_id=250528' +
      '&logId=' +
      encodeURIComponent(
        CONFIG.logId
      ) +
      '&bdstoken=' +
      encodeURIComponent(
        CONFIG.bdstoken
      ) +
      '&dp-logid=' +
      encodeURIComponent(
        CONFIG.dp_logid
      );


    const body =
      new URLSearchParams();


    body.set(
      'from_uk',
      CONFIG.from_uk
    );

    body.set(
      'msg_id',
      CONFIG.msg_id
    );

    body.set(
      'path',
      targetDir
    );

    body.set(
      'ondup',
      'newcopy'
    );

    body.set(
      'async',
      '4'
    );

    body.set(
      'fs_ids',
      JSON.stringify(fs_ids)
    );

    body.set(
      'type',
      '2'
    );

    body.set(
      'gid',
      CONFIG.gid
    );


    const response =
      await fetch(
        url,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded'
          },
          body
        }
      );


    return await response.json();
  }


  // ---------------------------------------------------------
  // 带重试的转存
  // ---------------------------------------------------------

  async function transferRetry(
    fs_ids,
    targetDir
  ) {

    let lastResult = null;


    for (
      let i = 1;
      i <= CONFIG.retry_count;
      i++
    ) {

      try {

        const result =
          await transferBatch(
            fs_ids,
            targetDir
          );


        console.log(
          `📤 第${i}次转存：`,
          targetDir,
          result
        );


        if (
          result.errno === 0
        ) {

          return result;
        }


        lastResult =
          result;

      } catch (e) {

        console.warn(
          `第${i}次请求异常`,
          e
        );

        lastResult = {
          errno: -999,
          error: String(e)
        };
      }


      await sleep(
        1500 * i
      );
    }


    return lastResult;
  }


  // =========================================================
  //                    开始执行
  // =========================================================

  console.log(
    '========================================'
  );

  console.log(
    '🚀 百度网盘群文件转存'
  );

  console.log(
    '源文件夹 fs_id：',
    CONFIG.source_fs_id
  );

  console.log(
    '源文件夹路径：',
    CONFIG.source_path
  );

  console.log(
    '目标文件夹：',
    CONFIG.target_root
  );

  console.log(
    '========================================'
  );


  // ---------------------------------------------------------
  // 第一步：扫描群文件夹
  // ---------------------------------------------------------

  progress(
    '① 正在扫描群文件夹...',
    5
  );


  let groupFiles;


  try {

    groupFiles =
      await scanGroup(
        CONFIG.source_fs_id,
        CONFIG.source_path
      );

  } catch (e) {

    console.error(
      '❌ 扫描群文件失败',
      e
    );

    progress(
      '❌ 扫描失败',
      0,
      String(e)
    );

    return;
  }


  console.log(
    `📄 群文件夹共找到 ${groupFiles.length} 个文件`
  );


  // ---------------------------------------------------------
  // 第二步：扫描目标文件夹
  // ---------------------------------------------------------

  progress(
    '② 正在扫描你的目标文件夹...',
    20
  );


  let myFiles;


  try {

    myFiles =
      await scanMyDisk(
        CONFIG.target_root
      );

  } catch (e) {

    console.error(
      '❌ 扫描目标文件夹失败',
      e
    );

    progress(
      '❌ 目标目录扫描失败',
      0,
      String(e)
    );

    return;
  }


  console.log(
    `📄 目标目录已有 ${myFiles.length} 个文件`
  );


  // ---------------------------------------------------------
  // 第三步：判断哪些已经存在
  // ---------------------------------------------------------

  const existing =
    new Set(
      myFiles.map(
        x => x.path
      )
    );


  const needTransfer = [];

  const alreadyExists = [];


  for (
    const file of groupFiles
  ) {

    if (
      existing.has(
        file.target_path
      )
    ) {

      alreadyExists.push(
        file
      );

    } else {

      needTransfer.push(
        file
      );
    }
  }


  console.log(
    '========================================'
  );

  console.log(
    `📊 群文件：${groupFiles.length}`
  );

  console.log(
    `✅ 已存在：${alreadyExists.length}`
  );

  console.log(
    `📤 需要转存：${needTransfer.length}`
  );

  console.log(
    '========================================'
  );


  // 保存到 window，方便之后查看

  window.__BAIDU_TRANSFER_COMPARE__ = {
    groupFiles,
    myFiles,
    alreadyExists,
    needTransfer
  };


  // ---------------------------------------------------------
  // 没有需要转存的
  // ---------------------------------------------------------

  if (
    needTransfer.length === 0
  ) {

    progress(
      '🎉 全部已经存在',
      100,
      '没有需要转存的新文件'
    );

    console.log(
      '🎉 不需要转存任何文件'
    );

    return;
  }


  // ---------------------------------------------------------
  // 第四步：按目标目录分组
  // ---------------------------------------------------------

  const groups =
    new Map();


  for (
    const file of needTransfer
  ) {

    const index =
      file.target_path.lastIndexOf('/');


    const targetDir =
      file.target_path.substring(
        0,
        index
      );


    if (
      !groups.has(
        targetDir
      )
    ) {

      groups.set(
        targetDir,
        []
      );
    }


    groups
      .get(targetDir)
      .push(file);
  }


  // ---------------------------------------------------------
  // 第五步：开始转存
  // ---------------------------------------------------------

  const success = [];
  const failed = [];

  let completed = 0;


  window.__BAIDU_TRANSFER_SUCCESS__ =
    success;

  window.__BAIDU_TRANSFER_FAILED__ =
    failed;


  for (
    const [
      targetDir,
      files
    ] of groups
  ) {

    console.log(
      `\n📁 ${targetDir}`
    );

    console.log(
      `📄 ${files.length} 个文件`
    );


    // 确保目标目录存在

    await ensureDir(
      targetDir
    );


    // -------------------------------------------------------
    // 500个一批
    // -------------------------------------------------------

    for (
      let start = 0;
      start < files.length;
      start += CONFIG.batch_size
    ) {

      const batch =
        files.slice(
          start,
          start +
          CONFIG.batch_size
        );


      const fs_ids =
        batch.map(
          x => x.fs_id
        );


      console.log(
        `📦 第 ${
          Math.floor(
            start /
            CONFIG.batch_size
          ) + 1
        } 批：${batch.length} 个`
      );


      const result =
        await transferRetry(
          fs_ids,
          targetDir
        );


      if (
        result &&
        result.errno === 0
      ) {

        success.push({
          targetDir,
          count: batch.length,
          files: batch,
          result
        });


        console.log(
          `✅ 转存成功：${targetDir}`
        );

      } else {

        failed.push({
          targetDir,
          count: batch.length,
          files: batch,
          result
        });


        console.error(
          `❌ 转存失败：${targetDir}`,
          result
        );
      }


      completed +=
        batch.length;


      progress(
        `③ 正在转存 ${completed}/${needTransfer.length}`,
        25 +
        completed /
        needTransfer.length *
        70,
        targetDir
      );


      await sleep(
        CONFIG.delay
      );
    }
  }


  // ---------------------------------------------------------
  // 第六步：完成
  // ---------------------------------------------------------

  console.log(
    '\n========================================'
  );

  console.log(
    '🎉 转存任务结束'
  );

  console.log(
    `📄 总文件：${groupFiles.length}`
  );

  console.log(
    `⏭️ 原本已存在：${alreadyExists.length}`
  );

  console.log(
    `📤 本次尝试转存：${needTransfer.length}`
  );

  console.log(
    `✅ 成功批次：${success.length}`
  );

  console.log(
    `❌ 失败批次：${failed.length}`
  );

  console.log(
    '========================================'
  );


  // ---------------------------------------------------------
  // 保存最终结果
  // ---------------------------------------------------------

  window.__BAIDU_TRANSFER_RESULT__ = {

    groupFiles,

    myFiles,

    alreadyExists,

    needTransfer,

    success,

    failed

  };


  if (
    failed.length === 0
  ) {

    progress(
      '🎊 全部转存完成',
      100,
      `成功处理 ${needTransfer.length} 个文件`
    );

    console.log(
      '🎊 没有失败批次！'
    );

  } else {

    progress(
      `⚠️ 有 ${failed.length} 个批次失败`,
      100,
      '请查看控制台失败记录'
    );


    console.table(
      failed.map(
        x => ({
          目标目录:
            x.targetDir,

          文件数量:
            x.count,

          errno:
            x.result?.errno
        })
      )
    );
  }

}

    // ---------- ③ 群文件转存（递归） ----------
async function toolTransferRecursive() {

    // ============================================================
    // 配置
    // ============================================================

    // 配置：统一在文件顶部 TRANSFER_CONFIG 填写，勿在此处改
    const CONFIG = {
        from_uk: TRANSFER_CONFIG.from_uk,
        msg_id: TRANSFER_CONFIG.msg_id,
        gid: TRANSFER_CONFIG.gid,
        root_fs_id: TRANSFER_CONFIG.root_fs_id,
        target_root: TRANSFER_CONFIG.target_root,
        create_bdstoken: TRANSFER_CONFIG.bdstoken,
        create_dp_logid: TRANSFER_CONFIG.dp_logid,
        transfer_bdstoken: TRANSFER_CONFIG.bdstoken,
        transfer_logId: TRANSFER_CONFIG.logId,
        transfer_dp_logid: TRANSFER_CONFIG.dp_logid,
        batch_size: 500,
        delay: 500,
        max_retry: 3
    };


    // ============================================================
    // 防止重复运行
    // ============================================================

    if (window.__BAIDU_RECURSIVE_TRANSFER_RUNNING__) {

        console.warn(
            '⚠️ 已经有任务正在运行'
        );

        return;
    }

    window.__BAIDU_RECURSIVE_TRANSFER_RUNNING__ = true;

    const missing = Object.keys(CONFIG).filter(
        (k) => typeof CONFIG[k] === 'string' && CONFIG[k].indexOf('PASTE_') >= 0
    );
    if (missing.length) {
        console.error('❌ 请先在 CONFIG 中填写：' + missing.join('、'));
        window.__BAIDU_RECURSIVE_TRANSFER_RUNNING__ = false;
        return;
    }


    // ============================================================
    // 工具
    // ============================================================

    const sleep = ms =>
        new Promise(resolve => setTimeout(resolve, ms));


    // ============================================================
    // 清理旧面板
    // ============================================================

    const old =
        document.getElementById(
            '__baidu_recursive_transfer__'
        );

    if (old) {
        old.remove();
    }


    // ============================================================
    // UI
    // ============================================================

    const panel =
        document.createElement('div');

    panel.id =
        '__baidu_recursive_transfer__';

    panel.innerHTML = `

        <div style="
            position:fixed;
            right:20px;
            bottom:20px;
            width:430px;
            padding:20px;
            background:white;
            border-radius:16px;
            box-shadow:0 8px 40px rgba(0,0,0,.22);
            z-index:999999999;
            font-family:Arial,'Microsoft YaHei',sans-serif;
            color:#222;
        ">

            <div style="
                font-size:18px;
                font-weight:bold;
                margin-bottom:15px;
            ">
                📦 群文件递归转存
            </div>

            <div id="brt-status"
                 style="
                    font-size:14px;
                    margin-bottom:12px;
                    color:#555;
                 ">
                准备开始...
            </div>

            <div style="
                height:12px;
                width:100%;
                background:#eee;
                border-radius:10px;
                overflow:hidden;
            ">

                <div id="brt-bar"
                     style="
                        width:0%;
                        height:100%;
                        background:#1677ff;
                        transition:width .3s;
                     ">
                </div>

            </div>

            <div id="brt-percent"
                 style="
                    text-align:center;
                    font-size:24px;
                    font-weight:bold;
                    margin:12px 0 18px;
                 ">
                0%
            </div>

            <div style="
                display:grid;
                grid-template-columns:1fr 1fr;
                gap:10px;
                font-size:14px;
            ">

                <div>
                    📁 文件夹：
                    <b id="brt-folders">0</b>
                </div>

                <div>
                    📄 文件：
                    <b id="brt-files">0</b>
                </div>

                <div>
                    🏗️ 已创建：
                    <b id="brt-created">0</b>
                </div>

                <div>
                    📤 已转存：
                    <b id="brt-success">0</b>
                </div>

                <div>
                    ❌ 失败：
                    <b id="brt-failed">0</b>
                </div>

                <div>
                    📦 批次：
                    <b id="brt-batch">0</b>
                </div>

            </div>

            <div id="brt-current"
                 style="
                    margin-top:16px;
                    padding-top:12px;
                    border-top:1px solid #eee;
                    font-size:12px;
                    color:#777;
                    line-height:1.6;
                    word-break:break-all;
                 ">
                等待...
            </div>

        </div>
    `;

    document.body.appendChild(panel);


    const $ = id =>
        document.getElementById(id);


    // ============================================================
    // 数据
    // ============================================================

    const folders = [];

    const files = [];

    const visited = new Set();


    // ============================================================
    // 获取群文件目录
    // ============================================================

    async function getGroupFiles(
        fsId,
        page
    ) {

        const params =
            new URLSearchParams({

                from_uk:
                    CONFIG.from_uk,

                msg_id:
                    CONFIG.msg_id,

                type:
                    '2',

                num:
                    '100',

                page:
                    String(page),

                fs_id:
                    String(fsId),

                gid:
                    CONFIG.gid,

                limit:
                    '100',

                desc:
                    '1',

                clienttype:
                    '0',

                app_id:
                    '250528',

                web:
                    '1'
            });


        const response =
            await fetch(
                `/mbox/msg/shareinfo?${params}`,
                {
                    method: 'GET',
                    credentials: 'include'
                }
            );


        if (!response.ok) {

            throw new Error(
                `扫描HTTP ${response.status}`
            );
        }


        const data =
            await response.json();


        if (
            data.errno !== undefined &&
            data.errno !== 0
        ) {

            throw new Error(
                data.errmsg ||
                `errno=${data.errno}`
            );
        }


        return data;
    }


    // ============================================================
    // 递归扫描
    //
    // 同时记录：
    //
    // 文件夹 → 目标路径
    // 文件   → 目标路径
    //
    // ============================================================

    async function scanFolder(
        fsId,
        sourcePath,
        targetPath
    ) {

        fsId =
            String(fsId);


        if (visited.has(fsId)) {
            return;
        }

        visited.add(fsId);


        let page = 1;


        while (true) {

            $('brt-status').textContent =
                '🔍 正在扫描群文件';

            $('brt-folders').textContent =
                folders.length;

            $('brt-files').textContent =
                files.length;

            $('brt-current').textContent =
                `扫描：${sourcePath}`;


            const data =
                await getGroupFiles(
                    fsId,
                    page
                );


            const list =
                data.list ||
                data.records ||
                data.data ||
                [];


            if (
                !Array.isArray(list) ||
                list.length === 0
            ) {

                break;
            }


            for (const item of list) {

                if (
                    !item ||
                    item.fs_id == null
                ) {
                    continue;
                }


                const name =
                    item.server_filename ||
                    item.name ||
                    '未命名';


                const isDir =
                    Number(item.isdir) === 1;


                if (isDir) {

                    const childTargetPath =
                        targetPath === '/'
                            ? `/${name}`
                            : `${targetPath}/${name}`;


                    const childSourcePath =
                        sourcePath === '/'
                            ? `/${name}`
                            : `${sourcePath}/${name}`;


                    folders.push({

                        fs_id:
                            String(item.fs_id),

                        name,

                        source_path:
                            childSourcePath,

                        target_path:
                            childTargetPath,

                        parent_target_path:
                            targetPath
                    });


                    await scanFolder(

                        item.fs_id,

                        childSourcePath,

                        childTargetPath
                    );


                } else {

                    files.push({

                        fs_id:
                            String(item.fs_id),

                        name,

                        source_path:
                            sourcePath === '/'
                                ? `/${name}`
                                : `${sourcePath}/${name}`,

                        target_path:
                            targetPath
                    });
                }
            }


            if (list.length < 100) {
                break;
            }


            page++;

            await sleep(
                CONFIG.delay
            );
        }
    }


    // ============================================================
    // 开始扫描
    // ============================================================

    try {

        console.log(
            '🔍 开始递归扫描...'
        );


        await scanFolder(
            CONFIG.root_fs_id,
            '/',
            CONFIG.target_root
        );


        console.log(
            '================================'
        );

        console.log(
            `📁 文件夹：${folders.length}`
        );

        console.log(
            `📄 文件：${files.length}`
        );

        console.log(
            `🔍 扫描目录：${visited.size}`
        );

        console.log(
            '================================'
        );

    } catch (error) {

        console.error(
            '❌ 扫描失败',
            error
        );

        $('brt-status').textContent =
            '❌ 扫描失败';

        $('brt-current').textContent =
            error.message;

        window.__BAIDU_RECURSIVE_TRANSFER_RUNNING__ =
            false;

        return;
    }


    // ============================================================
    // 保存扫描结果
    // ============================================================

    window.__BAIDU_RECURSIVE_FOLDERS__ =
        folders;

    window.__BAIDU_RECURSIVE_FILES__ =
        files;


    $('brt-folders').textContent =
        folders.length;

    $('brt-files').textContent =
        files.length;


    // ============================================================
    // 创建文件夹
    // ============================================================

    async function createFolder(
        targetPath
    ) {

        for (
            let retry = 1;
            retry <= CONFIG.max_retry;
            retry++
        ) {

            try {

                $('brt-status').textContent =
                    '🏗️ 正在创建文件夹';

                $('brt-current').textContent =
                    targetPath;


                const params =
                    new URLSearchParams({

                        a:
                            'commit',

                        bdstoken:
                            CONFIG.create_bdstoken,

                        clienttype:
                            '0',

                        app_id:
                            '250528',

                        web:
                            '1',

                        'dp-logid':
                            CONFIG.create_dp_logid
                    });


                const body =
                    new URLSearchParams({

                        path:
                            targetPath,

                        isdir:
                            '1',

                        block_list:
                            '[]'
                    });


                const response =
                    await fetch(
                        `/api/create?${params}`,
                        {
                            method: 'POST',

                            credentials:
                                'include',

                            headers: {
                                'Content-Type':
                                    'application/x-www-form-urlencoded; charset=UTF-8'
                            },

                            body
                        }
                    );


                const data =
                    await response.json();


                console.log(
                    '📁 创建文件夹：',
                    targetPath,
                    data
                );


                if (
                    data.errno === 0
                ) {

                    return {
                        success: true,
                        data
                    };
                }


                // 已经存在也视为成功
                //
                // 百度这里不同版本可能返回不同错误码，
                // 因此如果明确提示“目录已存在”，继续。

                const message =
                    JSON.stringify(data);


                if (
                    message.includes('exist') ||
                    message.includes('存在') ||
                    data.errno === -9
                ) {

                    return {
                        success: true,
                        exists: true,
                        data
                    };
                }


                throw new Error(
                    data.errmsg ||
                    `errno=${data.errno}`
                );


            } catch (error) {

                console.warn(
                    `⚠️ 创建失败，第${retry}次：`,
                    targetPath,
                    error
                );


                if (
                    retry <
                    CONFIG.max_retry
                ) {

                    await sleep(
                        retry * 1000
                    );
                }
            }
        }


        return {
            success: false
        };
    }


    // ============================================================
    // 按路径深度排序
    //
    // 必须先创建父目录，再创建子目录
    // ============================================================

    folders.sort(
        (a, b) =>
            a.target_path.split('/').length -
            b.target_path.split('/').length
    );


    // ============================================================
    // 创建全部目录
    // ============================================================

    let createdCount = 0;

    let folderFailed = 0;


    for (
        let i = 0;
        i < folders.length;
        i++
    ) {

        const folder =
            folders[i];


        const result =
            await createFolder(
                folder.target_path
            );


        if (result.success) {

            createdCount++;

        } else {

            folderFailed++;
        }


        $('brt-created').textContent =
            createdCount;


        const percent =
            folders.length === 0
                ? 100
                : (
                    (i + 1) /
                    folders.length *
                    50
                );


        $('brt-bar').style.width =
            `${percent}%`;


        $('brt-percent').textContent =
            `${percent.toFixed(1)}%`;
    }


    // ============================================================
    // 按目标目录分组文件
    // ============================================================

    const groups =
        new Map();


    for (const file of files) {

        if (!groups.has(file.target_path)) {

            groups.set(
                file.target_path,
                []
            );
        }


        groups
            .get(file.target_path)
            .push(file);
    }


    // ============================================================
    // 转存文件
    // ============================================================

    let successCount = 0;

    let failedCount = 0;

    let batchCount = 0;

    const failedFiles = [];


    // ------------------------------------------------------------
    // 单批转存
    // ------------------------------------------------------------

    async function transferBatch(
        targetPath,
        batch
    ) {

        const fsIds =
            batch.map(
                file =>
                    String(file.fs_id)
            );


        for (
            let retry = 1;
            retry <= CONFIG.max_retry;
            retry++
        ) {

            try {

                $('brt-status').textContent =
                    '📤 正在转存文件';

                $('brt-current').textContent =
                    `${targetPath} → ${batch.length} 个文件`;


                const body =
                    new URLSearchParams();


                body.append(
                    'from_uk',
                    CONFIG.from_uk
                );


                body.append(
                    'msg_id',
                    CONFIG.msg_id
                );


                body.append(
                    'path',
                    targetPath
                );


                body.append(
                    'ondup',
                    'newcopy'
                );


                body.append(
                    'async',
                    '4'
                );


                body.append(
                    'fs_ids',
                    JSON.stringify(fsIds)
                );


                body.append(
                    'type',
                    '2'
                );


                body.append(
                    'gid',
                    CONFIG.gid
                );


                const params =
                    new URLSearchParams({

                        channel:
                            'chunlei',

                        clienttype:
                            '0',

                        web:
                            '1',

                        app_id:
                            '250528',

                        logId:
                            CONFIG.transfer_logId,

                        bdstoken:
                            CONFIG.transfer_bdstoken,

                        'dp-logid':
                            CONFIG.transfer_dp_logid
                    });


                const response =
                    await fetch(
                        `/mbox/msg/transfer?${params}`,
                        {
                            method: 'POST',

                            credentials:
                                'include',

                            headers: {
                                'Content-Type':
                                    'application/x-www-form-urlencoded; charset=UTF-8'
                            },

                            body
                        }
                    );


                const data =
                    await response.json();


                console.log(
                    `📤 转存 ${targetPath}`,
                    data
                );


                if (
                    data.errno === 0
                ) {

                    return true;
                }


                throw new Error(
                    data.errmsg ||
                    `errno=${data.errno}`
                );


            } catch (error) {

                console.warn(
                    `⚠️ 转存失败，第${retry}次`,
                    error
                );


                if (
                    retry <
                    CONFIG.max_retry
                ) {

                    await sleep(
                        retry * 1500
                    );
                }
            }
        }


        return false;
    }


    // ============================================================
    // 一个目录一个目录转存
    // ============================================================

    for (
        const [
            targetPath,
            group
        ]
        of groups
    ) {

        console.log(
            `📂 开始转存目录：${targetPath}`
        );


        for (
            let i = 0;
            i < group.length;
            i += CONFIG.batch_size
        ) {

            const batch =
                group.slice(
                    i,
                    i + CONFIG.batch_size
                );


            batchCount++;


            const success =
                await transferBatch(
                    targetPath,
                    batch
                );


            if (success) {

                successCount +=
                    batch.length;

            } else {

                failedCount +=
                    batch.length;


                failedFiles.push(
                    ...batch.map(
                        file => ({
                            ...file,
                            failed_target_path:
                                targetPath
                        })
                    )
                );
            }


            const processed =
                successCount +
                failedCount;


            const percent =
                files.length === 0
                    ? 100
                    : 50 +
                        (
                            processed /
                            files.length *
                            50
                        );


            $('brt-success').textContent =
                successCount;

            $('brt-failed').textContent =
                failedCount;

            $('brt-batch').textContent =
                batchCount;

            $('brt-bar').style.width =
                `${percent}%`;

            $('brt-percent').textContent =
                `${Math.min(
                    100,
                    percent
                ).toFixed(1)}%`;


            await sleep(
                CONFIG.delay
            );
        }
    }


    // ============================================================
    // 最终结果
    // ============================================================

    window.__BAIDU_RECURSIVE_TRANSFER_FAILED__ =
        failedFiles;


    window.__BAIDU_RECURSIVE_TRANSFER_RESULT__ = {

        folders:
            folders.length,

        files:
            files.length,

        created:
            createdCount,

        folderFailed,

        success:
            successCount,

        failed:
            failedCount,

        batches:
            batchCount
    };


    $('brt-bar').style.width =
        '100%';

    $('brt-percent').textContent =
        '100%';


    if (
        failedCount === 0 &&
        folderFailed === 0
    ) {

        $('brt-status').textContent =
            '🎉 全部完成';

        $('brt-current').textContent =
            `文件夹 ${createdCount} 个，文件 ${successCount} 个，全部转存成功`;

        $('brt-bar').style.background =
            '#16a34a';

    } else {

        $('brt-status').textContent =
            '⚠️ 完成，但存在失败';

        $('brt-current').textContent =
            `文件夹失败 ${folderFailed}，文件失败 ${failedCount}`;

        $('brt-bar').style.background =
            '#f59e0b';
    }


    console.log('');
    console.log('====================================');
    console.log('🎉 递归转存完成');
    console.log('====================================');
    console.log(`📁 文件夹：${folders.length}`);
    console.log(`🏗️ 创建成功：${createdCount}`);
    console.log(`❌ 文件夹失败：${folderFailed}`);
    console.log(`📄 文件：${files.length}`);
    console.log(`✅ 文件成功：${successCount}`);
    console.log(`❌ 文件失败：${failedCount}`);
    console.log(`📦 批次：${batchCount}`);
    console.log('====================================');


    window.__BAIDU_RECURSIVE_TRANSFER_RUNNING__ =
        false;

}

    // ---------- ④ 批量重命名 ----------
async function toolBatchRename() {

    // ==========================================
    // 百度网盘 · 批量重命名（可视化面板）
    // ==========================================
    // 功能：
    //   1. 自动识别当前文件夹（切换目录自动跟随）
    //   2. 规则预览：去前缀 / 去后缀 / 查找替换 / 正则替换
    //   3. 命名冲突自动消解：删除冲突文件后再改名（删除进入回收站，可恢复）
    //   4. 可视化勾选 + 用户确认后，调用网页版同款接口批量执行
    //
    // 用法：
    //   1. 登录百度网盘网页版，进入要处理的文件夹
    //   2. F12 → Console → 粘贴整段脚本 → 回车
    //   3. 右下角面板：设置规则 → 扫描预览 → 勾选 → 开始执行
    //
    // 接口（均使用当前浏览器已登录会话）：
    //   列表  GET  /rest/2.0/xpan/file?method=list
    //   改名  POST /api/filemanager?opera=rename
    //   删除  POST /api/filemanager?opera=delete&newVerify=1
    // ==========================================

    const APP_ID = "250528";
    const CLIENTTYPE = "0";
    const WEB = "1";
    const PAGE_SIZE = 100;

    // 20 位 dp-logid（网页版请求携带的日志 ID，随机生成即可）
    const DP_LOGID =
        String(Date.now()) +
        String(Math.floor(Math.random() * 1e7)).padStart(7, "0");

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const esc = (s) =>
        String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
            { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
        ));

    const $ = (id) => document.getElementById(id);

    // ==========================================
    // 0. bdstoken（接口需要，自动获取 + 手动兜底）
    // ==========================================

    let capturedToken = "";

    function captureToken(url) {
        if (capturedToken) return;
        const m = String(url || "").match(/[?&]bdstoken=([^&#]+)/);
        if (m) capturedToken = decodeURIComponent(m[1]);
    }

    // 劫持 fetch / XHR，捕获页面自身请求中夹带的 bdstoken
    (function hookNetwork() {
        try {
            const origFetch = window.fetch;
            window.fetch = function (...args) {
                try {
                    captureToken(
                        typeof args[0] === "string"
                            ? args[0]
                            : (args[0] && args[0].url) || ""
                    );
                } catch (e) {}
                return origFetch.apply(this, args);
            };
        } catch (e) {}

        try {
            const origOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                try { captureToken(url); } catch (e) {}
                return origOpen.call(this, method, url, ...rest);
            };
        } catch (e) {}
    })();

    function autoBdstoken() {
        const cands = [];
        try {
            if (window.locals && window.locals.bdstoken) {
                cands.push(window.locals.bdstoken);
            }
        } catch (e) {}
        try {
            if (window.yunData && window.yunData.MYBDSTOKEN) {
                cands.push(window.yunData.MYBDSTOKEN);
            }
        } catch (e) {}
        if (capturedToken) cands.push(capturedToken);
        try {
            for (const k of Object.keys(localStorage)) {
                if (/bdstoken/i.test(k)) {
                    const v = localStorage.getItem(k);
                    if (v && v.length <= 64) cands.push(v);
                }
            }
        } catch (e) {}
        try {
            const scripts = document.scripts;
            for (let i = 0; i < scripts.length; i++) {
                const m = (scripts[i].textContent || "").match(
                    /["']?bdstoken["']?\s*[:=]\s*["']([^"']+)["']/
                );
                if (m) cands.push(m[1]);
            }
        } catch (e) {}
        return cands.find(Boolean) || "";
    }

    function getToken() {
        return $("br-token").value.trim() || autoBdstoken();
    }

    // ==========================================
    // 1. 自动识别当前目录（与 run.js 同款逻辑）
    // ==========================================

    function getCurrentPath() {
        const hash = location.hash || "";
        let m = hash.match(/[?&]path=([^&]*)/i);
        if (m) return decodeURIComponent(m[1]);
        m = hash.match(/#\/dir\/([^?&]*)/i);
        if (m) return decodeURIComponent(m[1]);
        const sp = new URLSearchParams(location.search);
        if (sp.get("dir")) return sp.get("dir");
        if (sp.get("path")) return sp.get("path");
        return "/";
    }

    // ==========================================
    // 2. 目录列表 / 递归扫描（复用 run.js 已验证接口）
    // ==========================================

    async function listDirectory(dir) {
        let page = 1;
        const result = [];
        while (true) {
            const params = new URLSearchParams({
                method: "list",
                dir: dir,
                page: String(page),
                num: String(PAGE_SIZE),
                web: "web",
                order: "name",
                desc: "0"
            });
            const res = await fetch("/rest/2.0/xpan/file?" + params.toString(), {
                credentials: "include"
            });
            const json = await res.json();
            if (json.errno !== 0) {
                throw new Error("读取目录失败：" + (json.errmsg || json.errno));
            }
            const list = json.list || [];
            result.push(...list);
            if (list.length < PAGE_SIZE) break;
            page++;
            if (page > 500) break;
        }
        return result;
    }

    async function scanFolder(dir, recursive, onProgress) {
        const items = [];
        const queue = [dir];
        let guard = 0;
        while (queue.length) {
            if (++guard > 3000) throw new Error("目录层级过深，已中止");
            const d = queue.shift();
            const files = await listDirectory(d);
            for (const f of files) {
                const isDir =
                    f.isdir === 1 || f.isdir === "1" || f.isdir === true;
                items.push({
                    name: f.server_filename,
                    path: f.path,
                    fs_id: f.fs_id,
                    isdir: isDir,
                    dir: d
                });
                if (isDir && recursive) queue.push(f.path);
            }
            if (onProgress) onProgress(d, items.length);
            await sleep(30);
        }
        return items;
    }

    // ==========================================
    // 3. 改名 / 删除（按网页版实际抓包请求复刻）
    // ==========================================

    // POST /api/filemanager?async=2&onnest=fail&opera=rename
    //      &bdstoken=...&clienttype=0&app_id=250528&web=1&dp-logid=...
    // body: ...&filelist=[{"id":fs_id,"path":"/a/b.mp4","newname":"b.mp4"}]
    async function renameOne(item, newName) {
        const token = getToken();
        if (!token) throw new Error("未获取到 bdstoken");

        const entry = {};
        if (item.fs_id != null) entry.id = item.fs_id;
        entry.path = item.path;
        entry.newname = newName;
        const filelist = JSON.stringify([entry]);

        const common = {
            async: "2",
            onnest: "fail",
            opera: "rename",
            bdstoken: token,
            clienttype: CLIENTTYPE,
            app_id: APP_ID,
            web: WEB,
            "dp-logid": DP_LOGID
        };

        const query = new URLSearchParams(common).toString();
        const body = new URLSearchParams(common);
        body.set("filelist", filelist);

        const res = await fetch("/api/filemanager?" + query, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                Accept: "application/json, text/plain, */*"
            },
            body: body.toString()
        });

        return await res.json();
    }

    // POST /api/filemanager?async=2&onnest=fail&opera=delete&newVerify=1
    //      &bdstoken=...&clienttype=0&app_id=250528&web=1&dp-logid=...
    // body: ...&filelist=["/a/b.mp4"]
    async function deleteOne(item) {
        const token = getToken();
        if (!token) throw new Error("未获取到 bdstoken");

        const common = {
            async: "2",
            onnest: "fail",
            opera: "delete",
            bdstoken: token,
            newVerify: "1",
            clienttype: CLIENTTYPE,
            app_id: APP_ID,
            web: WEB,
            "dp-logid": DP_LOGID
        };

        const query = new URLSearchParams(common).toString();
        const body = new URLSearchParams(common);
        body.set("filelist", JSON.stringify([item.path]));

        const res = await fetch("/api/filemanager?" + query, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                Accept: "application/json, text/plain, */*"
            },
            body: body.toString()
        });

        return await res.json();
    }

    function errnoText(errno) {
        const map = {
            "-6": "未登录或无权限（请刷新网盘页面重新登录）",
            "111": "bdstoken 已失效（请刷新页面，或在面板中手动填写新 token）",
            "12": "目标位置已存在同名文件",
            "-9": "文件不存在或路径失效",
            "-7": "参数错误",
            "31034": "操作太频繁被限流（请加大间隔稍后再试）"
        };
        const key = String(errno);
        return map[key] || ("errno=" + key);
    }

    // ==========================================
    // 4. 规则引擎
    // ==========================================

    const INVALID_NAME = /[\/\\:*?"<>|\x00-\x1f]/;

    // 拆分扩展名：最后一个点，后缀仅限字母数字且长度<=10，点不在首位
    function splitExt(name) {
        const idx = name.lastIndexOf(".");
        if (idx > 0) {
            const ext = name.slice(idx);
            if (ext.length <= 11 && /^\.[A-Za-z0-9]+$/.test(ext)) {
                return { stem: name.slice(0, idx), ext };
            }
        }
        return { stem: name, ext: "" };
    }

    function buildRenamer(cfg) {
        const mode = cfg.mode;
        const find = cfg.find;
        const replace = cfg.replace || "";
        let re = null;
        if (mode === "regex") {
            if (!find) throw new Error("正则表达式不能为空");
            re = new RegExp(find, "g");
        }
        return (name) => {
            const { stem, ext } = cfg.protectExt
                ? splitExt(name)
                : { stem: name, ext: "" };
            let newStem;
            if (mode === "prefix") {
                if (!find || !stem.startsWith(find)) return null;
                newStem = stem.slice(find.length);
            } else if (mode === "suffix") {
                if (!find || !stem.endsWith(find)) return null;
                newStem = stem.slice(0, stem.length - find.length);
            } else if (mode === "replace") {
                if (!find) return null;
                newStem = stem.split(find).join(replace);
            } else {
                newStem = stem.replace(re, replace);
            }
            if (newStem === stem) return null;
            return newStem + ext;
        };
    }

    function validateNewName(name) {
        if (!name) return "新文件名为空";
        if (INVALID_NAME.test(name)) return '含非法字符 / \\ : * ? " < > |';
        if (name.length > 100) return "名称超过 100 字符";
        if (/^\s|\s$/.test(name)) return "首尾不能有空格";
        return "";
    }

    // ==========================================
    // 5. 面板 UI
    // ==========================================

    const oldPanel = $("__BAIDU_RENAME_PANEL__");
    if (oldPanel) oldPanel.remove();

    const panel = document.createElement("div");
    panel.id = "__BAIDU_RENAME_PANEL__";
    panel.style.cssText = `
        position:fixed; right:16px; bottom:16px; width:640px;
        max-height:90vh; display:flex; flex-direction:column;
        background:#fff; border-radius:14px;
        box-shadow:0 8px 40px rgba(0,0,0,.25);
        z-index:999999999;
        font:13px/1.6 Arial,'Microsoft YaHei',sans-serif;
        color:#222; overflow:hidden;
    `;
    panel.innerHTML = `
        <div style="padding:10px 16px; background:#1677ff; color:#fff;
                    display:flex; justify-content:space-between; align-items:center;">
            <b style="font-size:15px;">百度网盘 · 批量重命名</b>
            <span>
                <button id="br-min" style="margin-right:6px; padding:0 8px; cursor:pointer;
                    border:none; background:rgba(255,255,255,.25); color:#fff; border-radius:6px;">—</button>
                <button id="br-close" style="padding:0 8px; cursor:pointer;
                    border:none; background:rgba(255,255,255,.25); color:#fff; border-radius:6px;">×</button>
            </span>
        </div>

        <div id="br-body" style="padding:12px 16px; overflow:auto; flex:1;">

            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
                <span style="flex:0 0 auto;">当前目录</span>
                <input id="br-dir" style="flex:1; min-width:0; padding:4px 8px;
                    border:1px solid #ddd; border-radius:6px;">
                <label style="white-space:nowrap;">
                    <input type="checkbox" id="br-follow" checked> 自动跟随
                </label>
            </div>

            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
                <span style="flex:0 0 auto;">bdstoken</span>
                <input id="br-token" placeholder="一般自动获取，留空即可；失败时可在控制台执行 locals.bdstoken 手动粘贴"
                    style="flex:1; min-width:0; padding:4px 8px; border:1px solid #ddd; border-radius:6px;">
                <span id="br-tokenstate" style="font-size:12px; white-space:nowrap;"></span>
            </div>

            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap;">
                <select id="br-mode" style="padding:4px 6px; border:1px solid #ddd; border-radius:6px;">
                    <option value="regex" selected>正则替换</option>
                    <option value="prefix">去除前缀</option>
                    <option value="suffix">去除后缀</option>
                    <option value="replace">查找替换</option>
                </select>
                <input id="br-find" value="^\\[\\d+\\]\\s*--\\s*"
                    style="flex:1; min-width:180px; padding:4px 8px; border:1px solid #ddd; border-radius:6px;">
                <input id="br-replace" placeholder="替换为（默认空）"
                    style="width:150px; padding:4px 8px; border:1px solid #ddd; border-radius:6px;">
            </div>

            <div id="br-presets" style="margin-bottom:8px; font-size:12px; color:#555;"></div>

            <div style="display:flex; gap:14px; flex-wrap:wrap; margin-bottom:8px; font-size:12px;">
                <label><input type="checkbox" id="br-protect" checked> 保护扩展名</label>
                <label><input type="checkbox" id="br-recursive"> 包含子目录</label>
                <label><input type="checkbox" id="br-renamedir"> 连文件夹一起改名</label>
                <label title="目标名已存在 / 多个文件改成同一个名时，先删除冲突文件再改名；删除进入回收站可恢复">
                    <input type="checkbox" id="br-delconflict" checked> 冲突时删除冲突文件
                </label>
                <label>请求间隔
                    <input id="br-delay" value="400" size="4"
                        style="padding:2px 4px; border:1px solid #ddd; border-radius:6px;"> ms
                </label>
            </div>

            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
                <button id="br-scan" style="padding:4px 14px; cursor:pointer;
                    border:none; background:#1677ff; color:#fff; border-radius:6px;">扫描预览</button>
                <span id="br-summary" style="font-size:12px; color:#555;"></span>
            </div>

            <div id="br-tablewrap" style="max-height:36vh; overflow:auto;
                border:1px solid #eee; border-radius:8px;"></div>

            <div style="display:flex; gap:8px; align-items:center; margin:10px 0; flex-wrap:wrap;">
                <button id="br-selectall" style="padding:4px 10px; cursor:pointer;
                    border:1px solid #1677ff; color:#1677ff; background:#fff; border-radius:6px;">全选 / 全不选</button>
                <button id="br-run" disabled style="padding:4px 14px; cursor:pointer;
                    border:none; background:#16a34a; color:#fff; border-radius:6px;">开始执行</button>
                <button id="br-stop" disabled style="padding:4px 10px; cursor:pointer;
                    border:1px solid #dc2626; color:#dc2626; background:#fff; border-radius:6px;">停止</button>
                <button id="br-retry" disabled style="padding:4px 10px; cursor:pointer;
                    border:1px solid #d97706; color:#d97706; background:#fff; border-radius:6px;">重试失败项</button>
                <button id="br-reload" style="padding:4px 10px; cursor:pointer;
                    border:1px solid #999; color:#555; background:#fff; border-radius:6px;">刷新网盘页面</button>
                <span id="br-progress" style="font-size:12px; color:#555;"></span>
            </div>

            <div style="height:8px; background:#eee; border-radius:8px; overflow:hidden; margin-bottom:8px;">
                <div id="br-bar" style="width:0%; height:100%; background:#1677ff; transition:width .2s;"></div>
            </div>

            <div id="br-log" style="max-height:130px; overflow:auto; font-size:12px; color:#666;
                background:#fafafa; border:1px solid #eee; border-radius:8px;
                padding:6px 8px; white-space:pre-wrap;"></div>
        </div>
    `;
    document.body.appendChild(panel);

    const dirInput = $("br-dir");
    const tokenInput = $("br-token");
    const tokenStateEl = $("br-tokenstate");
    const modeSel = $("br-mode");
    const findInput = $("br-find");
    const replaceInput = $("br-replace");
    const protectChk = $("br-protect");
    const recursiveChk = $("br-recursive");
    const renameDirChk = $("br-renamedir");
    const delConflictChk = $("br-delconflict");
    const delayInput = $("br-delay");
    const followChk = $("br-follow");
    const scanBtn = $("br-scan");
    const summaryEl = $("br-summary");
    const tableWrap = $("br-tablewrap");
    const runBtn = $("br-run");
    const stopBtn = $("br-stop");
    const retryBtn = $("br-retry");
    const selectAllBtn = $("br-selectall");
    const barEl = $("br-bar");
    const progressEl = $("br-progress");
    const logEl = $("br-log");

    const STATUS_TEXT = {
        ok: "待执行",
        running: "执行中…",
        done: "已提交",
        fail: "失败",
        conflict: "冲突",
        invalid: "名称无效",
        verify_ok: "已生效",
        verify_fail: "未生效"
    };

    const state = {
        dir: "/",
        items: null,
        scanKey: "",
        rows: [],
        order: [],
        nomatch: 0,
        running: false,
        stop: false,
        scannedOnce: false
    };

    function log(msg) {
        const time = new Date().toLocaleTimeString();
        logEl.textContent += `[${time}] ${msg}\n`;
        if (logEl.textContent.length > 20000) {
            logEl.textContent = logEl.textContent.slice(-12000);
        }
        logEl.scrollTop = logEl.scrollHeight;
        console.log("%c[批量重命名] " + msg, "color:#1677ff");
    }

    function updateTokenState() {
        const t = getToken();
        if (t) {
            tokenStateEl.textContent = "✅ 已获取";
            tokenStateEl.style.color = "#16a34a";
        } else {
            tokenStateEl.textContent = "⚠️ 未获取，请点击网盘页面任意文件后重试";
            tokenStateEl.style.color = "#d97706";
        }
    }

    function updateProgress(done, total) {
        const pct = total ? Math.round((done / total) * 100) : 0;
        barEl.style.width = pct + "%";
        progressEl.textContent = `${done}/${total}（${pct}%）`;
    }

    function updateRunButton() {
        runBtn.disabled =
            state.running ||
            !state.rows.some(
                (r) => r.checked && (r.status === "ok" || r.status === "fail")
            );
    }

    // ==========================================
    // 6. 计算待执行行 + 冲突消解 + 执行顺序
    //
    // 行类型 action：
    //   rename —— 改名（newName 为新名字）
    //   delete —— 删除（冲突消解产生：占用目标名的文件 / 重复项）
    // ==========================================

    function readRule() {
        return {
            mode: modeSel.value,
            find: findInput.value,
            replace: replaceInput.value,
            protectExt: protectChk.checked
        };
    }

    function computeRows() {
        const renamer = buildRenamer(readRule()); // 正则语法错误会抛出
        const items = state.items || [];
        const deleteOnConflict = delConflictChk.checked;

        const rows = [];
        let nomatch = 0;

        // ---- 基础行：规则命中的项 ----
        for (const it of items) {
            if (it.isdir && !renameDirChk.checked) continue;
            const newName = renamer(it.name);
            if (newName == null) {
                nomatch++;
                continue;
            }
            const invalid = validateNewName(newName);
            rows.push({
                item: it,
                newName,
                action: "rename",
                status: invalid ? "invalid" : "ok",
                checked: !invalid,
                reason: invalid,
                err: ""
            });
        }

        const itemByKey = new Map();
        const existNames = new Map();
        for (const it of items) {
            itemByKey.set(it.dir + "\u0000" + it.name, it);
            if (!existNames.has(it.dir)) existNames.set(it.dir, new Set());
            existNames.get(it.dir).add(it.name);
        }

        const keyOf = (r) => r.item.dir + "\u0000" + r.item.name;
        const targetKeyOf = (r) => r.item.dir + "\u0000" + r.newName;
        const rowKeys = new Set(rows.map(keyOf));

        // 会被腾空的名字（勾选的改名项，后续再加入删除项）
        const vacated = new Set(
            rows.filter((r) => r.status === "ok" && r.checked).map(keyOf)
        );

        // ---- 冲突 A：多个文件改成同一个名字 ----
        const targetGroups = new Map();
        for (const r of rows) {
            if (r.status !== "ok") continue;
            const k = targetKeyOf(r);
            if (!targetGroups.has(k)) targetGroups.set(k, []);
            targetGroups.get(k).push(r);
        }
        for (const group of targetGroups.values()) {
            if (group.length < 2) continue;
            if (!deleteOnConflict) {
                for (const r of group.slice(1)) {
                    r.status = "conflict";
                    r.reason = "多个文件将改为同一个名称";
                    r.checked = false;
                }
                continue;
            }
            // 保留第一个，其余源文件删除
            for (const r of group.slice(1)) {
                r.action = "delete";
                r.newName = null;
                r.status = "ok";
                r.checked = true;
                r.reason = "重复项（同名保留第一个，本文件将被删除）";
                vacated.add(keyOf(r));
            }
        }

        // ---- 冲突 B：目标名被现存文件占用 ----
        const deleteRows = [];
        for (const r of rows) {
            if (r.status !== "ok" || r.action !== "rename") continue;
            const set = existNames.get(r.item.dir);
            if (!set || !set.has(r.newName)) continue;
            const k = targetKeyOf(r);
            if (vacated.has(k)) continue; // 占用者会被改走或删掉
            const blocker = itemByKey.get(k);
            if (
                deleteOnConflict &&
                blocker &&
                !blocker.isdir && // 绝不自动删除文件夹
                !rowKeys.has(k) // 不删除规则命中项（避免误删用户漏勾选的项）
            ) {
                deleteRows.push({
                    item: blocker,
                    newName: null,
                    action: "delete",
                    status: "ok",
                    checked: true,
                    reason: "占用目标名，将删除后改名",
                    err: "",
                    blocks: r
                });
                vacated.add(k);
            } else {
                r.status = "conflict";
                r.reason =
                    blocker && blocker.isdir
                        ? "已存在同名文件夹，请手动处理"
                        : blocker
                        ? "目标名被未勾选的同名项占用"
                        : "目录下已存在同名文件";
                r.checked = false;
            }
        }

        // ---- 依赖关系：A 的新名 == B 的旧名 → B 先执行；删阻塞项先于依赖它的改名 ----
        const taskByOldName = new Map();
        for (const r of rows) {
            if (r.status === "ok" && r.checked) taskByOldName.set(keyOf(r), r);
        }
        for (const d of deleteRows) taskByOldName.set(keyOf(d), d);

        const deps = new Map();
        for (const r of rows) {
            if (r.status !== "ok" || r.action !== "rename") continue;
            const vacater = taskByOldName.get(targetKeyOf(r));
            if (vacater && vacater !== r) deps.set(r, vacater);
        }
        for (const d of deleteRows) {
            if (d.blocks) deps.set(d.blocks, d);
        }

        // ---- 循环依赖（A→B→A 互换名）无法自动消解，标记冲突 ----
        for (const r of rows) {
            if (r.status !== "ok" || !deps.has(r)) continue;
            const seen = new Set();
            let cur = r;
            let cyclic = false;
            while (cur) {
                if (seen.has(cur)) { cyclic = true; break; }
                seen.add(cur);
                cur = deps.get(cur);
            }
            if (cyclic) {
                r.status = "conflict";
                r.reason = "名称循环依赖（互相顶名），请手动处理";
                r.checked = false;
                vacated.delete(keyOf(r));
                deps.delete(r);
            }
        }

        const allRows = rows.concat(deleteRows);

        // 执行顺序：被依赖的先执行；路径深的先执行（父目录最后改名）
        const memo = new Map();
        const depthOf = (r, stack) => {
            if (memo.has(r)) return memo.get(r);
            if (stack.has(r)) return 0;
            stack.add(r);
            const dep = deps.get(r);
            const v = dep ? depthOf(dep, stack) + 1 : 0;
            stack.delete(r);
            memo.set(r, v);
            return v;
        };

        state.rows = allRows.sort((a, b) =>
            a.item.path.localeCompare(b.item.path)
        );
        state.nomatch = nomatch;

        state.order = allRows
            .filter((r) => r.checked && r.status === "ok")
            .sort((a, b) => {
                const da = depthOf(a, new Set());
                const db = depthOf(b, new Set());
                if (da !== db) return da - db;
                return (
                    b.item.path.split("/").length -
                    a.item.path.split("/").length
                );
            });
    }

    function updateSummary() {
        const rows = state.rows;
        const items = state.items || [];
        const renameOk = rows.filter(
            (r) => r.action === "rename" && r.status === "ok"
        ).length;
        const delOk = rows.filter(
            (r) => r.action === "delete" && r.status === "ok"
        ).length;
        const bad = rows.filter(
            (r) => r.status === "conflict" || r.status === "invalid"
        ).length;
        const dirs = items.filter((x) => x.isdir).length;
        summaryEl.innerHTML =
            `共 <b>${items.length}</b> 项（文件夹 ${dirs}）｜` +
            `规则命中 <b>${rows.length}</b>｜不匹配 ${state.nomatch}｜` +
            `<span style="color:#16a34a">将改名 ${renameOk}</span>｜` +
            `<span style="color:#d97706">将删除 ${delOk}</span>｜` +
            `<span style="color:#dc2626">冲突/无效 ${bad}</span>`;
    }

    function rowStatusText(r) {
        if (r.action === "delete") {
            if (r.status === "done" || r.status === "verify_ok") return "已删除";
            if (r.status === "fail" || r.status === "verify_fail") return "删除失败";
            return r.reason || "待删除";
        }
        return (r.reason || STATUS_TEXT[r.status] || r.status) +
            (r.err ? "（" + r.err + "）" : "");
    }

    function renderTable() {
        const rows = state.rows;
        if (!rows.length) {
            tableWrap.innerHTML =
                '<div style="padding:18px; text-align:center; color:#999;">' +
                '点击“扫描预览”加载当前目录文件</div>';
            updateRunButton();
            return;
        }
        let html = `
            <table style="width:100%; border-collapse:collapse; font-size:12px;">
                <thead>
                    <tr style="background:#f5f6f7;">
                        <th style="width:30px; padding:6px; border-bottom:1px solid #eee;"></th>
                        <th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">原文件名</th>
                        <th style="text-align:left; padding:6px; border-bottom:1px solid #eee;">新文件名</th>
                        <th style="text-align:left; padding:6px; border-bottom:1px solid #eee; width:170px;">状态</th>
                    </tr>
                </thead>
                <tbody>`;
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const disabled = r.status !== "ok" && r.status !== "fail";
            let color = "#888";
            if (r.status === "ok") {
                color = r.action === "delete" ? "#d97706" : "#16a34a";
            } else if (
                r.status === "fail" ||
                r.status === "verify_fail" ||
                r.status === "conflict" ||
                r.status === "invalid"
            ) {
                color = "#dc2626";
            } else if (r.status === "done" || r.status === "verify_ok") {
                color = r.action === "delete" ? "#888" : "#1677ff";
            }
            const newNameCell =
                r.action === "delete"
                    ? '<span style="color:#d97706;">🗑 删除文件</span>'
                    : esc(r.newName);
            html += `
                <tr style="border-bottom:1px solid #f2f2f2;">
                    <td style="text-align:center; padding:4px 6px;">
                        <input type="checkbox" class="br-chk" data-i="${i}"
                            ${r.checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
                    </td>
                    <td style="padding:4px 6px; word-break:break-all;"
                        title="${esc(r.item.path)}">${esc(r.item.name)}${r.item.isdir ? " 📁" : ""}</td>
                    <td style="padding:4px 6px; word-break:break-all; color:#0958d9;">${newNameCell}</td>
                    <td style="padding:4px 6px; color:${color};">${esc(rowStatusText(r))}</td>
                </tr>`;
        }
        html += "</tbody></table>";
        tableWrap.innerHTML = html;
        tableWrap.querySelectorAll(".br-chk").forEach((el) => {
            el.addEventListener("change", () => {
                const i = Number(el.dataset.i);
                state.rows[i].checked = el.checked;
                updateRunButton();
            });
        });
        updateRunButton();
    }

    // ==========================================
    // 7. 扫描
    // ==========================================

    async function doScan(force) {
        const dir = dirInput.value.trim() || "/";
        const recursive = recursiveChk.checked;
        const key = dir + "|" + recursive;
        try {
            if (force || !state.items || state.scanKey !== key) {
                scanBtn.disabled = true;
                summaryEl.textContent = "扫描中…";
                state.items = await scanFolder(dir, recursive, (d, n) => {
                    summaryEl.textContent = `扫描中… ${d}（已发现 ${n} 项）`;
                });
                state.scanKey = key;
                state.dir = dir;
            }
            computeRows();
            renderTable();
            updateSummary();
            updateTokenState();
            state.scannedOnce = true;
            const delCount = state.rows.filter(
                (r) => r.action === "delete" && r.status === "ok"
            ).length;
            log(
                `📂 扫描完成：${dir}（${recursive ? "含子目录" : "仅当前目录"}），` +
                `共 ${state.items.length} 项，命中 ${state.rows.length} 个` +
                (delCount ? `，其中 ${delCount} 个冲突文件将被删除` : "")
            );
        } catch (e) {
            summaryEl.textContent = "扫描失败";
            log("❌ " + (e.message || e));
        } finally {
            scanBtn.disabled = false;
        }
    }

    function recomputeFromCache() {
        if (!state.items) return;
        try {
            computeRows();
            renderTable();
            updateSummary();
        } catch (e) {
            summaryEl.textContent = "规则错误：" + e.message;
        }
    }

    // ==========================================
    // 8. 执行 / 停止 / 重试 / 验证
    // ==========================================

    async function runRows(rows) {
        if (!rows.length) return;
        const token = getToken();
        if (!token) {
            log(
                "❌ 未获取到 bdstoken。请刷新网盘页面后重试，" +
                "或在控制台执行 locals.bdstoken 并把值粘贴到面板输入框"
            );
            return;
        }

        state.running = true;
        state.stop = false;
        runBtn.disabled = true;
        retryBtn.disabled = true;
        stopBtn.disabled = false;
        scanBtn.disabled = true;

        const delay = Math.max(0, parseInt(delayInput.value, 10) || 0);
        let done = 0;
        let okCount = 0;

        for (const r of rows) {
            if (state.stop) {
                log("⏹️ 已手动停止，剩余项保持待执行状态");
                break;
            }
            const isDelete = r.action === "delete";
            r.status = "running";
            r.err = "";
            renderTable();

            try {
                const json = isDelete
                    ? await deleteOne(r.item)
                    : await renameOne(r.item, r.newName);
                if (json && json.errno === 0) {
                    const bad =
                        Array.isArray(json.info)
                            ? json.info.find((x) => x && x.errno && x.errno !== 0)
                            : null;
                    if (bad) {
                        r.status = "fail";
                        r.err =
                            errnoText(bad.errno) +
                            (bad.errmsg ? "：" + bad.errmsg : "");
                    } else {
                        r.status = "done";
                        okCount++;
                    }
                } else {
                    r.status = "fail";
                    r.err = errnoText(json && json.errno);
                    if (json && (json.errno === -6 || json.errno === 111)) {
                        log("❌ " + r.err + "，已中止后续操作");
                        renderTable();
                        break;
                    }
                }
            } catch (e) {
                r.status = "fail";
                r.err = String((e && e.message) || e);
            }

            done++;
            if (isDelete) {
                log(
                    (r.status === "done" ? "🗑 已删除：" : "❌ 删除失败：") +
                        r.item.path +
                        (r.err ? "   （" + r.err + "）" : "")
                );
            } else {
                log(
                    (r.status === "done" ? "✅ " : "❌ ") +
                        r.item.name +
                        "  →  " +
                        r.newName +
                        (r.err ? "   （" + r.err + "）" : "")
                );
            }
            updateProgress(done, rows.length);
            renderTable();
            await sleep(delay);
        }

        state.running = false;
        runBtn.disabled = false;
        stopBtn.disabled = true;
        scanBtn.disabled = false;
        retryBtn.disabled = !state.rows.some((r) => r.status === "fail");
        updateRunButton();

        if (okCount > 0 && !state.stop) {
            log("⏳ 等待服务器生效…");
            await sleep(1200);
            await verifyResults();
        }
    }

    async function verifyResults() {
        log("🔍 正在重新扫描验证结果…");
        let items;
        try {
            items = await scanFolder(state.dir, recursiveChk.checked);
        } catch (e) {
            log("⚠️ 验证扫描失败：" + (e.message || e));
            return;
        }
        const paths = new Set(items.map((x) => x.path));
        let ok = 0;
        let bad = 0;
        for (const r of state.rows) {
            if (r.status !== "done") continue;
            const oldExists = paths.has(r.item.path);
            if (r.action === "delete") {
                if (!oldExists) {
                    r.status = "verify_ok";
                    ok++;
                } else {
                    r.status = "verify_fail";
                    r.err = "文件仍存在";
                    bad++;
                }
                continue;
            }
            const newPath =
                r.item.path.slice(0, r.item.path.length - r.item.name.length) +
                r.newName;
            const newExists = paths.has(newPath);
            if (!oldExists && newExists) {
                r.status = "verify_ok";
                ok++;
            } else if (oldExists && !newExists) {
                r.status = "verify_fail";
                bad++;
            } else if (oldExists && newExists) {
                r.status = "verify_fail";
                r.err = "新旧名称同时存在";
                bad++;
            } else {
                r.status = "verify_ok"; // 旧名已消失即视为生效
                ok++;
            }
        }
        renderTable();
        log(`🔍 验证完成：生效 ${ok} 个，异常 ${bad} 个`);
        if (bad > 0) {
            log("⚠️ 存在异常项，可点击“重试失败项”，或点“刷新网盘页面”查看实际结果");
        }
    }

    // ==========================================
    // 9. 事件绑定
    // ==========================================

    const PRESETS = [
        { label: "去掉 [177]-- 前缀（字面）", mode: "prefix", find: "[177]--", replace: "" },
        { label: "去掉 [数字]-- 前缀（正则）", mode: "regex", find: "^\\[\\d+\\]\\s*--\\s*", replace: "" },
        { label: "去掉 01. / 01- 序号前缀（正则）", mode: "regex", find: "^\\s*\\d+\\s*[.、\\-_]\\s*", replace: "" },
        { label: "去掉“副本”二字（替换）", mode: "replace", find: "副本", replace: "" }
    ];

    $("br-presets").innerHTML =
        "快捷规则：" +
        PRESETS.map((p, i) =>
            `<button class="br-preset" data-i="${i}" style="margin:0 6px 4px 0; padding:2px 10px;
                font-size:12px; border:1px solid #1677ff; color:#1677ff; background:#fff;
                border-radius:10px; cursor:pointer;">${esc(p.label)}</button>`
        ).join("");

    document.querySelectorAll(".br-preset").forEach((btn) => {
        btn.addEventListener("click", () => {
            const p = PRESETS[Number(btn.dataset.i)];
            modeSel.value = p.mode;
            findInput.value = p.find;
            replaceInput.value = p.replace;
            recomputeFromCache();
        });
    });

    scanBtn.addEventListener("click", () => doScan(true));

    // 规则变化：只用缓存重算，不重新请求
    let debounceTimer = null;
    const onRuleChange = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(recomputeFromCache, 250);
    };
    [modeSel, findInput, replaceInput, protectChk, delConflictChk].forEach(
        (el) => {
            el.addEventListener("input", onRuleChange);
            el.addEventListener("change", onRuleChange);
        }
    );

    // 范围变化：需要重新扫描
    recursiveChk.addEventListener("change", () => doScan(true));
    renameDirChk.addEventListener("change", recomputeFromCache);

    selectAllBtn.addEventListener("click", () => {
        const okRows = state.rows.filter((r) => r.status === "ok");
        if (!okRows.length) return;
        const allChecked = okRows.every((r) => r.checked);
        okRows.forEach((r) => (r.checked = !allChecked));
        renderTable();
    });

    runBtn.addEventListener("click", () => {
        const targets = state.order.filter(
            (r) => r.checked && (r.status === "ok" || r.status === "fail")
        );
        if (!targets.length) return;
        const renameCount = targets.filter((t) => t.action === "rename").length;
        const deleteCount = targets.filter((t) => t.action === "delete").length;
        let msg = `即将重命名 ${renameCount} 个文件`;
        if (deleteCount > 0) {
            msg +=
                `，删除 ${deleteCount} 个文件` +
                `（命名冲突消解，删除后进入回收站可恢复）`;
        }
        msg += "，确定继续？";
        if (!confirm(msg)) return;
        log(
            `🚀 开始执行：改名 ${renameCount} 个` +
                (deleteCount ? `，删除 ${deleteCount} 个` : "")
        );
        updateProgress(0, targets.length);
        runRows(targets);
    });

    stopBtn.addEventListener("click", () => {
        state.stop = true;
        log("⏹️ 正在停止…");
    });

    retryBtn.addEventListener("click", () => {
        const failed = state.rows
            .filter((r) => r.status === "fail")
            .map((r) => {
                r.status = "ok";
                r.checked = true;
                r.err = "";
                return r;
            })
            .sort((a, b) => state.order.indexOf(a) - state.order.indexOf(b));
        if (!failed.length) return;
        renderTable();
        log(`🔁 重试 ${failed.length} 个失败项`);
        updateProgress(0, failed.length);
        runRows(failed);
    });

    $("br-reload").addEventListener("click", () => location.reload());

    $("br-close").addEventListener("click", () => {
        clearInterval(followTimer);
        panel.remove();
        window.__BAIDU_RENAME_PANEL__ = false;
    });

    $("br-min").addEventListener("click", () => {
        const body = $("br-body");
        body.style.display = body.style.display === "none" ? "block" : "none";
    });

    tokenInput.addEventListener("input", updateTokenState);

    // 自动跟随当前目录
    let lastAutoDir = getCurrentPath();
    dirInput.value = lastAutoDir;

    const followTimer = setInterval(() => {
        if (!followChk.checked) return;
        const p = getCurrentPath();
        if (p && p !== lastAutoDir) {
            lastAutoDir = p;
            dirInput.value = p;
            if (state.scannedOnce) {
                log("📍 检测到目录切换：" + p);
                doScan(true);
            }
        }
    }, 800);

    // ==========================================
    // 10. 启动
    // ==========================================

    window.__BAIDU_RENAME_PANEL__ = true;
    window.__BAIDU_RENAME__ = { state, doScan, runRows };

    log("面板已就绪，默认规则：去掉 [数字]-- 前缀（正则 ^\\[\\d+\\]\\s*--\\s*）");
    log("示例：[177]--5.7.2 硬件多线程.mp4  →  5.7.2 硬件多线程.mp4");
    log("冲突消解：目标名已存在 / 多项重名时，默认先删除冲突文件再改名（进入回收站可恢复）");
    updateTokenState();
    renderTable();
    updateSummary();
    setTimeout(() => doScan(false), 300);

}

    // ---------- ⑤ 视频时长导出 Excel ----------
async function toolDurationXlsx() {

    // ==========================================
    // 百度网盘：当前文件夹视频时长 → Excel
    // ==========================================

    const PAGE_SIZE = 100;
    const DELAY = 50;

    const videoExts = [
        ".mp4", ".mkv", ".avi", ".mov",
        ".wmv", ".flv", ".m4v", ".ts",
        ".webm", ".mpg", ".mpeg", ".3gp"
    ];

    // ==========================================
    // 0. 延迟函数
    // ==========================================

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==========================================
    // 1. 自动读取当前百度网盘路径
    // ==========================================

    function getCurrentPath() {

        const hash = location.hash;

        // 例如：
        // #/index?category=all&path=%2F考研_20260630_200139%2F10.%E6%9C%88%E5%BA%A6%E4%BC%B4%E5%AD%A6

        const match = hash.match(
            /[?&]path=([^&]*)/i
        );

        if (!match) {
            throw new Error(
                "无法从当前网页地址读取文件夹路径，请确认你现在是在百度网盘文件夹页面。"
            );
        }

        return decodeURIComponent(match[1]);
    }

    // ==========================================
    // 2. 判断是否视频
    // ==========================================

    function isVideo(file) {

        const name =
            (file.server_filename || "").toLowerCase();

        return (
            file.category === 1 ||
            videoExts.some(ext =>
                name.endsWith(ext)
            )
        );
    }

    // ==========================================
    // 3. 去掉视频后缀
    // ==========================================

    function removeExtension(name) {

        return name.replace(
            /\.(mp4|mkv|avi|mov|wmv|flv|m4v|ts|webm|mpg|mpeg|3gp)$/i,
            ""
        );
    }

    // ==========================================
    // 4. 秒 → 时:分:秒
    // ==========================================

    function formatDuration(seconds) {

        seconds = Math.round(Number(seconds));

        const h =
            Math.floor(seconds / 3600);

        const m =
            Math.floor((seconds % 3600) / 60);

        const s =
            seconds % 60;

        return [
            String(h).padStart(2, "0"),
            String(m).padStart(2, "0"),
            String(s).padStart(2, "0")
        ].join(":");
    }

    // ==========================================
    // 5. 获取目录文件
    // ==========================================

    async function listDirectory(dir) {

        let page = 1;
        const result = [];

        while (true) {

            const params = new URLSearchParams({

                method: "list",

                dir: dir,

                page: page,

                num: PAGE_SIZE,

                web: "web",

                order: "name",

                desc: "0"
            });

            const url =
                "/rest/2.0/xpan/file?" +
                params.toString();

            const res = await fetch(url, {
                credentials: "include"
            });

            const json = await res.json();

            if (json.errno !== 0) {

                throw new Error(
                    "读取目录失败：" +
                    (json.errmsg || json.errno)
                );
            }

            const list =
                json.list || [];

            result.push(...list);

            console.log(
                `📂 ${dir} → 第 ${page} 页，${list.length} 项`
            );

            if (list.length < PAGE_SIZE) {
                break;
            }

            page++;
        }

        return result;
    }

    // ==========================================
    // 6. 递归扫描所有视频
    // ==========================================

    async function scanFolder(dir, videos) {

        const files =
            await listDirectory(dir);

        for (const file of files) {

            // 文件夹
            if (file.isdir === 1) {

                await scanFolder(
                    file.path,
                    videos
                );
            }

            // 视频
            else if (isVideo(file)) {

                videos.push({

                    name:
                        file.server_filename,

                    path:
                        file.path,

                    fs_id:
                        String(file.fs_id)
                });

                console.log(
                    "🎬 找到：",
                    file.server_filename
                );
            }
        }
    }

    // ==========================================
    // 7. 获取视频时长
    // ==========================================

    async function getDuration(video) {

        const params = new URLSearchParams({

            type: "VideoURL",

            path: video.path,

            fs_id: video.fs_id,

            devuid: "0%1",

            clienttype: "1",

            channel:
                "android_15_25010PN30C_bd-netdisk_1523",

            nom3u8: "1",

            dlink: "1",

            media: "1",

            origin: "dlna"
        });

        const url =
            "/api/mediainfo?" +
            params.toString();

        try {

            const res = await fetch(url, {
                credentials: "include"
            });

            const text =
                await res.text();

            const json =
                JSON.parse(text);

            if (
                json.info &&
                json.info.duration !== undefined
            ) {

                return Number(
                    json.info.duration
                );
            }

            return null;

        } catch (e) {

            console.warn(
                "获取失败：",
                video.name,
                e
            );

            return null;
        }
    }

    // ==========================================
    // 8. 加载 Excel 库
    // ==========================================

    async function loadXLSX() {

        if (window.XLSX) {
            return;
        }

        console.log(
            "正在加载 Excel 生成组件..."
        );

        const script =
            document.createElement("script");

        script.src =
            "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

        document.head.appendChild(script);

        await new Promise(
            (resolve, reject) => {

                script.onload = resolve;

                script.onerror = reject;

            }
        );
    }

    // ==========================================
    // 9. 开始
    // ==========================================

    console.clear();

    console.log(
        "%c百度网盘视频时长提取器",
        "font-size:20px;font-weight:bold"
    );

    // 自动读取当前路径

    const ROOT =
        getCurrentPath();

    console.log(
        "📍 当前目录：",
        ROOT
    );

    // ==========================================
    // 10. 扫描
    // ==========================================

    console.log("");

    console.log(
        "========== 开始扫描 =========="
    );

    const videos = [];

    await scanFolder(
        ROOT,
        videos
    );

    console.log("");

    console.log(
        `🎬 共发现 ${videos.length} 个视频`
    );

    if (videos.length === 0) {

        alert(
            "当前文件夹及其子文件夹没有找到视频。"
        );

        return;
    }

    // ==========================================
    // 11. 获取时长
    // ==========================================

    console.log("");

    console.log(
        "========== 获取视频时长 =========="
    );

    const data = [];

    for (
        let i = 0;
        i < videos.length;
        i++
    ) {

        const video =
            videos[i];

        console.log(
            `[${i + 1}/${videos.length}]`,
            video.name
        );

        const duration =
            await getDuration(video);

        data.push({

            "文件名":
                removeExtension(
                    video.name
                ),

            "视频时长":
                duration !== null
                    ? formatDuration(duration)
                    : "获取失败"
        });

        console.log(
            "   →",
            duration !== null
                ? formatDuration(duration)
                : "获取失败"
        );

        // 每个视频请求之间等待 300ms
        await sleep(DELAY);
    }

    // ==========================================
    // 12. 生成 Excel
    // ==========================================

    console.log("");

    console.log(
        "========== 生成 Excel =========="
    );

    await loadXLSX();

    const worksheet =
        XLSX.utils.json_to_sheet(
            data,
            {
                header: [
                    "文件名",
                    "视频时长"
                ]
            }
        );

    const workbook =
        XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        "视频时长"
    );

    // 设置列宽

    worksheet["!cols"] = [

        {
            wch: 50
        },

        {
            wch: 15
        }

    ];

    // ==========================================
    // 13. 自动下载
    // ==========================================

    XLSX.writeFile(
        workbook,
        "百度网盘视频时长.xlsx"
    );

    // ==========================================
    // 14. 完成
    // ==========================================

    console.log("");

    console.log(
        "======================================"
    );

    console.log(
        "✅ Excel 已自动下载！"
    );

    console.log(
        `📁 当前目录：${ROOT}`
    );

    console.log(
        `🎬 视频数量：${data.length}`
    );

    console.log(
        "📊 Excel：百度网盘视频时长.xlsx"
    );

    console.log(
        "======================================"
    );

}

    // ==========================================================
    // 工具箱启动面板
    // ==========================================================

    const TOOLS = [
        { id: 'subtitle', name: '① 字幕批量导出',
          desc: '我的网盘 / 群组共享文件库；目录树多选、按目录分层导出 TXT/SRT/ZIP、接口诊断',
          needCfg: false, run: toolSubtitleExport },
        { id: 'compare', name: '② 群文件转存（对比断点）',
          desc: '先扫描目标目录对比已存在文件再转存，可断点续传；需填 TRANSFER_CONFIG',
          needCfg: true, run: toolTransferCompare },
        { id: 'recursive', name: '③ 群文件转存（递归）',
          desc: '按目录逐个创建并转存，适合首次全量转存；需填 TRANSFER_CONFIG',
          needCfg: true, run: toolTransferRecursive },
        { id: 'rename', name: '④ 批量重命名',
          desc: '正则 / 去前后缀 / 查找替换；先预览再执行，冲突会先删同名（进回收站）',
          needCfg: false, run: toolBatchRename },
        { id: 'duration', name: '⑤ 视频时长导出 Excel',
          desc: '启动后自动扫描当前页面目录，完成后下载 百度网盘视频时长.xlsx',
          needCfg: false, run: toolDurationXlsx }
    ];

    const started = new Set();

    function missingCfg() {
        return Object.keys(TRANSFER_CONFIG).filter(
            (k) => typeof TRANSFER_CONFIG[k] === 'string' &&
                    TRANSFER_CONFIG[k].indexOf('PASTE_') >= 0
        );
    }

    function tkLog(msg) {
        const el = document.getElementById('bdtk-log');
        if (el) el.textContent += (el.textContent ? '\n' : '') + msg;
        console.log('[百度网盘工具箱] ' + msg);
    }

    function renderCfg() {
        const miss = missingCfg();
        const el = document.getElementById('bdtk-cfg');
        if (!el) return;
        el.textContent = miss.length
            ? '⚠ 顶部 TRANSFER_CONFIG 未填完：' + miss.join('、') + '（仅转存工具需要）'
            : '✓ TRANSFER_CONFIG 已填写';
        el.style.color = miss.length ? '#b45309' : '#16a34a';
    }

    function renderTools() {
        const box = document.getElementById('bdtk-tools');
        if (!box) return;
        box.innerHTML = TOOLS.map((t) => `
            <button data-id="${t.id}" style="display:block;width:100%;text-align:left;margin:0 0 2px;
                padding:7px 10px;cursor:pointer;border:1px solid #1677ff;color:#1677ff;
                background:#fff;border-radius:6px;font-size:13px;">${t.name}${t.needCfg ? '（需配置）' : ''}</button>
            <div style="font-size:12px;color:#666;margin:0 0 10px 2px;">${t.desc}</div>
        `).join('');
        box.querySelectorAll('button[data-id]').forEach((btn) => {
            btn.addEventListener('click', () => launch(btn.dataset.id));
        });
    }

    async function launch(id) {
        const t = TOOLS.find((x) => x.id === id);
        if (!t) return;
        if (started.has(id)) {
            tkLog(t.name + ' 已启动过，刷新页面后可重新运行');
            return;
        }
        if (t.needCfg && missingCfg().length) {
            tkLog('请先编辑文件顶部 TRANSFER_CONFIG 并重新粘贴：' + missingCfg().join('、'));
            return;
        }
        started.add(id);
        tkLog('启动 ' + t.name + ' …');
        try {
            await t.run();
            tkLog(t.name + ' 已就绪');
        } catch (e) {
            started.delete(id);
            tkLog(t.name + ' 启动失败：' + ((e && e.message) || e));
        }
    }

    function buildPanel() {
        const el = document.createElement('div');
        el.id = 'bdtk-panel';
        el.style.cssText = 'position:fixed;right:16px;bottom:16px;width:370px;max-height:82vh;' +
            'overflow:auto;z-index:2147483000;background:#fff;border:1px solid #ddd;' +
            'border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18);' +
            "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#333;";
        el.innerHTML = `
            <div style="padding:10px 14px;background:#1677ff;color:#fff;display:flex;
                        justify-content:space-between;align-items:center;">
                <b style="font-size:15px;">百度网盘工具箱</b>
                <span>
                    <button id="bdtk-min" style="margin-right:6px;padding:0 8px;cursor:pointer;border:none;
                        background:rgba(255,255,255,.25);color:#fff;border-radius:6px;">—</button>
                    <button id="bdtk-close" style="padding:0 8px;cursor:pointer;border:none;
                        background:rgba(255,255,255,.25);color:#fff;border-radius:6px;">×</button>
                </span>
            </div>
            <div id="bdtk-body" style="padding:12px 14px;">
                <div style="font-size:12px;color:#666;margin-bottom:10px;">
                    在本页 Console 粘贴运行。群共享视频常无智能字幕，可先转存到自己的网盘再导出。<br>
                    注意：Console 粘贴脚本有风险，请确认来源可信。
                </div>
                <div id="bdtk-tools"></div>
                <div id="bdtk-cfg" style="font-size:12px;margin:4px 0 10px;"></div>
                <div id="bdtk-log" style="max-height:110px;overflow:auto;font-size:12px;color:#555;
                    background:#fafafa;border:1px solid #eee;border-radius:6px;padding:6px 8px;
                    white-space:pre-wrap;"></div>
            </div>`;
        document.body.appendChild(el);
        el.querySelector('#bdtk-min').addEventListener('click', () => {
            const body = el.querySelector('#bdtk-body');
            body.style.display = body.style.display === 'none' ? '' : 'none';
        });
        el.querySelector('#bdtk-close').addEventListener('click', () => el.remove());
        return el;
    }

    function showPanel() {
        if (document.getElementById('bdtk-panel')) return;
        buildPanel();
        renderTools();
        renderCfg();
    }

    window.__BD_TOOLKIT__ = {
        tools: TOOLS,
        config: TRANSFER_CONFIG,
        launch: launch,
        show: showPanel,
        hide: () => {
            const el = document.getElementById('bdtk-panel');
            if (el) el.remove();
        }
    };

    showPanel();
    tkLog('工具箱已就绪，点击上方按钮启动对应工具。可随时执行 __BD_TOOLKIT__.show() 重新打开面板。');
})();
