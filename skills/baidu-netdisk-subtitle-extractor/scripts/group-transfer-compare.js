// Agent Skill resource - paste into the pan.baidu.com browser Console; do NOT run with node.
// Original project: BaiduNetdiskVideoExtractor. Usage: see SKILL.md.
(async () => {
  console.clear();

  // =========================================================
  //                     【只改这里】
  // =========================================================

  // 【必填】全部 PASTE_ 占位值都要在本机浏览器 Console 中替换：
  //   gid / msg_id / from_uk / fs_id 来自群「文件库」页面请求或本 Skill 的诊断数据；
  //   bdstoken / logId / dp_logid 来自 Network 中一次成功的请求，切勿外发或提交公开仓库。
  const CONFIG = {

    // =======================================================
    // ① 群文件中「要转存的文件夹」的 fs_id
    // 转存整个群文件库时填根目录 fs_id 并把 source_path 留空。
    // =======================================================

    source_fs_id: 'PASTE_SOURCE_FS_ID',


    // =======================================================
    // ② 群文件夹相对路径
    // 根目录留空；子目录写成 '/计算机网络'。
    // =======================================================

    source_path: '',


    // =======================================================
    // ③ 自己网盘中的目标根目录，例如 '/字幕转存'
    // =======================================================

    target_root: '/PASTE_TARGET_DIR',


    // =======================================================
    // ④ 群参数（换群必须重填）
    // =======================================================

    from_uk: 'PASTE_FROM_UK',
    msg_id: 'PASTE_MSG_ID',
    gid: 'PASTE_GID',


    // =======================================================
    // ⑤ 当前百度页面的鉴权参数
    // =======================================================

    bdstoken: 'PASTE_BDSTOKEN',

    logId: 'PASTE_LOGID',

    dp_logid: 'PASTE_DP_LOGID',


    // =======================================================
    // 以下一般不用改
    // =======================================================

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

})();