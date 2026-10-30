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
 *     捕获行为由模块参数 capture_mode 控制：notify（默认，保存且变化时通知）、
 *     silent（只保存不通知）、off（不捕获）。
 *  2. 定时模式（每天 09:00）：用存好的头重放一次 clock，再只读调一次
 *     getClockPrizeDetail 核对今日条目状态，通知报告结果。
 *     2026-10-23 起通知增加三项数字（从 dayRightList 汇总）：今日领取金币、
 *     累计签到天数、累计领取金币总数。
 *  3. 补签模式（每天 09:30，cron 行 argument=backup）：先只读调一次
 *     getClockPrizeDetail，今日已签到（status=2）则静默跳过；未签才补一次
 *     clock，补签成功/失败都通知。09:00 主跑某天一旦失手（如网络抖动），
 *     补签兜底，不再丢一整天。
 *
 * 隐私：登录态只存手机本地，通知只报返回码/状态，绝不打印 Cookie/token 值。
 */

var STORE_KEY = "fengniao_pizza_headers_v1"; // 与探针相同，沿用其捕获结果
var API_BASE = "https://httpizza.ele.me/xtop/xtop.knight.task.mng.growth.knightAppClock.";
var SCRIPT_VERSION = "20251030-capturemode"; // 2026-10-30 加：模块参数 capture_mode（notify/silent/off），控制捕获通知
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

// 模块参数 capture_mode（捕获行 argument=capture_mode=xxx；不传则默认 notify）：
//   notify：现行行为，保存且变化时通知；silent：只保存不通知；off：不捕获
function getCaptureMode() {
  try {
    var a = (typeof $argument !== "undefined" && $argument) ? String($argument) : "";
    var m = a.match(/capture_mode=(notify|silent|off)/);
    return m ? m[1] : "notify";
  } catch (e) { return "notify"; }
}

// ---------------- 捕获模式（与探针一致） ----------------
function runCapture() {
  var mode = getCaptureMode();
  if (mode === "off") { $done({}); return; }
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
    // notify（默认）：只在登录态首次保存或发生变化时通知一次；
    // silent：只保存不通知；off：上面已直接返回，不捕获
    if (oldVal !== newVal && mode !== "silent") {
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

// 从 getClockPrizeDetail 的 dayRightList 汇总三项数字（2026-10-23 三七要求通知里每天显示）：
//  累计签到天数 = status=2（已领取）的条目数
//  累计领取金币 = 已领取条目的 prizeGrantNum 之和（prizeGrantNum 缺失时用 prizeContent）
//  今日领取金币 = 今日条目已领取时的 prizeGrantNum
// 同时把 data 层除 dayRightList 外的原始字段打进日志：若服务端另有官方累计
// 字段（例如累签奖励不走每日列表），核对后可改用官方字段覆盖汇总值。
function summarizeDetail(parsed) {
  var out = { days: null, total: null, todayGain: null, todayStatus: null };
  try {
    var data = parsed && parsed.result && parsed.result.data;
    if (!data) return out;
    var others = {};
    Object.keys(data).forEach(function (k) {
      if (k !== "dayRightList") others[k] = data[k];
    });
    console.log("[蜂鸟签到] detail 其他字段: " + JSON.stringify(others).slice(0, 600));
    var list = data.dayRightList;
    if (!Array.isArray(list)) return out;
    var today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    var days = 0;
    var total = 0;
    for (var i = 0; i < list.length; i++) {
      var num = parseFloat(list[i].prizeGrantNum !== undefined && list[i].prizeGrantNum !== null
        ? list[i].prizeGrantNum : list[i].prizeContent);
      if (isNaN(num)) num = 0;
      if (list[i].status === 2) {
        days++;
        total += num;
      }
      if (list[i].time === today0.getTime()) {
        out.todayStatus = list[i].status;
        if (list[i].status === 2) out.todayGain = num;
      }
    }
    out.days = days;
    out.total = total;
    return out;
  } catch (e) {
    return out;
  }
}

// 三行通知文案（2026-10-23 要求每天显示的三项数字）；取不到时退回旧版状态文案
function buildStatText(sum) {
  if (sum && sum.days !== null) {
    var gainText = sum.todayGain !== null ? "+" + sum.todayGain : "待确认（今日 status=" + sum.todayStatus + "）";
    return "今日领取：" + gainText + " 金币\n" +
      "签到天数：累计 " + sum.days + " 天\n" +
      "金币总数：累计领取 " + sum.total + " 金币";
  }
  return sum && sum.todayStatus !== null
    ? "详情核对：今日 status=" + sum.todayStatus
    : "详情未取到今日状态";
}

function runCheckin() {
  console.log("[蜂鸟签到] 版本 " + SCRIPT_VERSION + "，主跑");
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
      var sum = detail.parsed ? summarizeDetail(detail.parsed) : null;
      console.log("[蜂鸟签到] 汇总: " + JSON.stringify(sum));
      // 三七 2026-10-23 要求每天显示的三项数字；取不到时退回旧版状态文案
      var statText = buildStatText(sum);
      if (clock.code === 200) {
        notify("签到成功 ✅", statText);
      } else if (clock.code === 5004) {
        notify("今日已签到 ✅", statText);
      } else {
        notify("签到未被接受", "clock：HTTP " + clock.status + "，code=" + clock.code +
          "，" + (clock.msg || clock.raw.slice(0, 160)) + "。" + statText +
          "。把这条通知发我，我换 body 格式再试。");
      }
      $done();
    });
  });
}

// cron 行的 argument：主跑不带 argument；补签行带 argument=backup
function getRunMode() {
  try {
    var a = (typeof $argument !== "undefined" && $argument) ? String($argument) : "";
    return a.trim();
  } catch (e) { return ""; }
}

// ---------------- 补签模式（09:30，cron argument=backup） ----------------
// 先只读查今日状态：已签到则静默跳过；未签才补一次 clock；补签结果通知。
function runBackupCheck() {
  console.log("[蜂鸟签到] 版本 " + SCRIPT_VERSION + "，补签检查");
  var raw = $persistentStore.read(STORE_KEY);
  if (!raw) { console.log("[蜂鸟签到] 补签：无登录态，跳过"); return $done(); }
  var saved;
  try { saved = JSON.parse(raw); } catch (e) { saved = null; }
  if (!saved || (!saved["Cookie"] && !saved["X-TOKEN"])) {
    console.log("[蜂鸟签到] 补签：登录态不完整，跳过");
    return $done();
  }
  var headers = buildHeaders(saved);
  var body = JSON.stringify({ params: { request: { resource: "manual" } } });
  postXtop("getClockPrizeDetail", headers, body).then(function (detail) {
    console.log("[蜂鸟签到] 补签 detail: " + JSON.stringify(detail).slice(0, 800));
    var sum = detail.parsed ? summarizeDetail(detail.parsed) : null;
    console.log("[蜂鸟签到] 补签汇总: " + JSON.stringify(sum));
    if (sum && sum.todayStatus === 2) {
      console.log("[蜂鸟签到] 补签：今日已签到，静默跳过");
      return $done();
    }
    if (detail.error) {
      notify("补签查询出错", String(detail.error) + "。明早 09:00 会自动再试。");
      return $done();
    }
    postXtop("clock", headers, body).then(function (clock) {
      console.log("[蜂鸟签到] 补签 clock: " + JSON.stringify(clock).slice(0, 800));
      if (clock.error) {
        notify("补签请求出错", String(clock.error));
        return $done();
      }
      postXtop("getClockPrizeDetail", headers, body).then(function (detail2) {
        console.log("[蜂鸟签到] 补签 detail2: " + JSON.stringify(detail2).slice(0, 800));
        var sum2 = detail2.parsed ? summarizeDetail(detail2.parsed) : null;
        var statText = buildStatText(sum2);
        if (clock.code === 200) {
          notify("补签成功 ✅", statText);
        } else if (clock.code === 5004) {
          notify("今日已签到 ✅", statText);
        } else {
          notify("补签未被接受", "clock：HTTP " + clock.status + "，code=" + clock.code +
            "，" + (clock.msg || clock.raw.slice(0, 160)) + "。" + statText);
        }
        $done();
      });
    });
  });
}

if (isCaptureMode()) runCapture(); else if (getRunMode() === "backup") runBackupCheck(); else runCheckin();
