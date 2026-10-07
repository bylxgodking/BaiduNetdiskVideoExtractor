(async () => {

    // ==========================================
    // 百度网盘：当前文件夹视频时长 → Excel
    // ==========================================

    const PAGE_SIZE = 100;
    const DELAY = 300;

    const videoExts = [
        ".mp4", ".mkv", ".avi", ".mov",
        ".wmv", ".flv", ".m4v", ".ts",
        ".webm", ".mpg", ".mpeg", ".3gp"
    ];

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

})();