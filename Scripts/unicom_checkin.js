/**
 * 中国联通 App 首页签到 — Surge 版（最小路线）
 *
 * 由 smallfawn/QLScriptPublic daily/chinaUnicom.py（5823 行）抽出的签到区子集：
 *  GET  activity.10010.com/sixPalaceGridTurntableLottery/signin/getContinuous
 *       ?taskId=&channel=wode&imei=<uuid>
 *       → data.todayIsSignIn: 'y' 已签 / 'n' 未签
 *  POST activity.10010.com/sixPalaceGridTurntableLottery/signin/daySign（空表单体）
 *       → code 0000 成功（data.statusDesc + redSignMessage），
 *         code 0002 且 desc 含 已经签到 视为已签
 *
 * 认证（与原版 request() 对齐，只用 Cookie + UA，不用 RSA）：
 *  - Cookie: TOKENID_COOKIE=chinaunicom-<32 位大写字母数字>；
 *    UNICOM_TOKENID=<32 位随机串>；sdkuuid=<同 UNICOM_TOKENID>；
 *    token_online=<捕获>；appId=<捕获或本地生成>
 *  - UA: Dalvik/2.1.0 (Linux; U; Android 12; Mi 10 Pro MIUI/21.11.3);unicom{version:android@11.0802}
 *  - imei 参数：本地生成的去横线 UUID，与原版 self.uuid 对齐
 *
 * 凭证（只存手机本地）：
 *  - token_online：捕获脚本从联通 App 的 onLine.htm 请求体自动存（键 unicom_cred_v1）；
 *    首次使用前需在 Surge 开着时进联通 App 做一次 退出登录 → 切换账号登录
 *  - appId：捕获到就用捕获的，抓不到就按原版 generate_appid 格式本地生成
 *    （原版无 appId 时也是本地生成，纯 token 模式同样可用）
 *
 * 不在 v1 内：天天领现金（立减金）——那路要拿 Ticket + 授权、失败重试 30 次；
 * 权益超市/云盘/阅读/爱听等另有签名与等待逻辑。签到跑通后再挖。
 */

var CRED_KEY = "unicom_cred_v1"; // {token_online, appId}
var SCRIPT_VERSION = "20251030-v1";
var UA = "Dalvik/2.1.0 (Linux; U; Android 12; Mi 10 Pro MIUI/21.11.3);unicom{version:android@11.0802}";

function notify(subtitle, body) {
  $notification.post("联通签到", subtitle, body);
}

function log(msg) {
  console.log("[联通签到] " + msg);
}

function isCaptureMode() {
  return typeof $request !== "undefined" && $request;
}

function getArgValue(key) {
  try {
    var a = (typeof $argument !== "undefined" && $argument) ? String($argument) : "";
    var m = a.match(new RegExp(key + "=([^&\\s]+)"));
    return m ? decodeURIComponent(m[1]) : "";
  } catch (e) { return ""; }
}

function getCaptureMode() {
  var m = getArgValue("capture_mode");
  return (m === "silent" || m === "off") ? m : "notify";
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

// ---------------- 捕获模式：存 App 的 onLine.htm 登录态 ----------------
function runCapture() {
  var mode = getCaptureMode();
  if (mode === "off") { $done({}); return; }
  var body = ($request && $request.body) || "";
  var token = "", appId = "";
  var j = parseJson(body);
  if (j) {
    token = j.token_online || j.tokenOnline || "";
    appId = j.appId || "";
  }
  if (!token && body) {
    var m = body.match(/(?:^|&)token_online=([^&]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (!appId && body) {
    var ma = body.match(/(?:^|&)appId=([^&]+)/) || body.match(/"appId"\s*:\s*"([^"]+)"/);
    if (ma) appId = decodeURIComponent(ma[1]);
  }
  if (!appId && $request && $request.headers) {
    Object.keys($request.headers).forEach(function (k) {
      if (k.toLowerCase().indexOf("appid") >= 0 && !appId) appId = $request.headers[k];
    });
  }
  if (token) {
    // appId 缺失时沿用旧值（没有也不怕，定时任务会本地生成）
    var old = parseJson($persistentStore.read(CRED_KEY) || "") || {};
    if (!appId) appId = old.appId || "";
    var newVal = JSON.stringify({ token_online: token, appId: appId });
    var oldVal = $persistentStore.read(CRED_KEY);
    $persistentStore.write(newVal, CRED_KEY);
    log("联通登录态已刷新");
    if (oldVal !== newVal && mode !== "silent") {
      notify("获取登录态成功 ✅", "中国联通登录态已保存，首页签到将使用最新登录态。");
    }
  }
  $done({});
}

// ---------------- 随机串工具 ----------------
function randomStr(len, chars) {
  var out = "";
  for (var i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

// 原版 generate_appid 格式：7 位随机数字散落在固定模板里
function generateAppId() {
  function rnd() { return Math.floor(Math.random() * 10); }
  return rnd() + "f" + rnd() + "af" + rnd() + rnd() + "ad" + rnd() +
    "912d306b5053abf90c7ebbb695887bc" +
    "870ae0706d573c348539c26c5c0a878641fcc0d3e90acb9be1e6ef858a" +
    "59af546f3c826988332376b7d18c8ea2398ee3a9c3db947e2471d32a49" +
    rnd() + rnd();
}

// ---------------- HTTP 工具 ----------------
function httpGet(url, headers) {
  return new Promise(function (resolve) {
    $httpClient.get({ url: url, headers: headers || {} }, function (err, resp, data) {
      if (err) return resolve({ error: String(err) });
      resolve({ status: resp && resp.status, body: data || "" });
    });
  });
}

function httpPost(url, headers, body) {
  return new Promise(function (resolve) {
    $httpClient.post({ url: url, headers: headers || {}, body: body }, function (err, resp, data) {
      if (err) return resolve({ error: String(err) });
      resolve({ status: resp && resp.status, body: data || "" });
    });
  });
}

// ---------------- 定时签到模式 ----------------
function runCheckin() {
  log("版本 " + SCRIPT_VERSION + "，开始签到");
  var cred = parseJson($persistentStore.read(CRED_KEY) || "");
  if (!cred || !cred.token_online) {
    notify("还没有联通登录态", "先在 Surge 开着时打开联通 App → 退出登录 → 切换账号登录一次，让捕获存 token_online，明天会自动签到。");
    return $done();
  }
  var uuid = randomStr(32, "0123456789abcdef");
  var tokenId = randomStr(32, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");
  var appId = cred.appId || generateAppId();
  var cookie = "TOKENID_COOKIE=chinaunicom-" + randomStr(32, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") +
    "; UNICOM_TOKENID=" + tokenId + "; sdkuuid=" + tokenId +
    "; token_online=" + cred.token_online + "; appId=" + appId;
  var headers = {
    "User-Agent": UA,
    "Connection": "keep-alive",
    "Cookie": cookie
  };
  var queryUrl = "https://activity.10010.com/sixPalaceGridTurntableLottery/signin/getContinuous?taskId=&channel=wode&imei=" + uuid;
  httpGet(queryUrl, headers).then(function (r) {
    if (r.error) throw new Error("查询签到状态请求失败: " + r.error);
    var resp = parseJson(r.body);
    if (!resp) throw new Error("查询签到状态响应异常（非 JSON），可能是 token 失效或接口变更");
    if (resp.code !== "0000") {
      throw new Error("查询签到状态失败[" + resp.code + "]: " + (resp.desc || "") + "，token_online 可能过期，请重新进联通 App 退出登录 → 切换账号登录一次");
    }
    var todayIsSignIn = (resp.data || {}).todayIsSignIn;
    if (todayIsSignIn === "y") {
      notify("今日已签到 ✅", "联通签到区今天已签到，无需操作。");
      return $done();
    }
    return httpPost(
      "https://activity.10010.com/sixPalaceGridTurntableLottery/signin/daySign",
      Object.assign({}, headers, { "content-type": "application/x-www-form-urlencoded" }),
      ""
    ).then(function (r2) {
      if (r2.error) throw new Error("签到请求失败: " + r2.error);
      var res2 = parseJson(r2.body);
      if (!res2) throw new Error("签到响应异常（非 JSON），可能是 token 失效或接口变更");
      if (res2.code === "0000") {
        var data = res2.data || {};
        notify("签到成功 ✅", "联通签到区签到成功: [" + (data.statusDesc || "") + "]" + (data.redSignMessage || ""));
      } else if (res2.code === "0002" && (res2.desc || "").indexOf("已经签到") >= 0) {
        notify("今日已签到 ✅", "联通签到区签到成功: 今日已完成签到！");
      } else {
        throw new Error("签到失败[" + res2.code + "]: " + (res2.desc || ""));
      }
      $done();
    });
  }).catch(function (e) {
    notify("联通签到失败", String((e && e.message) || e));
    $done();
  });
}

if (isCaptureMode()) runCapture(); else runCheckin();
