// Agent Skill resource - paste into the pan.baidu.com browser Console; do NOT run with node.
// Original project: BaiduNetdiskVideoExtractor. Usage: see SKILL.md.
(async () => {

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

})();
