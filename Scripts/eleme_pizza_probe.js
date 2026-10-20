/**
 * 蜂鸟众包 xtop 重放探针 — 设备端验证脚本（Surge）
 *
 * 背景（2026-10-19 两份 HAR 的结论）：
 *  - 签到 clock / 详情 getClockPrizeDetail 的原始请求经 H5 原生桥（sendPizza）
 *    发出，两次 QX 抓包都没出现在网络层，只有 ARMS 上报能看到 URL、参数和返回码。
 *  - 同域名 httpizza 的原生 pizza 请求（lpd_knight.*）能抓到，且请求头里
 *    没有 x-sign / x-mini-wua / x-sgext 等签名头，只有 Cookie、X-TOKEN、
 *    HTTP-ACCESS-TOKEN、x-utdid、X-Shard 等登录态/设备头。
 *  - 本探针验证：如果 xtop 也是同一套 pizza 客户端，那么把原生请求的登录态头
 *    换到 xtop 的 POST 上，应当能得到结构化返回（code 200 或 5004），
 *    重放路线就成立；若返回网关级报错，则是 body 信封格式不对，需要换格式再试。
 *
 * 隐私：捕获到的头只存手机本地 $persistentStore，通知里只报“有/无”，
 * 绝不打印任何 Cookie / token 的值，也不往任何服务器发送（除目标接口本身）。
 *
 * 两种模式（同一个文件）：
 *  1. 捕获模式（$request 存在）：由 http-request 规则在 App 发出原生 pizza
 *     请求时触发，把白名单请求头存到本地。
 *  2. 探针模式（cron 手动运行）：先用存好的头只读调用 getClockPrizeDetail
 *     （幂等、无副作用），再调用 clock，把两个返回码原文写进通知。
 */

var STORE_KEY = "fengniao_pizza_headers_v1";
var API_BASE = "https://httpizza.ele.me/xtop/xtop.knight.task.mng.growth.knightAppClock.";
// 只保存这些头（原生 pizza 请求上出现过的登录态/设备头）
var KEEP_HEADERS = [
  "Cookie", "X-TOKEN", "HTTP-ACCESS-TOKEN", "HTTP-REQUEST-AUTH",
  "HTTP-DEVICE-ID", "HTTP-DEVICE-TYPE", "HTTP-APP-TYPE", "HTTP-APP-VERSION",
  "HTTP-REQUEST-TYPE", "x-utdid", "x-umt", "X-Shard", "knight_city_id",
  "User-Agent", "Accept-Language", "Accept"
];

function notify(subtitle, body) {
  $notification.post("蜂鸟探针", subtitle, body);
}

function isCaptureMode() {
  return typeof $request !== "undefined" && $request;
}

// ---------------- 捕获模式 ----------------
function runCapture() {
  var src = $request.headers || {};
  var saved = {};
  var present = [];
  KEEP_HEADERS.forEach(function (name) {
    // Surge 的头名大小写不稳定，逐个不区分大小写查找
    var keys = Object.keys(src);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name.toLowerCase() && src[keys[i]]) {
        saved[name] = src[keys[i]];
        present.push(name);
        break;
      }
    }
  });
  if (saved["Cookie"] || saved["X-TOKEN"]) {
    $persistentStore.write(JSON.stringify(saved), STORE_KEY);
    console.log("[pizza探针] 已保存登录态头：" + present.join(", "));
  } else {
    console.log("[pizza探针] 本次请求没有 Cookie/X-TOKEN，未保存");
  }
  $done({});
}

// ---------------- 探针模式 ----------------
function buildHeaders(saved) {
  var h = {};
  Object.keys(saved).forEach(function (k) { h[k] = saved[k]; });
  h["Content-Type"] = "application/json";
  // 请求 ID 带时间戳，每次重放重新生成一个同格式的
  var rid = "";
  var hex = "0123456789ABCDEF";
  for (var i = 0; i < 32; i++) rid += hex[Math.floor(Math.random() * 16)];
  h["X-Eleme-RequestID"] = rid + "|" + Date.now();
  return h;
}

function postXtop(api, headers, body) {
  return new Promise(function (resolve) {
    $httpClient.post(
      { url: API_BASE + api + "/1.0", headers: headers, body: body },
      function (err, resp, data) {
        if (err) return resolve({ api: api, error: String(err) });
        var parsed = null;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({
          api: api,
          status: resp && resp.status,
          code: parsed && (parsed.code !== undefined ? parsed.code
                : (parsed.result && parsed.result.code)),
          msg: parsed && (parsed.msg || (parsed.result && parsed.result.msg) || ""),
          raw: data ? String(data).slice(0, 400) : "",
          parsed: parsed
        });
      }
    );
  });
}

function todayStatus(parsed) {
  try {
    var list = parsed.result.data.dayRightList;
    var today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    for (var i = 0; i < list.length; i++) {
      if (list[i].time === today0.getTime()) return "今日 status=" + list[i].status;
    }
    return "列表里没找到今日条目（共 " + list.length + " 条）";
  } catch (e) {
    return "详情结构与预期不同，看日志原文";
  }
}

function runProbe() {
  var raw = $persistentStore.read(STORE_KEY);
  if (!raw) {
    notify("还没有登录态", "先正常打开一次蜂鸟众包 App（让捕获规则存到原生请求头），再运行本探针。");
    return $done();
  }
  var saved;
  try { saved = JSON.parse(raw); } catch (e) { saved = null; }
  if (!saved || (!saved["Cookie"] && !saved["X-TOKEN"])) {
    notify("登录态不完整", "存到的头里没有 Cookie/X-TOKEN，请重新打开一次 App 再试。");
    return $done();
  }
  var headers = buildHeaders(saved);
  // JS 层参数（来自 ARMS 上报 p7，两次抓包一致）
  var body = JSON.stringify({ params: { request: { resource: "manual" } } });

  // 先只读探针（详情，幂等），再打 clock
  postXtop("getClockPrizeDetail", headers, body).then(function (detail) {
    console.log("[pizza探针] detail: " + JSON.stringify(detail).slice(0, 800));
    return postXtop("clock", headers, body).then(function (clock) {
      console.log("[pizza探针] clock: " + JSON.stringify(clock).slice(0, 800));
      var lines = [];
      if (detail.error) lines.push("详情请求出错：" + detail.error);
      else {
        lines.push("详情：HTTP " + detail.status + "，code=" + detail.code +
          (detail.parsed ? "，" + todayStatus(detail.parsed) : "，原文：" + detail.raw.slice(0, 120)));
      }
      if (clock.error) lines.push("clock 出错：" + clock.error);
      else lines.push("clock：HTTP " + clock.status + "，code=" + clock.code + "，" + (clock.msg || clock.raw.slice(0, 120)));
      var verdict =
        clock.code === 5004 || clock.code === 200
          ? "判定：网关接受了重放（无签名路线成立）"
          : "判定：未被接受，把上面原文发我，我换 body 格式再试";
      notify("探针结果", lines.join("\n") + "\n" + verdict);
      $done();
    });
  });
}

if (isCaptureMode()) runCapture(); else runProbe();
