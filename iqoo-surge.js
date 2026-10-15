/*
 * IQOO社区任务 - Surge 适配启动器
 * 参数：thread=true/false, draw=true/false, browse_count=1-26
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

$httpClient.get(
  { url: SOURCE_URL, timeout: 30000 },
  (error, response, body) => {
    if (error || !body || (response && response.status >= 400)) {
      finish("无法下载原始脚本，请检查网络或原始 Gist 链接。");
      return;
    }

    const args = parseArgs(
      typeof $argument === "string" ? $argument : ""
    );
    const thread = args.thread === "true" ? "true" : "false";
    const draw = args.draw === "true" ? "true" : "false";
    const count = Math.max(
      1,
      Math.min(26, parseInt(args.browse_count || "15", 10) || 15)
    );

    let code = body;
    const replacements = [
      [
        "$.is_thread = ($.isNode() ? process.env['iqoo_thread'] : $.getdata('iqoo_thread')) || 'false';",
        `$.is_thread = "${thread}"; $.is_draw = "${draw}"; $.browse_count = ${count};`
      ],
      [
        "let threadList = user.getRandomSubarray(threadIds, 15);",
        "let threadList = user.getRandomSubarray(threadIds, $.browse_count || 15);"
      ],
      [
        `await user.getDrawCount() == 0
                    ? await user.luckDraw()
                    : $.log(\`[\${user.userName || user.index}][INFO] 今日免费抽奖次数已用完\\n\`);`,
        `if ($.is_draw === "true") {
                    await user.getDrawCount() == 0
                        ? await user.luckDraw()
                        : $.log(\`[\${user.userName || user.index}][INFO] 今日免费抽奖次数已用完\\n\`);
                } else {
                    $.log(\`[\${user.userName || user.index}][INFO] 抽奖已关闭，跳过任务\\n\`);
                }`
      ],
      [
        "const [title, content] = await this.getContent();",
        `const content = await this.getContent();
            const title = (content || "每日分享").slice(0, 20);`
      ]
    ];

    for (const [before, after] of replacements) {
      if (!code.includes(before)) {
        finish("原始脚本与适配补丁不匹配，已停止执行。");
        return;
      }
      code = code.replace(before, after);
    }

    try {
      eval(code);
    } catch (e) {
      finish("执行出错：" + (e && e.message ? e.message : String(e)));
    }
  }
);
