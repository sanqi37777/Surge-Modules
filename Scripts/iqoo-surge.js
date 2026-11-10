/*
 * IQOO社区任务 - Surge 适配启动器
 * 参数：thread=true/false, draw=true/false, browse_count=1-26,
 *       comment=true/false（评论任务，默认开；每天发一条“666”评论，
 *       完成每日“发表评论”任务）, capture=true/false（获取Token开关，
 *       只管 http-response 捕获分支；关了就不下载原始脚本、直接结束，
 *       定时任务不受影响；不填默认开）
 */
const SOURCE_URL = "https://gist.githubusercontent.com/Sliverkiss/bfc5527ad3ea8ac7b0820ca442442452/raw/iqoo.js";

function finish(message) {
  if (message) {
    try {
      $notification.post("IQOO社区任务", "脚本加载失败", message);
    } catch (_) {}
    console.log("[IQOO Surge] " + message);
  }
  $done({});
}

function parseArgs(raw) {
  const result = {};
  String(raw || "").split("&").forEach(part => {
    const pos = part.indexOf("=");
    if (pos < 0) return;
    const key = part.slice(0, pos);
    let value = part.slice(pos + 1);
    try {
      value = decodeURIComponent(value);
    } catch (_) {}
    result[key] = value;
  });
  return result;
}

// 参数读取：Loon 3.5.1+ 插件对象形式（$argument 是对象，布尔/数字带类型）
// 与 Surge 字符串形式（"thread=true&draw=false..."）都兼容；
// 开关值宽松判断：true/1/on 都算开，避免字符串比对不上
function toBool(v, def) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const s = String(v == null ? "" : v).toLowerCase().trim();
  if (s === "true" || s === "1" || s === "on" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "off" || s === "no") return false;
  return !!def;
}

function readArgs() {
  const a = (typeof $argument !== "undefined") ? $argument : null;
  if (a && typeof a === "object") {
    return {
      thread: toBool(a.thread, false),
      draw: toBool(a.draw, false),
      comment: toBool(a.comment, true),
      capture: toBool(a.capture, true),
      browse_count: Math.max(1, Math.min(26, parseInt(a.browse_count, 10) || 15))
    };
  }
  const args = parseArgs(typeof a === "string" ? a : "");
  return {
    thread: toBool(args.thread, false),
    draw: toBool(args.draw, false),
    comment: toBool(args.comment, true),
    capture: toBool(args.capture, true),
    browse_count: Math.max(1, Math.min(26, parseInt(args.browse_count || "15", 10) || 15))
  };
}

// 获取Token开关：只在 http-response 捕获分支看；不填默认开
function captureEnabled() {
  return readArgs().capture;
}

if (typeof $request !== "undefined" && $request && $request.headers && !captureEnabled()) {
  console.log("[IQOO Surge] 获取Token开关已关，跳过捕获");
  $done({});
} else $httpClient.get(
  { url: SOURCE_URL, timeout: 30000 },
  (error, response, body) => {
    if (error || !body || (response && response.status >= 400)) {
      finish("无法下载原始脚本，请检查网络或原始 Gist 链接。");
      return;
    }

    const opts = readArgs();
    const thread = opts.thread ? "true" : "false";
    const draw = opts.draw ? "true" : "false";
    const comment = opts.comment ? "true" : "false";
    const count = opts.browse_count;
    console.log(`[IQOO Surge] 参数：发帖=${thread} 抽奖=${draw} 评论=${comment} 浏览=${count}（$argument 是 ${typeof $argument}）`);

    let code = body;
    // 锚点用正则写：只认代码本身，不认空行和缩进——原作者排版一变
    //（比如多加个空行）也不至于把整天的任务都拦下来。2026-11-10 06:20
    // 那次就是点赞那两行中间的空行对不上，触发了下面的保护停了全天任务。
    const replacements = [
      {
        re: /\$\.is_thread = \(\$\.isNode\(\) \? process\.env\['iqoo_thread'\] : \$\.getdata\('iqoo_thread'\)\) \|\| 'false';/,
        after: `$.is_thread = "${thread}"; $.is_draw = "${draw}"; $.is_comment = "${comment}"; $.browse_count = ${count};`
      },
      {
        re: /let threadList = user\.getRandomSubarray\(threadIds, 15\);/,
        after: "let threadList = user.getRandomSubarray(threadIds, $.browse_count || 15);"
      },
      {
        re: /[ \t]*await user\.getDrawCount\(\) == 0\s*\? await user\.luckDraw\(\)\s*: \$\.log\(`\[\$\{user\.userName \|\| user\.index\}\]\[INFO\] 今日免费抽奖次数已用完\\n`\);/,
        after: `if ($.is_draw === "true") {
                    await user.getDrawCount() == 0
                        ? await user.luckDraw()
                        : $.log(\`[\${user.userName || user.index}][INFO] 今日免费抽奖次数已用完\\n\`);
                } else {
                    $.log(\`[\${user.userName || user.index}][INFO] 抽奖已关闭，跳过任务\\n\`);
                }`
      },
      {
        re: /const \[title, content\] = await this\.getContent\(\);/,
        after: `const content = await this.getContent();
            const title = (content || "每日分享").slice(0, 20);`
      },
      {
        // 发表评论：原脚本没有评论功能，在这里补一个方法
        re: /\/\/ 随机选取子数组/,
        after: `    //发表评论任务（每天发一条“666”评论，完成每日“发表评论”任务）
    async doCommentTask(threadId) {
        try {
            const opts = {
                url: "/api/v3/posts.create",
                type: "post",
                dataType: "json",
                body: { id: threadId, type: 0, content: "666", source: "", attachments: [] }
            };
            let res = await this.fetch(opts);
            $.log("[" + (this.userName || this.index) + "][INFO] " + ((res && res.Meta && res.Meta.tips && res.Meta.tips[0] && res.Meta.tips[0].message) || (res && res.Message) || "发表评论任务已完成") + "\\n");
            return res;
        } catch (e) {
            this.ckStatus = false;
            $.log("[" + (this.userName || this.index) + "][ERROR] " + e + "\\n");
        }
    }

    // 随机选取子数组`
      },
      {
        // 每个号每天只评一次（第一个帖子），不要 15 个帖子都评
        re: /[ \t]*await user\.doLikeTask\(1\);\s*await user\.doLikeTask\(0\);/,
        after: `                    await user.doLikeTask(1);

                    await user.doLikeTask(0);

                    if ($.is_comment !== "false" && !user.commented) {
                        await user.doCommentTask(threadId);
                        user.commented = true;
                    }`
      }
    ];

    for (const { re, after } of replacements) {
      if (!re.test(code)) {
        finish("原始脚本与适配补丁不匹配，已停止执行。");
        return;
      }
      code = code.replace(re, after);
    }

    try {
      eval(code);
    } catch (e) {
      finish("执行出错：" + (e && e.message ? e.message : String(e)));
    }
  }
);
