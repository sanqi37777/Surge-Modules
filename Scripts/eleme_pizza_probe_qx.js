/**
 * 蜂鸟众包 xtop 重放探针 — Quantumult X 版
 * 捕获模式（script-request-header 触发）：把原生 pizza 请求的登录态头存到
 * $prefs（只存本机），立即放行原请求。
 * 探针模式（task 手动运行）：先只读调 getClockPrizeDetail，再重放 clock，
 * 通知回报两个返回码。clock 回 200 或 5004 = 无签名重放成立。
 * 凭证只在本机 $prefs 里流转，通知只报返回码，不含任何 token 值。
 */
var STORE_KEY = "fengniao_pizza_headers_v1";
var API_BASE = "https://httpizza.ele.me/xtop/xtop.knight.task.mng.growth.knightAppClock.";
var KEEP = ["Cookie","X-TOKEN","HTTP-ACCESS-TOKEN","HTTP-REQUEST-AUTH","HTTP-DEVICE-ID","HTTP-DEVICE-TYPE","HTTP-APP-TYPE","HTTP-APP-VERSION","HTTP-REQUEST-TYPE","x-utdid","x-umt","X-Shard","knight_city_id","User-Agent","Accept-Language","Accept"];

function pickHeaders(src) {
  var out = {}, present = [];
  var keys = Object.keys(src || {});
  KEEP.forEach(function (name) {
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name.toLowerCase() && src[keys[i]]) {
        out[name] = src[keys[i]]; present.push(name); break;
      }
    }
  });
  return { headers: out, present: present };
}

if (typeof $request !== "undefined" && $request) {
  // ---- 捕获模式 ----
  var got = pickHeaders($request.headers);
  if (got.headers["Cookie"] || got.headers["X-TOKEN"]) {
    $prefs.setValueForKey(JSON.stringify(got.headers), STORE_KEY);
    console.log("[pizza探针QX] 已保存登录态头：" + got.present.join(", "));
  } else {
    console.log("[pizza探针QX] 本次请求无 Cookie/X-TOKEN，未保存");
  }
  $done({});
} else {
  // ---- 探针模式 ----
  var raw = $prefs.valueForKey(STORE_KEY);
  if (!raw) {
    $notify("蜂鸟探针", "还没有登录态", "先在 QX 开着时正常打开一次蜂鸟众包 App，再运行本探针。");
    $done();
  } else {
    var saved = null;
    try { saved = JSON.parse(raw); } catch (e) {}
    if (!saved || (!saved["Cookie"] && !saved["X-TOKEN"])) {
      $notify("蜂鸟探针", "登录态不完整", "请重新打开一次 App 再试。");
      $done();
    } else {
      var headers = {};
      Object.keys(saved).forEach(function (k) { headers[k] = saved[k]; });
      headers["Content-Type"] = "application/json";
      var rid = "", hex = "0123456789ABCDEF";
      for (var i = 0; i < 32; i++) rid += hex[Math.floor(Math.random() * 16)];
      headers["X-Eleme-RequestID"] = rid + "|" + Date.now();
      var body = JSON.stringify({ params: { request: { resource: "manual" } } });

      function post(api) {
        return $task.fetch({ url: API_BASE + api + "/1.0", method: "POST", headers: headers, body: body }).then(function (resp) {
          var parsed = null;
          try { parsed = JSON.parse(resp.body); } catch (e) {}
          return { api: api, status: resp.statusCode,
            code: parsed && (parsed.code !== undefined ? parsed.code : (parsed.result && parsed.result.code)),
            msg: (parsed && (parsed.msg || (parsed.result && parsed.result.msg))) || "",
            raw: String(resp.body || "").slice(0, 300), parsed: parsed };
        }, function (err) {
          return { api: api, error: (err && err.error) || String(err) };
        });
      }
      function todayStatus(parsed) {
        try {
          var list = parsed.result.data.dayRightList;
          var t0 = new Date(); t0.setHours(0, 0, 0, 0);
          for (var i = 0; i < list.length; i++) if (list[i].time === t0.getTime()) return "今日 status=" + list[i].status;
          return "列表无今日条目";
        } catch (e) { return "详情结构不同，看日志"; }
      }
      post("getClockPrizeDetail").then(function (detail) {
        console.log("[pizza探针QX] detail: " + JSON.stringify(detail).slice(0, 600));
        return post("clock").then(function (clock) {
          console.log("[pizza探针QX] clock: " + JSON.stringify(clock).slice(0, 600));
          var lines = [];
          lines.push(detail.error ? ("详情出错：" + detail.error)
            : ("详情：HTTP " + detail.status + "，code=" + detail.code + (detail.parsed ? "，" + todayStatus(detail.parsed) : "，原文：" + detail.raw.slice(0, 100))));
          lines.push(clock.error ? ("clock 出错：" + clock.error)
            : ("clock：HTTP " + clock.status + "，code=" + clock.code + "，" + (clock.msg || clock.raw.slice(0, 100))));
          lines.push((clock.code === 5004 || clock.code === 200) ? "判定：网关接受了重放（无签名路线成立）" : "判定：未被接受，把原文发我换格式再试");
          $notify("蜂鸟探针结果", "", lines.join("\n"));
          $done();
        });
      });
    }
  }
}
