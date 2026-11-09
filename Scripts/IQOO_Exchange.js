/*
 * IQOO社区定时兑换 v2026-11-09.2
 * 综合：三七 2026-11-09 11:00 抓包（HAR）+ 原作者 xzxxn777 的 IQOO_Exchange.js
 *
 * 抓包核对过的事实（HAR 里 138 条请求）：
 * - 兑换就是 POST https://bbs-api.iqoo.com/api/v3/exchange
 *   body {"userId":5024949,"id":2101010,"addressId":409740,"imei":""}
 *   11:00:00 整点发出，返回 Code 0；随后 /v3/user 的 score 由 26237 变成 11337，
 *   正好扣掉 14900，说明 Code 0 就是兑换成功。
 * - 当天 11:00 上架 5 件：2101008 手柄 24900 / 2101009 耳机 21900 /
 *   2101010 充电宝 14900（库存仅 2，11:00:04 再查已是 0）/
 *   2101011 直饮杯 2000 / 2101012 耳机包 2900。
 * - 签名沿用原作者的办法（HMAC-SHA256，appid=1002），已用抓包逐条验过：
 *   exchange 的 POST 签名能对上；GET 的签名要把参数按 key 排好序再拼，
 *   goods.list / goods.detail / address.list 三条都能对上。
 * - 请求头按抓包改成微信小程序那套（原作者写的是 Mac 版 Chrome，
 *   Referer 还是旧的 /185/，抓包里是 /262/）。
 * - 原作者先拉 goods.list 再拉地址、兑换间隔 10 秒，抢库存 2 件的东西太慢，
 *   这里改成：抢兑模式跳过商品列表，直接兑；地址 ID 填 0 就现取每个号
 *   自己的默认地址；重试默认 5 次、间隔 1.2 秒。
 *
 * 多账号（v2026-11-09.2，和签到插件配套）：
 * - 登录态只抓一次、两边共用。打开 IQOO 社区时，签到脚本把账号存进
 *   iqoos_data（数组，按 userId 去重），兑换脚本把同一份登录态（含
 *   X-Visitor）存进 iqoo_exchange_auth（数组，按 userId 去重）。
 *   两个号各打开一次 App 就都存好了，不用在插件里粘 Token。
 * - 捕获有个开关（插件参数“获取Token开关”，默认开）：开着时打开 App
 *   自动抓；两个号都抓完可以关掉，以后换号或登录态过期了再打开抓一次。
 * - 定时任务跑的时候：先读 iqoo_exchange_auth，再把 iqoos_data 里
 *   有、兑换这边没有的号也并进来（没 X-Visitor 也照样试一次），
 *   两个号按顺序各兑一件，同一件商品、每号各 1 个。
 * - 补跑已删：过了 11:00 那个时间库存就没了，补跑没有意义。
 *   只剩每天 11:00 一班；同一件已兑成功的号会记下来，不重复花钱。
 *
 * 三种用法（同一个脚本）：
 * 1. http-response：打开一次 IQOO 社区 App，自动把登录态存好，
 *    存上/变了才通知一次。
 * 2. cron + 商品ID=0：只列商品和每个号的酷币，不兑换，用来看下一批的 id。
 * 3. cron + 商品ID=目标 id：11:00 直接兑换，两个号各兑一件。
 *
 * 参数都在插件里填（Surge 模块 #!arguments / Loon 插件 [Argument]），
 * 不要改这个脚本。账号不用填，全靠第 1 步抓登录态。
 */

var VERSION = '2026-11-09.2';
var API = 'https://bbs-api.iqoo.com/api';
var SIGN_KEY = '2618194b0ebb620055e19cf9811d3c13'; // 原作者脚本里的签名密钥
var APPID = '1002';
var STORE_AUTH = 'iqoo_exchange_auth'; // 数组 [{userId, token, xVisitor, userName, updatedAt}]
var STORE_SIGNIN = 'iqoos_data'; // 签到脚本的账号数组 [{userId, token, userName}]，只读、用来补账号
var STORE_STATE = 'iqoo_exchange_state'; // {success: {userId: {giftId, at}}}

var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.80(0x18005030) NetType/WIFI Language/zh_CN';
var REFERER = 'https://servicewechat.com/wxcf4266fbc9463132/262/page-frame.html';

var cfg = { accounts: [], giftId: 0, addressId: 0, retry: 5, interval: 1200, userId: '', token: '', xVisitor: '', userName: '' };

/* ---------------- SHA-256 / HMAC-SHA256 / Base64（纯 JS，不依赖 CryptoJS） ---------------- */

var SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

function sha256Bytes(bytes) {
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var padded = bytes.slice();
  var bitLen = bytes.length * 8;
  padded.push(0x80);
  while ((padded.length % 64) !== 56) padded.push(0);
  padded.push(0, 0, 0, 0);
  padded.push((bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255);
  for (var o = 0; o < padded.length; o += 64) {
    var w = new Array(64);
    var t, a, b, c, d, e, f, g, h;
    for (t = 0; t < 16; t++) {
      w[t] = (((padded[o + t * 4] << 24) | (padded[o + t * 4 + 1] << 16) | (padded[o + t * 4 + 2] << 8) | padded[o + t * 4 + 3]) >>> 0);
    }
    for (t = 16; t < 64; t++) {
      var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    a = H[0]; b = H[1]; c = H[2]; d = H[3]; e = H[4]; f = H[5]; g = H[6]; h = H[7];
    for (t = 0; t < 64; t++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) | 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  var out = [];
  for (var i = 0; i < 8; i++) {
    out.push((H[i] >>> 24) & 255, (H[i] >>> 16) & 255, (H[i] >>> 8) & 255, H[i] & 255);
  }
  return out;
}

function utf8Bytes(str) {
  var s = unescape(encodeURIComponent(str));
  var b = [];
  for (var i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 255);
  return b;
}

function hmacSha256(keyStr, msgStr) {
  var k = utf8Bytes(keyStr);
  if (k.length > 64) k = sha256Bytes(k);
  while (k.length < 64) k.push(0);
  var oPad = [], iPad = [];
  for (var i = 0; i < 64; i++) { oPad.push(k[i] ^ 0x5c); iPad.push(k[i] ^ 0x36); }
  return sha256Bytes(oPad.concat(sha256Bytes(iPad.concat(utf8Bytes(msgStr)))));
}

var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytesToBase64(b) {
  var s = '';
  for (var i = 0; i < b.length; i += 3) {
    var n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    s += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63];
    s += (i + 1 < b.length) ? B64_CHARS[(n >> 6) & 63] : '=';
    s += (i + 2 < b.length) ? B64_CHARS[n & 63] : '=';
  }
  return s;
}

/* ---------------- 签名（与原作者 getSign 同一套算法，GET 参数按 key 排序） ---------------- */

function sortedQuery(params) {
  if (!params) return '';
  return Object.keys(params).sort().map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k]));
  }).join('&');
}

function getSign(method, path, queryParams, bodyObj, ts) {
  var qs = method === 'GET' ? sortedQuery(queryParams || {}) : '';
  var bodyStr = method === 'GET' ? '' : JSON.stringify(bodyObj);
  var raw = method + '&' + path + '&' + qs + '&' + bodyStr + '&appid=' + APPID + '&timestamp=' + ts;
  return bytesToBase64(hmacSha256(SIGN_KEY, raw));
}

/* ---------------- 小工具 ---------------- */

function log(msg) { console.log('[IQOO兑换 ' + VERSION + '] ' + msg); }
function notify(title, sub, body) {
  try { $notification.post(title, sub || '', body || ''); } catch (e) {}
  log((sub ? sub + ' ' : '') + (body || ''));
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function readJSON(key) {
  try {
    var s = $persistentStore.read(key);
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}
function writeJSON(key, obj) {
  try { $persistentStore.write(JSON.stringify(obj), key); } catch (e) {}
}

function parseArgs(raw) {
  var out = {};
  String(raw || '').split('&').forEach(function (part) {
    var pos = part.indexOf('=');
    if (pos < 0) return;
    var k = part.slice(0, pos);
    var v = part.slice(pos + 1);
    try { v = decodeURIComponent(v); } catch (e) {}
    out[k] = v;
  });
  return out;
}

function isPlaceholder(v) {
  return !v || v === 'PASTE_TOKEN_HERE' || v === 'PASTE_XVISITOR_HERE' || v.indexOf('请填') === 0;
}

function headerValue(headers, name) {
  if (!headers) return '';
  var want = name.toLowerCase();
  for (var k in headers) {
    if (k.toLowerCase() === want) return headers[k];
  }
  return '';
}

function acctLabel(a) { return (a && (a.userName || a.userId)) || '账号?'; }

/* ---------------- 账号：读存着的登录态（多账号数组） ---------------- */

// 旧版单账号对象 {userId, token, xVisitor} 升级成数组
function readAuthArray() {
  var raw = readJSON(STORE_AUTH);
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(function (a) { return a && a.userId && a.token; });
  if (raw.userId && raw.token) return [raw];
  return [];
}

function upsertAccount(list, acct) {
  if (!acct || !acct.userId || !acct.token) return list;
  var found = false;
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].userId) === String(acct.userId)) {
      list[i] = acct;
      found = true;
    }
  }
  if (!found) list.push(acct);
  return list;
}

// 拼出本次要跑的账号：兑换自己的数组为主，签到脚本的 iqoos_data 里
// 有、这边没有的号也并进来（没 X-Visitor 也照样试一次）；
// 插件参数里如果还填着单个账号（旧版留下的），也并进来兜底。
function loadAccounts(args) {
  var list = readAuthArray();
  var signin = readJSON(STORE_SIGNIN);
  if (Array.isArray(signin)) {
    signin.forEach(function (s) {
      if (!s || !s.userId || !s.token) return;
      var exists = list.some(function (a) { return String(a.userId) === String(s.userId); });
      if (!exists) list.push({ userId: String(s.userId), token: s.token, xVisitor: '', userName: s.userName || '', updatedAt: '' });
    });
  }
  if (args && args.userId && !isPlaceholder(args.token)) {
    upsertAccount(list, {
      userId: String(args.userId), token: args.token,
      xVisitor: isPlaceholder(args.xVisitor) ? '' : (args.xVisitor || ''),
      userName: '', updatedAt: ''
    });
  }
  return list;
}

// 旧版成功标记 {lastSuccessGiftId} 迁移成按账号的 {success: {userId: {giftId, at}}}
function migrateState(state, accounts) {
  if (!state) return { success: {} };
  if (!state.success) state.success = {};
  if (state.lastSuccessGiftId) {
    var uid = '';
    var oldAuth = readJSON(STORE_AUTH);
    if (oldAuth && !Array.isArray(oldAuth) && oldAuth.userId) uid = String(oldAuth.userId);
    if (!uid && accounts.length) uid = String(accounts[0].userId);
    if (uid && !state.success[uid]) state.success[uid] = { giftId: state.lastSuccessGiftId, at: state.lastSuccessAt || '' };
    delete state.lastSuccessGiftId;
    delete state.lastSuccessAt;
  }
  return state;
}

/* ---------------- HTTP（按当前账号发请求） ---------------- */

function setAccount(acct) {
  cfg.userId = String(acct.userId || '');
  cfg.token = acct.token || '';
  cfg.xVisitor = acct.xVisitor || '';
  cfg.userName = acct.userName || '';
}

function buildHeaders(ts, sig) {
  var h = {
    'content-type': 'application/json',
    'xweb_xhr': '1',
    'x-platform': 'mini',
    'sign': 'IQOO-HMAC-SHA256 appid=' + APPID + ',timestamp=' + ts + ',signature=' + sig,
    'authorization': cfg.token,
    'user-agent': UA,
    'accept': '*/*',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'Referer': REFERER,
    'Accept-Encoding': 'gzip,compress,br,deflate',
    'Accept-Language': 'zh-CN,zh;q=0.9'
  };
  if (cfg.xVisitor) h['x-visitor'] = cfg.xVisitor;
  return h;
}

function httpReq(method, url, body, ts, sig) {
  return new Promise(function (resolve) {
    var opts = { url: url, headers: buildHeaders(ts, sig), timeout: 15000 };
    if (body !== null && body !== undefined) opts.body = body;
    var cb = function (err, resp, data) {
      if (err) { resolve({ ok: false, status: 0, data: '', err: String(err) }); return; }
      resolve({ ok: true, status: (resp && (resp.status || resp.statusCode)) || 0, data: data || '' });
    };
    if (method === 'GET') $httpClient.get(opts, cb);
    else $httpClient.post(opts, cb);
  });
}

function apiGet(path, queryParams) {
  var ts = Math.floor(Date.now() / 1000);
  var qs = sortedQuery(queryParams || {});
  // 注意：签名里的 path 要带 /api 前缀（抓包验过），URL 里 API 本来就带 /api
  return httpReq('GET', API + path + (qs ? '?' + qs : ''), null, ts, getSign('GET', '/api' + path, queryParams, null, ts));
}

function apiPost(path, bodyObj) {
  var ts = Math.floor(Date.now() / 1000);
  return httpReq('POST', API + path, JSON.stringify(bodyObj), ts, getSign('POST', '/api' + path, null, bodyObj, ts));
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

/* ---------------- 捕获登录态（http-response 触发，按 userId 去重存数组） ---------------- */

// 插件参数“获取Token开关”：默认开；关了就不抓（两个号抓完后可关掉）
function captureEnabled() {
  var args = parseArgs(typeof $argument === 'string' ? $argument : '');
  var v = String(args.capture || '').toLowerCase();
  if (!v) return true;
  return v === '1' || v === 'true' || v === 'on';
}

function captureAuth() {
  try {
    if (!captureEnabled()) {
      log('获取Token开关已关，跳过捕获');
      $done({});
      return;
    }
    var token = headerValue($request.headers, 'authorization');
    var xVisitor = headerValue($request.headers, 'x-visitor');
    if (!token || token.indexOf('Bearer ') !== 0 || !xVisitor) {
      log('捕获跳过：请求头里没有完整的登录态');
      $done({});
      return;
    }
    var userId = '';
    var userName = '';
    var m = String($request.url || '').match(/userId=(\d+)/);
    if (m) userId = m[1];
    if ($response && $response.body) {
      var body = parseJSON($response.body);
      if (body && body.Data) {
        if (body.Data.id) userId = String(body.Data.id);
        if (body.Data.mobile) userName = String(body.Data.mobile);
      }
    }
    if (!userId) {
      log('捕获跳过：拿不到 userId');
      $done({});
      return;
    }
    var list = readAuthArray();
    var before = list.length;
    var old = null;
    list.forEach(function (a) { if (String(a.userId) === userId) old = a; });
    var fresh = { userId: userId, token: token, xVisitor: xVisitor, userName: userName || (old && old.userName) || '', updatedAt: new Date().toISOString() };
    upsertAccount(list, fresh);
    if (old && old.token === fresh.token && old.xVisitor === fresh.xVisitor) {
      log('登录态无变化，不重复通知');
    } else {
      writeJSON(STORE_AUTH, list);
      notify('IQOO兑换', '登录态已保存', '账号[' + (fresh.userName || fresh.userId) + '] 已保存，当前共 ' + list.length + ' 个账号（签到和兑换共用）。');
      log('登录态已保存，用户 ' + userId + '，共 ' + list.length + ' 个账号（之前 ' + before + ' 个）');
    }
  } catch (e) {
    log('捕获出错：' + (e && e.message ? e.message : e));
  }
  $done({});
}

/* ---------------- 定时任务 ---------------- */

function loadConfig() {
  var args = parseArgs(typeof $argument === 'string' ? $argument : '');
  cfg.accounts = loadAccounts(args);
  cfg.giftId = parseInt(args.giftId || '0', 10) || 0;
  cfg.addressId = parseInt(args.addressId || '0', 10) || 0;
  cfg.retry = Math.max(1, Math.min(10, parseInt(args.retry || '5', 10) || 5));
  cfg.interval = Math.max(300, Math.min(10000, parseInt(args.interval || '1200', 10) || 1200));
}

async function listMode() {
  var lines = [];
  var goodsResp = null;
  for (var i = 0; i < cfg.accounts.length; i++) {
    setAccount(cfg.accounts[i]);
    var userResp = await apiGet('/v3/user', { userId: cfg.userId });
    var user = parseJSON(userResp.data);
    var score = (user && user.Data && typeof user.Data.score === 'number') ? user.Data.score : '?';
    lines.push('[' + acctLabel(cfg.accounts[i]) + '] 酷币 ' + score);
    if (!goodsResp) goodsResp = await apiGet('/v3/goods.list', { 'filter[goodsType]': 1, 'filter[saleStatus]': 2, page: 1, perPage: 100, scope: 0 });
    log('[' + acctLabel(cfg.accounts[i]) + '] 当前酷币：' + score);
  }
  var json = parseJSON(goodsResp.data);
  if (!json || json.Code !== 0 || !json.Data || !json.Data.list) {
    var msg = (json && json.Message) ? json.Message : ('HTTP ' + goodsResp.status + '，返回 ' + String(goodsResp.data || '').slice(0, 120));
    notify('IQOO兑换', '查商品失败', lines.join('\n') + '\n' + msg);
    return;
  }
  var list = json.Data.list;
  var inStock = list.filter(function (g) { return g.goods_stock > 0; });
  lines.push('在售 ' + list.length + ' 件，有库存 ' + inStock.length + ' 件');
  inStock.slice(0, 10).forEach(function (g) {
    lines.push(g.id + ' ' + g.goods_name + '｜' + g.goods_score + '币｜库存' + g.goods_stock + '｜' + (g.list_at || ''));
  });
  if (inStock.length === 0) lines.push('当前全部无库存，等下一批上架再看。');
  lines.push('要抢哪件，把插件参数“商品ID”改成它的 id 即可（两个号抢同一件）。');
  log(lines.join('\n'));
  notify('IQOO兑换', '商品列表（商品ID=0，未兑换）', lines.join('\n'));
}

async function fetchDefaultAddressId() {
  var resp = await apiGet('/v3/user.address.list', { 'filter[userId]': cfg.userId, page: 1, perPage: 10 });
  var json = parseJSON(resp.data);
  if (!json || json.Code !== 0 || !json.Data || !json.Data.length) return 0;
  for (var i = 0; i < json.Data.length; i++) {
    if (String(json.Data[i].is_default) === '1') return json.Data[i].id;
  }
  return json.Data[0].id;
}

async function rushOne(acct, state) {
  var label = '[' + acctLabel(acct) + ']';
  setAccount(acct);
  var uid = String(acct.userId);
  if (state.success[uid] && state.success[uid].giftId === cfg.giftId) {
    log(label + ' 商品 ' + cfg.giftId + ' 已兑换成功过，跳过');
    return label + ' 已兑过，跳过';
  }

  var addressId = cfg.addressId;
  if (!addressId) {
    addressId = await fetchDefaultAddressId();
    if (!addressId) {
      return label + ' 没有默认收货地址，请先在 IQOO 社区里设一个，或在插件参数里填收货地址ID。';
    }
    log(label + ' 自动取到默认地址 id：' + addressId);
  }

  var lastMsg = '';
  var lastCode = '';
  for (var i = 1; i <= cfg.retry; i++) {
    var body = { userId: Number(cfg.userId), id: cfg.giftId, addressId: addressId, imei: '' };
    var resp = await apiPost('/v3/exchange', body);
    var json = parseJSON(resp.data);
    lastCode = json ? json.Code : ('HTTP ' + resp.status);
    lastMsg = json ? (json.Message || '') : String(resp.data || '').slice(0, 120);
    log(label + ' 第 ' + i + '/' + cfg.retry + ' 次兑换：Code=' + lastCode + '，' + lastMsg);
    if (json && json.Code === 0) {
      state.success[uid] = { giftId: cfg.giftId, at: new Date().toISOString() };
      writeJSON(STORE_STATE, state);
      var name = '商品 ' + cfg.giftId;
      var dResp = await apiGet('/v3/goods.detail', { goodsType: 1, id: cfg.giftId });
      var dJson = parseJSON(dResp.data);
      if (dJson && dJson.Data && dJson.Data.goods_name) name = dJson.Data.goods_name;
      return label + ' ✅ 兑换成功：' + name + '（第 ' + i + ' 次命中）。去 App 里看订单。';
    }
    // 这些情况重试也没用，直接停
    if (/已兑|重复|上限|资格|不足/.test(lastMsg)) {
      if (/已兑|重复|上限/.test(lastMsg)) {
        state.success[uid] = { giftId: cfg.giftId, at: new Date().toISOString() };
        writeJSON(STORE_STATE, state);
      }
      return label + ' 未成功：' + lastMsg + '（Code ' + lastCode + '）';
    }
    if (/登录|授权|过期|token|Token|401|403/.test(lastMsg) || lastCode === 401 || lastCode === 403) {
      return label + ' 登录态过期：' + lastMsg + '。打开一次 IQOO 社区 App 重新抓登录态，下次再跑。';
    }
    if (i < cfg.retry) await sleep(cfg.interval);
  }
  return label + ' 失败：试了 ' + cfg.retry + ' 次都没成，最后一次：' + lastMsg + '（Code ' + lastCode + '）。';
}

async function rushMode() {
  var state = migrateState(readJSON(STORE_STATE), cfg.accounts);
  var lines = [];
  for (var i = 0; i < cfg.accounts.length; i++) {
    lines.push(await rushOne(cfg.accounts[i], state));
  }
  writeJSON(STORE_STATE, state);
  log(lines.join('\n'));
  notify('IQOO兑换', '兑换结果（' + cfg.accounts.length + ' 个账号）', lines.join('\n'));
}

async function main() {
  log('开始执行，版本 ' + VERSION);
  loadConfig();
  if (!cfg.accounts.length) {
    notify('IQOO兑换', '没有可用账号', '先打开一次 IQOO 社区 App（两个号各打开一次），登录态会自动存好，签到和兑换共用。');
    return;
  }
  log('本次共 ' + cfg.accounts.length + ' 个账号：' + cfg.accounts.map(acctLabel).join('、'));
  if (!cfg.giftId) {
    await listMode();
    return;
  }
  await rushMode();
}

!(async function () {
  try {
    if (typeof $request !== 'undefined' && $request && $request.headers) {
      captureAuth();
    } else {
      await main();
    }
  } catch (e) {
    log('执行出错：' + (e && e.message ? e.message : e));
    try { $notification.post('IQOO兑换', '脚本出错', String(e && e.message ? e.message : e)); } catch (_) {}
  } finally {
    try {
      if (typeof $request === 'undefined' || !$request) $done({});
    } catch (e) { $done({}); }
  }
})();
