/**
 * 百度网盘工具箱 · 启动器（功能汇总，按需加载模块）
 *
 * 用法：登录 https://pan.baidu.com → F12 → Console → 粘贴本文件 → 回车
 *       先出现功能菜单，点击某个功能后才下载并执行对应模块。
 *
 * 本文件不含业务代码。模块放在仓库 modules/ 目录，首次点击时从下面的数据源拉取，
 * 源码只缓存在内存里，刷新页面即清空；模块也可以单独复制粘贴到 Console 使用。
 *
 * 数据源（按顺序回退）：
 *   1. 自定义根 URL（高级里填写，可用于本地服务器 / 私有镜像）
 *   2. https://cdn.jsdelivr.net/gh/<repo>@<ref>/modules/
 *   3. https://fastly.jsdelivr.net/gh/<repo>@<ref>/modules/
 *   4. https://raw.githubusercontent.com/<repo>/<ref>/modules/
 * 全部失败时，可在「高级 / 离线加载」里粘贴模块源码执行。
 *
 * 配置：仅群文件转存模块需要。在菜单「配置」区填一次，加载模块时工具箱会把源码中的
 *       占位值替换进去；配置只保存在内存，不写 localStorage、不外发、不提交仓库。
 *
 * 刚推送新模块时 CDN 可能有缓存，可用「清除模块缓存」或把 REF 固定到某个 commit。
 */
(async () => {
    'use strict';

    const REPO = 'bylxgodking/BaiduNetdiskVideoExtractor';
    let REF = 'main';
    let customBase = '';

    const MODULES = [
        {
            id: 'subtitle', name: '① 字幕批量导出', file: 'subtitle-export.js', cfg: false,
            desc: '我的网盘 / 群组共享文件库；目录树多选、按目录分层导出 TXT/SRT/ZIP、接口诊断'
        },
        {
            id: 'compare', name: '② 群文件转存（对比断点）', file: 'group-transfer-compare.js', cfg: true,
            desc: '先对比目标目录已存在文件再转存，可断点续传；需填写配置'
        },
        {
            id: 'recursive', name: '③ 群文件转存（递归）', file: 'group-transfer-recursive.js', cfg: true,
            desc: '按目录递归创建并转存，适合首次全量转存；需填写配置'
        },
        {
            id: 'rename', name: '④ 批量重命名', file: 'batch-rename.js', cfg: false,
            desc: '正则 / 去前后缀 / 查找替换；先预览再执行，冲突会先删同名（进回收站）'
        },
        {
            id: 'duration', name: '⑤ 视频时长导出 Excel', file: 'duration-to-xlsx.js', cfg: false,
            desc: '启动后自动扫描当前页面目录，完成后下载 百度网盘视频时长.xlsx'
        }
    ];

    const FIELDS = [
        { key: 'PASTE_GID', label: 'gid', tip: '群 ID' },
        { key: 'PASTE_MSG_ID', label: 'msg_id', tip: '群消息 ID' },
        { key: 'PASTE_FROM_UK', label: 'from_uk', tip: '分享者 uk' },
        { key: 'PASTE_SOURCE_FS_ID', label: '源文件夹 fs_id', tip: '对比断点版：要转存的群文件夹' },
        { key: 'PASTE_ROOT_FS_ID', label: '根目录 fs_id', tip: '递归版：群文件库根目录' },
        { key: 'PASTE_TARGET_ROOT', label: '目标目录', tip: '自己网盘绝对路径，如 /字幕转存' },
        { key: 'PASTE_BDSTOKEN', label: 'bdstoken', tip: '页面会话 token' },
        { key: 'PASTE_LOGID', label: 'logId', tip: '从 Network 里一次成功请求复制' },
        { key: 'PASTE_DP_LOGID', label: 'dp-logid', tip: '20 位随机串，从请求复制' }
    ];

    const cfg = Object.create(null);
    const cache = new Map();
    const started = new Set();
    const status = Object.create(null);

    let canEval = true;
    try { new Function('return 1'); } catch (e) { canEval = false; }

    function urlsFor(file) {
        const list = [];
        if (customBase) list.push(customBase.replace(/\/?$/, '/') + file);
        list.push(`https://cdn.jsdelivr.net/gh/${REPO}@${REF}/modules/${file}`);
        list.push(`https://fastly.jsdelivr.net/gh/${REPO}@${REF}/modules/${file}`);
        list.push(`https://raw.githubusercontent.com/${REPO}/${REF}/modules/${file}`);
        return list;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function log(msg) {
        const el = document.getElementById('bdtk-log');
        if (el) {
            el.textContent += (el.textContent ? '\n' : '') + msg;
            el.scrollTop = el.scrollHeight;
        }
        console.log('[百度网盘工具箱] ' + msg);
    }

    function toggle(id, forceOpen) {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = (forceOpen === true || el.style.display === 'none') ? '' : 'none';
    }

    function renderTools() {
        const box = document.getElementById('bdtk-tools');
        if (!box) return;
        box.innerHTML = MODULES.map((m) => {
            const st = status[m.id] || '';
            const color = started.has(m.id) ? '#16a34a' : '#1677ff';
            return `
                <button class="tbtn" data-id="${m.id}" style="border-color:${color};color:${color}">
                    ${esc(m.name)}${m.cfg ? ' · 需配置' : ''}
                    ${st ? `<span style="float:right;font-size:11px;">${esc(st)}</span>` : ''}
                </button>
                <div class="desc">${esc(m.desc)} <span class="file">${esc(m.file)}</span></div>`;
        }).join('');
        box.querySelectorAll('button[data-id]').forEach((btn) => {
            btn.addEventListener('click', () => launch(btn.dataset.id));
        });
    }

    function renderFields() {
        const box = document.getElementById('bdtk-fields');
        if (!box) return;
        box.innerHTML = FIELDS.map((f) => `
            <label class="field">
                <span title="${esc(f.tip)}">${esc(f.label)}</span>
                <input data-key="${f.key}" value="${esc(cfg[f.key] || '')}" placeholder="${esc(f.tip)}">
            </label>`).join('');
        box.querySelectorAll('input[data-key]').forEach((inp) => {
            inp.addEventListener('input', () => { cfg[inp.dataset.key] = inp.value.trim(); });
        });
    }

    function renderSource() {
        const el = document.getElementById('bdtk-source');
        if (el) el.textContent = urlsFor(MODULES[0].file).join('   →   ');
    }

    async function fetchText(url) {
        const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = await res.arrayBuffer();
        return new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '');
    }

    async function loadModule(file) {
        if (cache.has(file)) return cache.get(file);
        const errs = [];
        for (const url of urlsFor(file)) {
            try {
                const code = await fetchText(url);
                if (code.length < 200) throw new Error('内容过短');
                cache.set(file, code);
                log(`已加载 ${file}（${new URL(url).host}，${Math.round(code.length / 1024)} KB）`);
                return code;
            } catch (e) {
                errs.push(new URL(url).host + ': ' + ((e && e.message) || e));
            }
        }
        throw new Error(errs.join(' | '));
    }

    function injectConfig(code) {
        return code.replace(/(['"])PASTE_([A-Z0-9_]+)\1/g, (all, _q, key) => {
            const v = cfg[key];
            return (v === undefined || v === null || v === '') ? all : JSON.stringify(String(v));
        });
    }

    function remainingKeys(code) {
        const out = new Set();
        const re = /['"]PASTE_([A-Z0-9_]+)['"]/g;
        let m;
        while ((m = re.exec(code))) out.add(m[1]);
        return Array.from(out).map((k) => 'PASTE_' + k);
    }

    function execute(code, file) {
        const src = code + `\n//# sourceURL=bdtk-module-${file}`;
        if (canEval) {
            new Function(src)();
        } else {
            const s = document.createElement('script');
            s.textContent = src;
            (document.head || document.documentElement).appendChild(s);
            s.remove();
        }
    }

    async function launch(id, force) {
        const mod = MODULES.find((m) => m.id === id);
        if (!mod) return;
        if (started.has(id) && !force) {
            log(`${mod.name} 已启动过；刷新页面可重新运行，或执行 __BD_TOOLKIT__.launch('${id}', true)`);
            return;
        }

        status[id] = '加载中…';
        renderTools();
        let code;
        try {
            code = await loadModule(mod.file);
        } catch (e) {
            status[id] = '';
            renderTools();
            log(`${mod.name} 在线加载失败：${(e && e.message) || e}`);
            log('可在「高级 / 离线加载」里粘贴该模块源码执行，或检查网络与 REF 设置。');
            toggle('bdtk-adv', true);
            return;
        }

        const injected = injectConfig(code);
        const left = remainingKeys(injected);
        if (left.length) {
            status[id] = '';
            renderTools();
            log(`${mod.name} 需要先填写配置：${left.join('、')}`);
            toggle('bdtk-cfgbox', true);
            return;
        }

        try {
            execute(injected, mod.file);
            started.add(id);
            status[id] = '已启动';
            renderTools();
            log(`${mod.name} 已启动，功能面板通常出现在页面右下角。`);
        } catch (e) {
            status[id] = '';
            renderTools();
            log(`${mod.name} 执行失败：${(e && e.message) || e}`);
            if (!canEval) log('当前页面阻止了动态执行，请改为直接把模块源码复制到 Console 运行。');
        }
    }

    function runPasted() {
        const sel = document.getElementById('bdtk-offline-module');
        const ta = document.getElementById('bdtk-offline-code');
        const mod = MODULES.find((m) => m.id === (sel && sel.value));
        const code = ta ? ta.value.trim() : '';
        if (!mod || !code) { log('请选择模块并粘贴源码'); return; }
        const injected = injectConfig(code);
        const left = remainingKeys(injected);
        if (left.length) {
            log('离线模块仍需配置：' + left.join('、'));
            toggle('bdtk-cfgbox', true);
            return;
        }
        try {
            execute(injected, mod.file);
            started.add(mod.id);
            status[mod.id] = '已启动(离线)';
            renderTools();
            log(`${mod.name} 已通过离线源码启动。`);
        } catch (e) {
            log('离线执行失败：' + ((e && e.message) || e));
        }
    }

    function buildPanel() {
        const el = document.createElement('div');
        el.id = 'bdtk-panel';
        el.style.cssText = 'position:fixed;right:16px;bottom:16px;width:390px;max-height:84vh;' +
            'overflow:auto;z-index:2147483000;background:#fff;border:1px solid #ddd;' +
            'border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18);' +
            "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#333;";
        el.innerHTML = `
            <style>
                #bdtk-panel .tbtn { display:block;width:100%;text-align:left;margin:0 0 2px;padding:7px 10px;
                    cursor:pointer;border:1px solid #1677ff;background:#fff;border-radius:6px;font-size:13px; }
                #bdtk-panel .tbtn:hover { background:#f0f6ff; }
                #bdtk-panel .desc { font-size:12px;color:#666;margin:0 0 10px 2px; }
                #bdtk-panel .file { color:#aaa; }
                #bdtk-panel .sec { font-size:12px;cursor:pointer;background:#f5f5f5;border:1px solid #eee;
                    border-radius:6px;padding:6px 8px;margin:10px 0 6px;display:flex;justify-content:space-between; }
                #bdtk-panel input, #bdtk-panel select, #bdtk-panel textarea { border:1px solid #ddd;
                    border-radius:5px;padding:4px 6px;font-size:12px;font-family:inherit; }
                #bdtk-panel .field { display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px; }
                #bdtk-panel .field span { width:112px;color:#555;flex:none; }
                #bdtk-panel .field input { flex:1;min-width:0; }
                #bdtk-panel .row { display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0; }
                #bdtk-panel .sbtn { padding:4px 10px;cursor:pointer;border:1px solid #1677ff;color:#1677ff;
                    background:#fff;border-radius:5px;font-size:12px; }
                #bdtk-panel .small { font-size:11px;color:#888;line-height:1.6;word-break:break-all; }
                #bdtk-panel textarea { width:100%;box-sizing:border-box;height:90px; }
            </style>
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
                <div class="small" style="margin-bottom:10px;">
                    先选功能，再按需加载模块（不会一次性下载全部代码）。群共享视频常无智能字幕，
                    可先转存到自己的网盘再导出。Console 粘贴脚本有风险，请确认来源可信。
                </div>
                <div id="bdtk-tools"></div>

                <div class="sec" id="bdtk-cfg-head"><span>配置（仅转存模块需要）</span><span>展开 / 收起</span></div>
                <div id="bdtk-cfgbox" style="display:none;">
                    <div id="bdtk-fields"></div>
                    <div class="row">
                        <button class="sbtn" id="bdtk-autotoken">自动填 bdstoken</button>
                        <button class="sbtn" id="bdtk-clearcfg">清空配置</button>
                    </div>
                    <div class="small">
                        配置只保存在本页内存，不写 localStorage、不外发。logId / dp-logid
                        从浏览器 Network 里一次成功的请求复制。填完后再点一次功能按钮即可。
                    </div>
                </div>

                <div class="sec" id="bdtk-adv-head"><span>高级 / 离线加载</span><span>展开 / 收起</span></div>
                <div id="bdtk-adv" style="display:none;">
                    <div class="small">模块地址：<span id="bdtk-source"></span></div>
                    <div class="row">
                        <input id="bdtk-base" size="38" placeholder="自定义模块根 URL，例 http://localhost:8000/modules/">
                        <button class="sbtn" id="bdtk-applybase">应用</button>
                    </div>
                    <div class="row">
                        <button class="sbtn" id="bdtk-clearcache">清除模块缓存</button>
                        <span class="small">模块更新后点此重新拉取</span>
                    </div>
                    <div class="small">在线源全部失败时，从 GitHub 复制模块源码粘贴到这里：</div>
                    <div class="row">
                        <select id="bdtk-offline-module">
                            ${MODULES.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}
                        </select>
                        <button class="sbtn" id="bdtk-runpasted">用粘贴的源码启动</button>
                    </div>
                    <textarea id="bdtk-offline-code" placeholder="在此粘贴模块 .js 全文"></textarea>
                </div>

                <div id="bdtk-log" style="margin-top:10px;max-height:120px;overflow:auto;font-size:12px;color:#555;
                    background:#fafafa;border:1px solid #eee;border-radius:6px;padding:6px 8px;
                    white-space:pre-wrap;"></div>
            </div>`;
        document.body.appendChild(el);

        el.querySelector('#bdtk-min').addEventListener('click', () => {
            const body = el.querySelector('#bdtk-body');
            body.style.display = body.style.display === 'none' ? '' : 'none';
        });
        el.querySelector('#bdtk-close').addEventListener('click', () => el.remove());
        el.querySelector('#bdtk-cfg-head').addEventListener('click', () => toggle('bdtk-cfgbox'));
        el.querySelector('#bdtk-adv-head').addEventListener('click', () => toggle('bdtk-adv'));

        el.querySelector('#bdtk-autotoken').addEventListener('click', () => {
            const t = (window.locals && window.locals.bdstoken) ||
                      (window.yunData && window.yunData.MYBDSTOKEN) || '';
            if (!t) { log('页面上没找到 bdstoken，请从 Network 请求里复制'); return; }
            cfg.PASTE_BDSTOKEN = String(t);
            renderFields();
            log('已自动填入 bdstoken');
        });
        el.querySelector('#bdtk-clearcfg').addEventListener('click', () => {
            Object.keys(cfg).forEach((k) => delete cfg[k]);
            renderFields();
            log('配置已清空');
        });
        el.querySelector('#bdtk-applybase').addEventListener('click', () => {
            customBase = el.querySelector('#bdtk-base').value.trim();
            cache.clear();
            renderSource();
            log(customBase ? '已设置自定义模块根 URL' : '已恢复默认数据源');
        });
        el.querySelector('#bdtk-clearcache').addEventListener('click', () => {
            cache.clear();
            log('模块缓存已清除');
        });
        el.querySelector('#bdtk-runpasted').addEventListener('click', runPasted);
        return el;
    }

    function show() {
        if (document.getElementById('bdtk-panel')) return;
        buildPanel();
        renderTools();
        renderFields();
        renderSource();
    }

    window.__BD_TOOLKIT__ = {
        modules: MODULES,
        config: cfg,
        urlsFor: urlsFor,
        show: show,
        hide: () => {
            const el = document.getElementById('bdtk-panel');
            if (el) el.remove();
        },
        launch: launch,
        pin: (ref) => {
            REF = String(ref || 'main');
            cache.clear();
            renderSource();
            log('模块版本已切换为 ' + REF);
        },
        setBase: (url) => {
            customBase = String(url || '');
            cache.clear();
            renderSource();
            log('自定义模块根 URL 已设置');
        },
        clearCache: () => { cache.clear(); log('模块缓存已清除'); }
    };

    show();
    log('工具箱已就绪：选择功能后才加载对应模块。可随时执行 __BD_TOOLKIT__.show() 重新打开面板。');
    if (!canEval) log('当前页面禁止动态执行，请改用「高级 / 离线加载」或直接粘贴模块源码。');
})();
