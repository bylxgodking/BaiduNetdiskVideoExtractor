// Agent Skill resource - paste into the pan.baidu.com browser Console; do NOT run with node.
// Original project: BaiduNetdiskVideoExtractor. Usage: see SKILL.md.
(async () => {

    // ============================================================
    // 配置
    // ============================================================

    // 【必填】全部 PASTE_ 占位值都要在本机浏览器 Console 中替换：
    //   gid / msg_id / from_uk / root_fs_id 来自群「文件库」页面请求或本 Skill 的诊断数据；
    //   bdstoken / logId / dp_logid 来自 Network 中一次成功的请求，切勿外发或提交公开仓库。
    const CONFIG = {

        // 群文件
        from_uk: 'PASTE_FROM_UK',
        msg_id: 'PASTE_MSG_ID',
        gid: 'PASTE_GID',
        root_fs_id: 'PASTE_ROOT_FS_ID',

        // 目标目录（自己网盘中的绝对路径）
        target_root: '/PASTE_TARGET_DIR',

        // 创建文件夹接口鉴权
        create_bdstoken: 'PASTE_CREATE_BDSTOKEN',
        create_dp_logid: 'PASTE_CREATE_DP_LOGID',

        // 转存接口鉴权
        transfer_bdstoken: 'PASTE_TRANSFER_BDSTOKEN',
        transfer_logId: 'PASTE_TRANSFER_LOGID',
        transfer_dp_logid: 'PASTE_TRANSFER_DP_LOGID',

        // 每次最多转 500 个文件
        batch_size: 500,

        // 请求间隔
        delay: 500,

        // 失败重试
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

})();