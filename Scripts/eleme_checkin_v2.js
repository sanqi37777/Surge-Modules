/**
 * 蜂鸟众包每日自动签到 — 正式版（Surge），由 xtop 重放探针升级而来。
 *
 * 前提（必须先满足，否则不要启用本模块的定时任务）：
 *  探针 eleme_pizza_probe.js 已在设备端跑出判定「网关接受了重放
 *  （无签名路线成立）」，即 clock 返回 code 200 或 5004。
 *  若探针判定未被接受（网关级报错），本脚本用的 body 信封格式同样
 *  不成立，需先换格式在探针里验证通过，再同步改这里的 body。
 *
 * 已钉死的业务逻辑（2026-10-19 两份 HAR + 两次进页截图验证）：
 *  - 进每日奖励页即在服务端登记当日签到，页面不刷新、显示滞后；
 *    第二次进页才显示真实状态（17:05 首次进页显示未签到/18天/495，
 *    二次进页显示已领/19天/510，与验算完全一致）。
 *  - clock 返回 5004「今日已签到」= 今日已登记 = 成功，不是失败。
 *
 * 工作方式（与探针同一个文件结构、同一个存储键，探针存过的登录态可直接沿用）：
 *  1. 捕获模式（$request 存在）：App 发原生 pizza 请求时，把白名单登录态头
 *     存到手机本地 $persistentStore（键 fengniao_pizza_headers_v1），持续保鲜。
 *  2. 定时模式（每天 09:00）：用存好的头重放一次 clock，再只读调一次
 *     getClockPrizeDetail 核对今日条目状态，通知报告结果。
 *
 * 隐私：登录态只存手机本地，通知只报返回码/状态，绝不打印 Cookie/token 值。
 */

var STORE_KEY = "fengniao_pizza_headers_v1"; // 与探针相同，沿用其捕获结果
var API_BASE = "https://httpizza.ele.me/xtop/xtop.knight.task.mng.growth.knightAppClock.";
var KEEP_HEADERS = [
  "Cookie", "X-TOKEN", "HTTP-ACCESS-TOKEN", "HTTP-REQUEST-AUTH",
  "HTTP-DEVICE-ID", "HTTP-DEVICE-TYPE", "HTTP-APP-TYPE", "HTTP-APP-VERSION",
  "HTTP-REQUEST-TYPE", "x-utdid", "x-umt", "X-Shard", "knight_city_id",
  "User-Agent", "Accept-Language", "Accept"
];

function notify(subtitle, body) {
  $notification.post("蜂鸟签到", subtitle, body);
}

function isCaptureMode() {
  return typeof $request !== "undefined" && $request;
}

// ---------------- 捕获模式（与探针一致） ----------------
function runCapture() {
  var src = $request.headers || {};
  var saved = {};
  KEEP_HEADERS.forEach(function (name) {
    var keys = Object.keys(src);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name.toLowerCase() && src[keys[i]]) {
        saved[name] = src[keys[i]];
        break;
      }
    }
  });
  if (saved["Cookie"] || saved["X-TOKEN"]) {
    var newVal = JSON.stringify(saved);
    var oldVal = $persistentStore.read(STORE_KEY);
    $persistentStore.write(newVal, STORE_KEY);
    console.log("[蜂鸟签到] 登录态头已刷新");
    // 只在登录态首次保存或发生变化时通知一次，避免每次打开 App 都弹
    if (oldVal !== newVal) {
      notify("获取登录态成功 ✅", "蜂鸟众包登录态已保存，09:00 自动签到将使用最新登录态。");
    }
  }
  $done({});
}

// ---------------- 定时签到模式 ----------------
function buildHeaders(saved) {
  var h = {};
  Object.keys(saved).forEach(function (k) { h[k] = saved[k]; });
  h["Content-Type"] = "application/json";
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
      if (list[i].time === today0.getTime()) return list[i].status;
    }
    return null;
  } catch (e) {
    return null;
  }
}

function runCheckin() {
  var raw = $persistentStore.read(STORE_KEY);
  if (!raw) {
    notify("还没有登录态", "先在 Surge 开着时正常打开一次蜂鸟众包 App，明天 09:00 会自动重试。");
    return $done();
  }
  var saved;
  try { saved = JSON.parse(raw); } catch (e) { saved = null; }
  if (!saved || (!saved["Cookie"] && !saved["X-TOKEN"])) {
    notify("登录态不完整", "存到的头里没有 Cookie/X-TOKEN，请打开一次 App 让捕获规则刷新后再等明天自动签到。");
    return $done();
  }
  var headers = buildHeaders(saved);
  var body = JSON.stringify({ params: { request: { resource: "manual" } } });

  postXtop("clock", headers, body).then(function (clock) {
    console.log("[蜂鸟签到] clock: " + JSON.stringify(clock).slice(0, 800));
    if (clock.error) {
      notify("签到请求出错", clock.error);
      return $done();
    }
    // 再只读核对一次今日状态，作为落地证据（详情幂等、无副作用）
    postXtop("getClockPrizeDetail", headers, body).then(function (detail) {
      console.log("[蜂鸟签到] detail: " + JSON.stringify(detail).slice(0, 800));
      var st = detail.parsed ? todayStatus(detail.parsed) : null;
      var stText = st === null ? "详情未取到今日状态" : "详情核对：今日 status=" + st;
      if (clock.code === 200) {
        notify("签到成功", "clock code=200。" + stText);
      } else if (clock.code === 5004) {
        notify("今日已签到", "clock code=5004（已登记，按已确认逻辑视为成功）。" + stText);
      } else {
        notify("签到未被接受", "clock：HTTP " + clock.status + "，code=" + clock.code +
          "，" + (clock.msg || clock.raw.slice(0, 160)) + "。" + stText +
          "。把这条通知发我，我换 body 格式再试。");
      }
      $done();
    });
  });
}

if (isCaptureMode()) runCapture(); else runCheckin();
