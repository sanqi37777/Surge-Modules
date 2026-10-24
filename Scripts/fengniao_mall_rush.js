/**
 * 蜂鸟众包商城「20 元支付宝话费红包」自动抢购 — 正式版（Surge）
 *
 * 定时：每天 10:00 / 14:00 / 20:00（模块 cron），每月只能抢到 1 次，抢中即停。
 *
 * 两种模式（与签到正式版同一写法）：
 *  1. 捕获模式（$request 存在）：模块的 rewrite 规则拦到 goldmall 请求时，
 *     从表单 body 里把 open_id、mobile 存到手机本地 $persistentStore。
 *     今晚装好模块后进商城点一次兑换（即使售罄也会先调 getAlipayAccount），
 *     手机号就存好了；之后场次无需人工。
 *  2. 定时抢购模式：先用签到共用的 pizza 登录态（键 fengniao_pizza_headers_v1）
 *     重放 xtop queryAuthorize 拿新鲜 open_id（解决有效期问题），失败则回落
 *     到本机存过的 open_id；再轮询库存 → addPurchase → getAlipayAccount 自校验
 *     → createOrder 下单。
 *
 * 已实证（2026-10-24 20:00 场 Surge HAR）：
 *  - 商品：productId=10755、g_id=21005859、goodsId=1005859、gold_price=100
 *  - 开场前 getGoodsInfo：stock=0、is_soldout=0、nextActivityTime=整点——占位，
 *    故轮询（1 秒一次、最多 30 次）直到有库存或 is_soldout=1
 *  - addPurchase {g_id, open_id} → code 200（App 下单前置步骤，照抄流程）
 *  - getAlipayAccount {mobile, customerId="80011381", rtime, goodsId=1005859}
 *    → code 200，account_no_info_list 只有 1 项 {open_id, account_no}；
 *    createOrder 的 alipayOpenID exactly 等于该项 open_id
 *  - createOrder {g_id, account=手机号, alipayOpenID, open_id}（+app_type=h5&version=1）
 *    → 售罄时 HTTP 200 + JSON code 402「数量有限,已被抢光了~」is_soldout=1；
 *    成功回包（receiptNumber/pay_status）沿用 10-22 前端 JS 结论，待真抢中一次再校
 *  - queryAuthorize 信封格式取自同场 ARMS 日志：
 *    POST https://httpizza.ele.me/xtop/xtop.ele.fnmall.knight.queryAuthorize/1.0，
 *    body {"metas":{},"params":{"appId":"7325760174365682074","productId":"10755"}}，
 *    回包 result.data.authorizeId 即 goldmall 的 open_id（与当晚 goldmall 请求的
 *    open_id 全链一致）。重放本身尚未实跑：首跑（明早 10:00 场）若回落到存量
 *    open_id 且下单链路正常，说明信封可用；若 queryAuthorize 与存量双双失效，
 *    通知会报出返回码，再按实测改信封。
 *
 * 安全设计（对应三七实操：App 里两次核对手机号）：
 *  - createOrder 前强制自校验：getAlipayAccount 返回的 account_no（脱敏串）必须
 *    含预存手机号前三位与后四位，对不上立即中止并通知，绝不带着错账号下单
 *  - 当月成功即停：抢中一次后写当月成功标记，同月再跑直接通知退出
 *  - 手机号 / open_id / alipayOpenID / pizza 登录态只存手机本地 $persistentStore，
 *    绝不进聊天、绝不进仓库、通知里不打印明文
 *  - 手机号预存（2026-10-24 补）：非抢购时段商品页按钮是灰的、点不了，
 *    getAlipayAccount 根本不会发，捕获规则触发不了——不要指望场外点兑换来捕获。
 *    改走本机配置：在自己 Surge 配置的 [Script] 里另加一行 generic 指向本脚本、
 *    argument 填手机号，手动跑一次即存入本机（见 runRush 开头的 $argument 处理）。
 *    argument 绝不能写进仓库模块（公开），只写在他自己本机配置里；存好后该行可删，
 *    值已在 $persistentStore 里。
 */

// ---------- 本机预存键（值只在手机上，仓库文件不含任何真实值） ----------
var KEY_OPEN_ID = "fengniao_mall_open_id_v1";      // goldmall open_id（捕获或重放得到）
var KEY_MOBILE = "fengniao_mall_mobile_v1";        // 支付宝手机号（捕获得到）
var KEY_ALIPAY_ID = "fengniao_mall_alipay_id_v1";  // getAlipayAccount 选定后缓存的 alipayOpenID
var KEY_SUCCESS_MONTH = "fengniao_mall_success_month_v1"; // 当月抢中标记 YYYY-MM
var PIZZA_KEY = "fengniao_pizza_headers_v1";       // 与签到正式版共用：pizza 登录态捕获

// ---------- 已知常量 ----------
var GOLDMALL = "https://n.962699.com/goldmall/";
var G_ID = "21005859";
var GOODS_ID = "1005859";
var CUSTOMER_ID = "80011381";
var APP_ID = "7325760174365682074";
var PRODUCT_ID = "10755";
var QUERY_AUTHORIZE_URL = "https://httpizza.ele.me/xtop/xtop.ele.fnmall.knight.queryAuthorize/1.0";

// ---------- 开关 ----------
var ENABLE_CREATE_ORDER = true; // 正式版：实样已核对，开真下单；不想真下单就改回 false

function notify(subtitle, body) {
  $notification.post("蜂鸟商城抢购", subtitle, body);
}

function maskMobile(m) {
  m = String(m || "");
  return m.length === 11 ? m.slice(0, 3) + "****" + m.slice(7) : "(格式不对)";
}

// 脱敏比对：服务端 account_no（脱敏串）里含预存手机号前三位且后四位一致才算对上
function accountMatches(accountStr, mobile) {
  if (!accountStr || !mobile) return false;
  var s = String(accountStr).replace(/\s/g, "");
  return s.indexOf(mobile.slice(0, 3)) >= 0 && s.indexOf(mobile.slice(7)) >= 0;
}

function isCaptureMode() {
  return typeof $request !== "undefined" && $request;
}

// ---------------- 捕获模式：从 goldmall 表单 body 存 open_id / mobile ----------------
function runCapture() {
  var body = "";
  try { body = $request.body || ""; } catch (e) { body = ""; }
  if (typeof body !== "string" || !body) return $done({});
  var params = {};
  body.split("&").forEach(function (pair) {
    var i = pair.indexOf("=");
    if (i > 0) {
      try { params[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1)); }
      catch (e) {}
    }
  });
  var changedMobile = false;
  if (params.open_id) $persistentStore.write(params.open_id, KEY_OPEN_ID);
  if (params.mobile && params.mobile !== $persistentStore.read(KEY_MOBILE)) {
    $persistentStore.write(params.mobile, KEY_MOBILE);
    changedMobile = true;
  }
  if (changedMobile) {
    notify("手机号已捕获 ✅", "商城抢购所需的支付宝手机号已存到本机，之后场次可自动跑。");
  }
  return $done({});
}

// ---------------- goldmall 表单 POST ----------------
function postForm(path, params) {
  var body = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
  }).join("&");
  return new Promise(function (resolve) {
    $httpClient.post(
      {
        url: GOLDMALL + path,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body
      },
      function (err, resp, data) {
        if (err) return resolve({ error: String(err) });
        var parsed = null;
        try { parsed = JSON.parse(data); } catch (e) {}
        resolve({ status: resp && resp.status, parsed: parsed, raw: data ? String(data).slice(0, 400) : "" });
      }
    );
  });
}

// ---------------- xtop 重放：queryAuthorize 拿新鲜 open_id ----------------
function buildXtopHeaders(saved) {
  var h = {};
  Object.keys(saved).forEach(function (k) { h[k] = saved[k]; });
  h["Content-Type"] = "application/json";
  var rid = "";
  var hex = "0123456789ABCDEF";
  for (var i = 0; i < 32; i++) rid += hex[Math.floor(Math.random() * 16)];
  h["X-Eleme-RequestID"] = rid + "|" + Date.now();
  return h;
}

function queryAuthorize() {
  return new Promise(function (resolve) {
    var raw = $persistentStore.read(PIZZA_KEY);
    if (!raw) return resolve(null);
    var saved;
    try { saved = JSON.parse(raw); } catch (e) { return resolve(null); }
    if (!saved || (!saved["Cookie"] && !saved["X-TOKEN"])) return resolve(null);
    var body = JSON.stringify({ metas: {}, params: { appId: APP_ID, productId: PRODUCT_ID } });
    $httpClient.post(
      { url: QUERY_AUTHORIZE_URL, headers: buildXtopHeaders(saved), body: body },
      function (err, resp, data) {
        if (err) return resolve(null);
        try {
          var parsed = JSON.parse(data);
          var d = parsed && parsed.result && parsed.result.data;
          if (d && d.authorizeId) return resolve(d.authorizeId);
        } catch (e) {}
        console.log("[商城抢购] queryAuthorize 未拿到 authorizeId: " + String(data).slice(0, 300));
        return resolve(null);
      }
    );
  });
}

function sleep(ms) {
  return new Promise(function (resolve) {
    if (typeof setTimeout === "function") setTimeout(resolve, ms);
    else resolve();
  });
}

function currentMonth() {
  var d = new Date();
  var m = d.getMonth() + 1;
  return d.getFullYear() + "-" + (m < 10 ? "0" + m : m);
}

// 轮询库存：开场前 stock=0 + is_soldout=0 是占位，不能一次判死
function pollStock(base, triesLeft) {
  return postForm("getGoodsInfo", Object.assign({}, base, { g_id: G_ID })).then(function (info) {
    console.log("[商城抢购] getGoodsInfo: " + JSON.stringify(info).slice(0, 600));
    if (info.error || !info.parsed) return info;
    var d = info.parsed.data || {};
    if (info.parsed.code === 200 && !d.is_soldout && !d.stock && triesLeft > 0) {
      return sleep(1000).then(function () { return pollStock(base, triesLeft - 1); });
    }
    return info;
  });
}

// ---------------- 定时抢购模式 ----------------
function runRush() {
  // 本机预存手机号（一次性 setup）：在自己 Surge 配置 [Script] 里另加一行
  // generic 指向本脚本、argument 填手机号，手动跑一次即存入本机。
  // argument 绝不能写进仓库模块，只写在他自己本机配置里。
  try {
    var arg = (typeof $argument !== "undefined" && $argument) ? String($argument) : "";
    var digits = arg.replace(/\D/g, "");
    if (digits.length === 11 && digits.charAt(0) === "1") {
      $persistentStore.write(digits, KEY_MOBILE);
      notify("手机号已预存 ✅", "已存到本机（" + maskMobile(digits) + "），之后场次自动跑。");
    }
  } catch (e) {}
  // 当月已抢中 → 直接停，不重复下单
  if ($persistentStore.read(KEY_SUCCESS_MONTH) === currentMonth()) {
    notify("本月已抢到", "当月已成功抢到一次，按每月限抢 1 次规则不再下单。");
    return $done();
  }
  // 先重放 queryAuthorize 拿新鲜 open_id，失败回落存量
  queryAuthorize().then(function (freshId) {
    var openId = freshId;
    if (openId) {
      $persistentStore.write(openId, KEY_OPEN_ID);
      console.log("[商城抢购] queryAuthorize 重放成功，open_id 已刷新");
    } else {
      openId = $persistentStore.read(KEY_OPEN_ID);
      console.log("[商城抢购] queryAuthorize 未拿到新 open_id，回落存量");
    }
    if (!openId) {
      notify("还缺 open_id", "先在 Surge 开着时从商城点进一次话费红包商品页完成授权，再等下场自动跑。");
      return $done();
    }
    var mobile = $persistentStore.read(KEY_MOBILE);
    if (!mobile) {
      notify("还缺手机号", "装模块后进商城点一次兑换（即使售罄也会先调 getAlipayAccount），捕获规则会把手机号存到本机，下场就能自动跑。");
      return $done();
    }
    var base = { open_id: openId, app_type: "h5", version: "1" };

    // 1) 轮询查库存
    pollStock(base, 30).then(function (info) {
      if (info.error || !info.parsed) {
        notify("查库存失败", info.error || ("HTTP " + info.status + " " + info.raw.slice(0, 120)));
        return $done();
      }
      var d = info.parsed.data || {};
      if (info.parsed.code !== 200 || d.is_soldout || !d.stock) {
        notify("暂无库存", "stock=" + (d.stock || 0) + "，" + (d.soldout_txt || info.parsed.msg || ""));
        return $done();
      }

      // 2) App 流程：先 addPurchase（只记日志，不以此成败决定是否继续）
      postForm("addPurchase", Object.assign({}, base, { g_id: G_ID })).then(function (ap) {
        console.log("[商城抢购] addPurchase: " + JSON.stringify(ap).slice(0, 300));

        // 3) 账号自校验（脚本版的「两次核对」）
        postForm("getAlipayAccount", {
          mobile: mobile, customerId: CUSTOMER_ID, rtime: String(Date.now()), goodsId: GOODS_ID
        }).then(function (acc) {
          console.log("[商城抢购] getAlipayAccount: " + JSON.stringify(acc).slice(0, 600));
          var list = acc.parsed && acc.parsed.data && acc.parsed.data.account_no_info_list;
          if (!list || !list.length) {
            notify("账号校验中止", "getAlipayAccount 没返回账号列表，不下单。原始：" + (acc.raw || "").slice(0, 120));
            return $done();
          }
          var hit = null;
          for (var i = 0; i < list.length; i++) {
            var s = JSON.stringify(list[i]);
            if (accountMatches(s, mobile)) { hit = list[i]; break; }
          }
          if (!hit) {
            notify("账号校验中止", "返回账号与预存手机号 " + maskMobile(mobile) + " 对不上，不下单。");
            return $done();
          }
          // 已实证：createOrder 的 alipayOpenID 就是该项的 open_id 字段
          var alipayOpenID = hit.open_id || $persistentStore.read(KEY_ALIPAY_ID);
          if (!alipayOpenID) {
            notify("账号对上但缺 alipayOpenID", "getAlipayAccount 没给 open_id，今晚不下单。");
            return $done();
          }

          // 4) 下单
          if (!ENABLE_CREATE_ORDER) {
            notify("演练通过 ✅", "有库存、账号自校验通过（" + maskMobile(mobile) + "）。ENABLE_CREATE_ORDER 未开，未真下单。");
            return $done();
          }
          postForm("createOrder", Object.assign({}, base, {
            g_id: G_ID, account: mobile, alipayOpenID: alipayOpenID
          })).then(function (ord) {
            console.log("[商城抢购] createOrder: " + JSON.stringify(ord).slice(0, 600));
            var od = ord.parsed && ord.parsed.data;
            if (ord.parsed && ord.parsed.code === 200 && od) {
              $persistentStore.write(currentMonth(), KEY_SUCCESS_MONTH);
              notify("抢购成功 🎉", "订单号 " + (od.receiptNumber || "?") + "，pay_status=" + (od.pay_status || "?") + "。本月不再重复下单。");
            } else if (ord.parsed && ord.parsed.code === 402) {
              // 已实证：售罄——HTTP 200 + JSON code 402「数量有限,已被抢光了~」
              notify("已抢光", "createOrder 回 402：已被抢光，下场再试。");
            } else {
              notify("下单未成功", "code=" + (ord.parsed && ord.parsed.code) + "，" + ((ord.parsed && (ord.parsed.message || ord.parsed.msg)) || ord.raw.slice(0, 120)));
            }
            $done();
          });
        });
      });
    });
  });
}

if (isCaptureMode()) runCapture(); else runRush();
