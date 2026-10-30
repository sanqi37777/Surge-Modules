/**
 * 中国移动 App 每日自动签到 — Surge 版
 *
 * 由 yupaiLy/cmcc-auto-checkin 的 cmcc_sign.py（614 行）移植签到主链：
 *  1. GET  /qwhdsso/login?dlwmh=true&actUrl=<活动页>  取 loginPath（一次性 sid）
 *  2. POST login_url {provinceCode, cityCode, userCheckId=手机号十六进制,
 *     carrierOperator, appVersionCode, took, jwtToken|token}
 *     → data.jwt 存缓存（30 天内优先用 jwt 续期，失效回落 app_token）
 *     → data.url 为带 token 的活动页（后续接口的 referer）
 *  3. GET data.url 取 Set-Cookie *SESSION_TOKEN（QWHD_SESSION_TOKEN）
 *  4. POST /qwhdhub/api/mark/mark31/markstatus  查今日是否已签
 *     （markstatus[].date==今天 && status=="1" 即已签）
 *  5. 未签则 POST /qwhdhub/api/mark/mark31/domark {date: YYYYMMDD}，
 *     奖品在 data.markPrize（FLOW→MB，其余→元）
 *  6. POST /qwhdhub/api/mark/mark31/taskAward/<id>  领累计/连签奖励
 *     （data.prizeName/prizeValue/prizeCategory，FLOW→MB、FEE→元）
 *
 * 凭证（只存手机本地）：
 *  - 手机号：模块参数 cmcc_phone（必填，11 位）
 *  - app_token / provinceCode / cityCode：捕获脚本从 App 的 appTokenLogin
 *    请求体自动存（键 cmcc_cred_v1）；首次使用前需在 Surge 开着时进一次
 *    中国移动 App → 我的 → 签到领流量
 *  - jwt：自动缓存（键 cmcc_jwt_v1），30 天内优先续期
 *
 * 已知风险（移植时原样保留，须在三七手机上实测）：
 *  - 原版 Python 用了老式 TLS 套件（ECDHE-RSA-AES128-SHA）才能握手 wx.10086.cn；
 *    Surge 走 iOS 网络栈，能否协商到该套件未知，握手失败会在通知里报。
 *  - 捕获需 MitM wx.10086.cn（须信任 Surge CA；若 App 有证书锁定则捕获不到，
 *    届时改模块参数手动填凭证）。
 *  - 原仓库已被作者归档（只读），活动 ID / 接口若变更无人跟进，届时以实测为准。
 */

var CRED_KEY = "cmcc_cred_v1"; // {app_token, province_code, city_code}
var JWT_KEY = "cmcc_jwt_v1"; // {jwt, phone, first_seen, saved_at}
var BASE = "https://wx.10086.cn";
var ACTIVITY_ID = "1021122301";
var CHANNEL_ID = "P00000109876";
var SCRIPT_VERSION = "20251030-v1";
var UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/wkwebview leadeon/12.5.2/CMCCIT";

function notify(subtitle, body) {
  $notification.post("移动签到", subtitle, body);
}

function log(msg) {
  console.log("[移动签到] " + msg);
}

function isCaptureMode() {
  return typeof $request !== "undefined" && $request;
}

// 从 $argument 取 key=value（cron 行 argument=phone=...，捕获行 argument=capture_mode=...）
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

// ---------------- 捕获模式：存 App 的 appTokenLogin 票据 ----------------
function runCapture() {
  var mode = getCaptureMode();
  if (mode === "off") { $done({}); return; }
  var body = ($request && $request.body) || "";
  var token = "", prov = "", city = "";
  var j = parseJson(body);
  if (j) {
    token = j.token || j.app_token || "";
    prov = j.provinceCode || "";
    city = j.cityCode || "";
  }
  if (!token && body) {
    // 表单编码体兜底
    var m = body.match(/(?:^|&)token=([^&]+)/);
    if (m) token = decodeURIComponent(m[1]);
    var mp = body.match(/provinceCode=([^&]+)/);
    if (mp) prov = decodeURIComponent(mp[1]);
    var mc = body.match(/cityCode=([^&]+)/);
    if (mc) city = decodeURIComponent(mc[1]);
  }
  if (token) {
    // 省市编码缺失时沿用旧值，避免一次不全的捕获把好的省市码冲掉
    var old = parseJson($persistentStore.read(CRED_KEY) || "") || {};
    if (!prov) prov = old.province_code || "";
    if (!city) city = old.city_code || "";
    var newVal = JSON.stringify({ app_token: token, province_code: prov, city_code: city });
    var oldVal = $persistentStore.read(CRED_KEY);
    $persistentStore.write(newVal, CRED_KEY);
    log("移动登录态已刷新");
    if (oldVal !== newVal && mode !== "silent") {
      notify("获取登录态成功 ✅", "中国移动登录态已保存，每日签到将使用最新登录态。");
    }
  }
  $done({});
}

// ---------------- HTTP 工具 ----------------
function httpGet(url, headers) {
  return new Promise(function (resolve) {
    $httpClient.get({ url: url, headers: headers || {} }, function (err, resp, data) {
      if (err) return resolve({ error: String(err) });
      resolve({ status: resp && resp.status, headers: (resp && resp.headers) || {}, body: data || "" });
    });
  });
}

function httpPost(url, headers, bodyObj) {
  return new Promise(function (resolve) {
    $httpClient.post({ url: url, headers: headers || {}, body: JSON.stringify(bodyObj) }, function (err, resp, data) {
      if (err) return resolve({ error: String(err) });
      resolve({ status: resp && resp.status, headers: (resp && resp.headers) || {}, body: data || "" });
    });
  });
}

// 从响应头取 *SESSION_TOKEN（qwhdhub → QWHD_SESSION_TOKEN）
function extractSessionCookie(headers) {
  var vals = [];
  Object.keys(headers).forEach(function (k) {
    if (k.toLowerCase() === "set-cookie") {
      var v = headers[k];
      if (Array.isArray(v)) vals = vals.concat(v); else vals.push(v);
    }
  });
  var m = vals.join("\n").match(/([A-Za-z0-9_-]*SESSION_TOKEN)=([^;,\s]+)/);
  return m ? m[1] + "=" + m[2] : "";
}

function baseHeaders(referer) {
  return {
    "accept": "*/*",
    "content-type": "application/json;charset=UTF-8",
    "origin": BASE,
    "referer": referer,
    "login-check": "1",
    "x-requested-with": "XMLHttpRequest",
    "user-agent": UA,
    "accept-language": "zh-CN,zh-Hans;q=0.9"
  };
}

function todayStr() {
  var d = new Date();
  var m = d.getMonth() + 1, day = d.getDate();
  return "" + d.getFullYear() + (m < 10 ? "0" + m : m) + (day < 10 ? "0" + day : day);
}

function readJwt(phone) {
  var raw = $persistentStore.read(JWT_KEY);
  if (!raw) return null;
  try {
    var j = JSON.parse(raw);
    if (j.phone !== phone) return null;
    if (Date.now() / 1000 - (j.saved_at || 0) > 30 * 86400) return null;
    return j.jwt || null;
  } catch (e) { return null; }
}

function saveJwt(phone, jwt, oldFirstSeen) {
  if (!jwt) return;
  $persistentStore.write(JSON.stringify({
    jwt: jwt, phone: phone,
    first_seen: oldFirstSeen || Date.now() / 1000,
    saved_at: Date.now() / 1000
  }), JWT_KEY);
}

// 换取活动会话：返回 {referer, cookie}
function exchangeSession(phone, cred, forceAppToken) {
  var actUrl = BASE + "/qwhdhub/qwhdmark/" + ACTIVITY_ID + "?channelId=" + CHANNEL_ID;
  var uaHeaders = { "user-agent": UA, "accept-language": "zh-CN,zh-Hans;q=0.9" };
  return httpGet(BASE + "/qwhdsso/login?dlwmh=true&actUrl=" + encodeURIComponent(actUrl), uaHeaders).then(function (r) {
    if (r.error) throw new Error("登录页请求失败: " + r.error);
    var m = r.body.match(/loginPath\s*=\s*'([^']+)'/);
    if (!m) throw new Error("登录页未返回 sid，SSO 入口可能已变更");
    var loginUrl = BASE + "/qwhdsso" + m[1];
    var baseBody = {
      provinceCode: cred.province_code, cityCode: cred.city_code,
      userCheckId: parseInt(phone, 10).toString(16),
      carrierOperator: "002", appVersionCode: "12.5.2",
      took: 120 + Math.floor(Math.random() * 781)
    };
    var jwt = forceAppToken ? null : readJwt(phone);
    var body = {};
    Object.keys(baseBody).forEach(function (k) { body[k] = baseBody[k]; });
    if (jwt) { body.jwtToken = jwt; body.token = ""; }
    else { body.jwtToken = null; body.token = cred.app_token; }
    return httpPost(loginUrl, uaHeaders, body).then(function (r2) {
      if (r2.error) throw new Error("appTokenLogin 请求失败: " + r2.error);
      var resp = parseJson(r2.body);
      if (resp && resp.code === "SUCCESS") return finishLogin(resp, phone);
      if (jwt && !forceAppToken) {
        // jwt 续期失败，回落 app_token 引导
        var body2 = {};
        Object.keys(baseBody).forEach(function (k) { body2[k] = baseBody[k]; });
        body2.jwtToken = null; body2.token = cred.app_token;
        return httpPost(loginUrl, uaHeaders, body2).then(function (r3) {
          if (r3.error) throw new Error("appTokenLogin 请求失败: " + r3.error);
          var resp3 = parseJson(r3.body);
          if (!resp3 || resp3.code !== "SUCCESS") throw new Error("appTokenLogin 失败: " + (resp3 ? (resp3.code + " " + (resp3.msg || "")) : "空响应") + "，请重新进 App 签到页抓一次");
          return finishLogin(resp3, phone);
        });
      }
      throw new Error("appTokenLogin 失败: " + (resp ? (resp.code + " " + (resp.msg || "")) : "空响应") + "，请重新进 App 签到页抓一次");
    });
  });
}

function finishLogin(resp, phone) {
  var data = resp.data || {};
  if (data.jwt) {
    var oldFirstSeen = null;
    try {
      var o = JSON.parse($persistentStore.read(JWT_KEY) || "{}");
      if (o.phone === phone) oldFirstSeen = o.first_seen;
    } catch (e) {}
    saveJwt(phone, data.jwt, oldFirstSeen);
  }
  if (!data.url) throw new Error("登录响应里没有活动页地址");
  return httpGet(data.url, { "user-agent": UA, "accept-language": "zh-CN,zh-Hans;q=0.9" }).then(function (r) {
    if (r.error) throw new Error("活动页请求失败: " + r.error);
    var cookie = extractSessionCookie(r.headers);
    if (!cookie) throw new Error("未取得活动会话令牌（SESSION_TOKEN），会话兑换失败");
    return { referer: data.url, cookie: cookie };
  });
}

// ---------------- 定时签到模式 ----------------
function runCheckin() {
  log("版本 " + SCRIPT_VERSION + "，开始签到");
  var phone = getArgValue("phone");
  if (!phone || !/^1\d{10}$/.test(phone)) {
    notify("请先填手机号", "在模块参数 cmcc_phone 里填 11 位手机号，更新模块后再等自动签到。");
    return $done();
  }
  var cred = parseJson($persistentStore.read(CRED_KEY) || "");
  if (!cred || !cred.app_token) {
    notify("还没有移动登录态", "先在 Surge 开着时打开中国移动 App → 我的 → 签到领流量，进一次签到页让捕获存凭证，明天会自动签到。");
    return $done();
  }
  var today = todayStr();
  var ctx = { referer: "", cookie: "" };

  function apiPost(path, bodyObj) {
    var h = baseHeaders(ctx.referer);
    h["Cookie"] = ctx.cookie;
    return httpPost(BASE + path, h, bodyObj);
  }

  function getStatus(forceAppToken) {
    return exchangeSession(phone, cred, forceAppToken).then(function (s) {
      ctx.referer = s.referer; ctx.cookie = s.cookie;
      return apiPost("/qwhdhub/api/mark/mark31/markstatus", {});
    }).then(function (r) {
      if (r.error) throw new Error("markstatus 请求失败: " + r.error);
      var resp = parseJson(r.body);
      if (!resp || resp.code !== "SUCCESS") throw new Error("markstatus 失败: " + (resp ? (resp.code + " " + (resp.msg || "")) : "空响应"));
      return resp.data || {};
    });
  }

  // 会话异常时重建一次再试（与原版 run() 的两次 attempt 对齐）
  getStatus(false).catch(function () { return getStatus(true); }).then(function (statusData) {
    var userinfo = statusData.userinfo || {};
    var acc = userinfo.accumulateTimes != null ? userinfo.accumulateTimes : "?";
    var signed = false;
    (statusData.markstatus || []).forEach(function (d) {
      if (d.date === today && d.status === "1") signed = true;
    });
    var signLines = [];
    var chain = Promise.resolve();
    if (signed) {
      signLines.push("今日已签到，无需操作");
    } else {
      chain = chain.then(function () {
        return apiPost("/qwhdhub/api/mark/mark31/domark", { date: today });
      }).then(function (r) {
        if (r.error) throw new Error("domark 请求失败: " + r.error);
        var res = parseJson(r.body) || {};
        var code = res.code, status = res.status || "", msg = res.msg || "";
        if (code === "SUCCESS" || msg.indexOf("已签") >= 0 || status === "HAVE_MARKED") {
          if (status === "HAVE_MARKED") {
            signLines.push("今日已签到过（服务端幂等）");
          } else {
            signLines.push("签到成功！");
            var prize = (res.data || {}).markPrize;
            if (prize) {
              var pv = prize.prizeValue ? (prize.prizeValue + (prize.prizeCategory === "FLOW" ? "MB" : "元")) : "";
              signLines.push("获得奖品: " + (prize.name || "") + (pv ? " " + pv : ""));
            } else if (status === "PRIZE_NO_CONFIG") {
              signLines.push("今日无单日奖品（累计/连签奖励见下方）");
            }
          }
          // 重新查询拿最新累计天数
          return apiPost("/qwhdhub/api/mark/mark31/markstatus", {}).then(function (r2) {
            var resp2 = parseJson(r2.body);
            if (resp2 && resp2.data && resp2.data.userinfo && resp2.data.userinfo.accumulateTimes != null) {
              acc = resp2.data.userinfo.accumulateTimes;
            }
          }).catch(function () {});
        }
        throw new Error("签到失败: " + code + " / " + status + " / " + msg);
      });
    }
    return chain.then(function () {
      // 领奖：用首次查询的 taskAwardChance（与原版一致，领取后条目即消失、天然幂等）
      var tasks = statusData.taskAwardChance || [];
      var claimLines = [];
      var p = Promise.resolve();
      tasks.forEach(function (t) {
        if (!t.id) return;
        p = p.then(function () {
          return apiPost("/qwhdhub/api/mark/mark31/taskAward/" + t.id, {});
        }).then(function (r) {
          var resp = parseJson(r.body) || {};
          var data = resp.data || {};
          if (data && data.prizeName) {
            var v = data.prizeValue, unit = data.prizeCategory === "FLOW" ? "MB" : (data.prizeCategory === "FEE" ? "元" : "");
            claimLines.push("领到: " + data.prizeName + (v ? "（" + v + unit + "）" : ""));
          } else {
            claimLines.push("任务" + t.id + ": " + (resp.status || resp.code || "?") + " " + (resp.msg || ""));
          }
        }).catch(function (e) {
          claimLines.push("任务" + t.id + " 领取异常: " + (e && e.message || e));
        });
      });
      return p.then(function () {
        var body = "累计签到 " + acc + " 天\n" + signLines.join("\n");
        if (claimLines.length) body += "\n" + claimLines.join("\n");
        notify(signed ? "今日已签到 ✅" : "签到成功 ✅", body);
        $done();
      });
    });
  }).catch(function (e) {
    notify("移动签到失败", String((e && e.message) || e) + "\n手机尾号 " + phone.slice(-4));
    $done();
  });
}

if (isCaptureMode()) runCapture(); else runCheckin();
