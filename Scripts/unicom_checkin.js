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
 *  - 完整 Cookie 直传（20251105-v2 新增，优先）：模块参数 unicom_cookie 里粘贴联通 App 的
 *    完整 Cookie（即小组件用的那条 ECS 会话 Cookie），脚本直接拿它当请求头去签到，
 *    不再拆 token_online；未填或留空时回落到下面的 token_online 路径。
 *    注意：该 Cookie 里没有 token_online，签到接口认不认它须实测（脚本编辑器里手动跑一次即见分晓）。
 *  - token_online：捕获脚本从联通 App 的 onLine.htm 请求体自动存（键 unicom_cred_v1）；
 *    首次使用前需在 Surge 开着时进联通 App 做一次 退出登录 → 切换账号登录
 *  - appId：捕获到就用捕获的，抓不到就按原版 generate_appid 格式本地生成
 *    （原版无 appId 时也是本地生成，纯 token 模式同样可用）
 *
 * 不在 v1 内：天天领现金（立减金）——那路要拿 Ticket + 授权、失败重试 30 次；
 * 权益超市/云盘/阅读/爱听等另有签名与等待逻辑。签到跑通后再挖。
 */

var CRED_KEY = "unicom_cred_v1"; // {token_online, appId}
var COOKIE_KEY = "unicom_cookie_v1"; // 完整 Cookie 直传（备用存储键）
var COOKIE_PLACEHOLDER = "请粘贴联通App的完整Cookie"; // 模块参数未填时的占位，视作未提供
var SCRIPT_VERSION = "20251105-v2";
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

// ---------------- 完整 Cookie 直传：从 $argument 里稳健取整条 Cookie ----------------
// Cookie 里有 ; 与空格，通用 getArgValue 会在空白处截断，故单独取：
// 取 unicom_cookie= 之后全部内容，只在 &后紧跟已知键名时截断；再试着 URL 解码一次
// （Surge 若未编码则原样返回；解码失败也按原值用，Cookie 里的 + 不会被动成空格）。
function getCookieArg() {
  try {
    var a = (typeof $argument !== "undefined" && $argument) ? String($argument) : "";
    var idx = a.indexOf("unicom_cookie=");
    if (idx < 0) return "";
    var v = a.substring(idx + "unicom_cookie=".length);
    var m = v.match(/&(capture_mode|unicom_sign_time)=/);
    if (m) v = v.substring(0, m.index);
    v = v.trim();
    if (!v || v === COOKIE_PLACEHOLDER) return "";
    try { v = decodeURIComponent(v); } catch (e) { /* 不是 URL 编码就按原值用 */ }
    v = v.trim();
    if (!v || v === COOKIE_PLACEHOLDER) return "";
    return v;
  } catch (e) { return ""; }
}

// 完整 Cookie 来源：优先模块参数 unicom_cookie，其次本地存储 unicom_cookie_v1
function getFullCookie() {
  var c = getCookieArg();
  if (c) return c;
  try {
    var s = ($persistentStore.read(COOKIE_KEY) || "").trim();
    if (s && s !== COOKIE_PLACEHOLDER) return s;
  } catch (e) {}
  return "";
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
  var uuid = randomStr(32, "0123456789abcdef");
  var headers = {
    "User-Agent": UA,
    "Connection": "keep-alive"
  };
  // 认证优先级：① 模块参数/本地存储里的完整 Cookie 直传；② 捕获的 token_online 自拼
  var fullCookie = getFullCookie();
  if (fullCookie) {
    log("认证：完整 Cookie 直传");
    headers["Cookie"] = fullCookie;
  } else {
    var cred = parseJson($persistentStore.read(CRED_KEY) || "");
    if (!cred || !cred.token_online) {
      notify("还没有联通登录态", "在模块设置里把联通 App 的完整 Cookie 粘贴到 unicom_cookie 一项（只存你自己手机本地），或在 Surge 开着时打开联通 App → 退出登录 → 切换账号登录一次，让捕获存 token_online。");
      return $done();
    }
    log("认证：token_online 自拼");
    var tokenId = randomStr(32, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");
    var appId = cred.appId || generateAppId();
    headers["Cookie"] = "TOKENID_COOKIE=chinaunicom-" + randomStr(32, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") +
      "; UNICOM_TOKENID=" + tokenId + "; sdkuuid=" + tokenId +
      "; token_online=" + cred.token_online + "; appId=" + appId;
  }
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
