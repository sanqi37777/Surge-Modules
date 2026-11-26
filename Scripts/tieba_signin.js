/*********************************
百度贴吧签到脚本（重写版）

原脚本: @sazs34 / NobyDa (BDTieBa-DailyBonus/TieBa.js, 2024/06/01)
重写: @sanqi37777 (2026-11-27)
平台: Surge (主), 兼容 QuantumultX / Loon
存储键: CookieTB

重写原因:
- 原脚本并行签到时若任一请求挂起, 整体静默卡死, 无通知 (checkIsAllProcessed 永远等不到
result.length == total), 用户会误以为"脚本没跑"。
- 原脚本 User-Agent 过旧 (iOS 10/12), 贴吧接口可能拒收。
- 改为本地托管, 不依赖 NobyDa 仓库的 raw 直链。

获取Cookie说明:
打开百度贴吧App (AppStore 中国区, 非内部版), 点击"我的", 如通知成功获取 Cookie 即可。
定时签到: 每天 08:40 (Cron: 40 8 * * *), 自动签所有关注的贴吧。

*********************************/

var $tieba = tieba();
var cookieVal = $tieba.read("CookieTB");
var singleNotifyCount = 20; // 几个吧汇总到一条通知里
var WATCHDOG_MS = 90000; // 90 秒兜底: 到时无论签完几个都汇总通知, 绝不静默
var watchdogFired = false;
var notified = false;

var process = {
total: 0,
result: []
};

var url_fetch_sign = {
url: "https://tieba.baidu.com/mo/q/newmoindex",
headers: {
"Content-Type": "application/octet-stream",
Referer: "https://tieba.baidu.com/index/tbwise/forum",
Cookie: cookieVal,
"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
}
};
var url_fetch_add = {
url: "https://tieba.baidu.com/sign/add",
method: "POST",
headers: {
"Content-Type": "application/x-www-form-urlencoded",
Cookie: cookieVal,
"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
},
body: ""
};

if ($tieba.isRequest) {
GetCookie();
} else {
// 兜底看门狗: 90 秒后强制汇总通知, 防止并行/串行卡死导致"没跑"
setTimeout(function() {
if (!notified) {
watchdogFired = true;
finish("超时未完成 (90s)");
}
}, WATCHDOG_MS);
signTieBa();
}

function signTieBa() {
if (!cookieVal) {
notifyOnce("贴吧签到", "签到失败", "未获取到 Cookie, 请先打开贴吧 App 点一下\"我的\"抓 Cookie");
return $tieba.done();
}
$tieba.get(url_fetch_sign, function(error, response, data) {
if (error) {
notifyOnce("贴吧签到", "签到失败", "未获取到签到列表: " + (error || "网络错误"));
return $tieba.done();
}
var body;
try {
body = JSON.parse(data);
} catch (e) {
notifyOnce("贴吧签到", "签到失败", "签到列表解析失败: " + (e && e.message? e.message: e));
return $tieba.done();
}
var isSuccessResponse = body && body.no == 0 && body.error == "success" && body.data && body.data.tbs;
if (!isSuccessResponse) {
var msg = (body && body.error)? body.error: "接口数据获取失败";
if (body && body.no) msg += " (no=" + body.no + ")";
notifyOnce("贴吧签到", "签到失败", msg + " (Cookie 可能已过期, 请重开贴吧 App 抓一次)");
return $tieba.done();
}
var forums = body.data.like_forum || [];
process.total = forums.length;
if (forums.length === 0) {
notifyOnce("贴吧签到", "签到失败", "请确认您有关注的贴吧");
return $tieba.done();
}
// 改串行: 一个一个签, 避免并行挂起导致整体静默, 也避免 QX/Surge 并发崩溃
signBarsSerial(forums, body.data.tbs, 0);
});
}

function signBar(bar, tbs, next) {
if (bar.is_sign == 1) {
// 已签到的, 不请求接口
process.result.push({
bar: bar.forum_name,
level: bar.user_level,
exp: bar.user_exp,
errorCode: 9999,
errorMsg: "已签到"
});
next();
return;
}
url_fetch_add.body = "tbs=" + encodeURIComponent(tbs) + "&kw=" + encodeURIComponent(bar.forum_name) + "&ie=utf-8";
$tieba.post(url_fetch_add, function(error, response, data) {
if (error) {
process.result.push({
bar: bar.forum_name,
errorCode: 999,
errorMsg: "接口错误"
});
next();
return;
}
try {
var addResult = JSON.parse(data);
if (addResult.no == 0) {
process.result.push({
bar: bar.forum_name,
errorCode: 0,
errorMsg: "获得" + addResult.data.uinfo.cont_sign_num + "积分,第" + addResult.data.uinfo.user_sign_rank + "个签到"
});
} else {
process.result.push({
bar: bar.forum_name,
errorCode: addResult.no,
errorMsg: addResult.error || "未知错误"
});
}
} catch (e) {
process.result.push({
bar: bar.forum_name,
errorCode: 998,
errorMsg: "数据解析异常"
});
}
next();
});
}

function signBarsSerial(bars, tbs, index) {
if (index >= bars.length) {
finish("");
return;
}
signBar(bars[index], tbs, function() {
signBarsSerial(bars, tbs, index + 1);
});
}

function finish(note) {
if (notified) return;
notified = true;
if (process.total === 0) {
// 列表都没拿到就已经在前面通知过了, 这里不再重复
return $tieba.done();
}
var doneCount = process.result.length;
var successCount = 0;
for (var k = 0; k < process.result.length; k++) {
if (process.result[k].errorCode == 0 || process.result[k].errorCode == 9999) successCount++;
}
var title = "贴吧签到";
var subtitle = "签到" + doneCount + "/" + process.total + "个,成功" + successCount + "个" + (watchdogFired? " (超时)": "");
if (note) subtitle += " " + note;
var notify = "";
for (var i = 0; i < process.result.length; i++) {
var res = process.result[i];
if (res.errorCode == 9999) {
notify += "已经签到,当前等级" + res.level + ",经验" + res.exp + "\n";
} else {
notify += "" + (res.errorCode == 0? "签到成功": "签到失败") + "," + (res.errorCode == 0? res.errorMsg: ("原因:" + res.errorMsg)) + "\n";
}
}
if (watchdogFired && doneCount < process.total) {
notify += "(还有 " + (process.total - doneCount) + " 个吧没来得及签, 明天会再跑)\n";
}
$tieba.notify(title, subtitle, notify);
$tieba.done();
}

function notifyOnce(title, subtitle, message) {
if (notified) return;
notified = true;
$tieba.notify(title, subtitle, message);
}

function GetCookie() {
var headerCookie = $request.headers["Cookie"] || $request.headers["cookie"];
if (headerCookie && headerCookie.indexOf("BDUSS=")!== -1) {
if (!cookieVal) {
$tieba.notify("写入百度贴吧Cookie成功 🎉", "", "");
} else {
console.log("写入百度贴吧Cookie成功 🎉");
}
$tieba.write(headerCookie, "CookieTB");
} else {
console.log("写入Cookie失败, BDUSS值缺失.");
}
return $tieba.done();
}

function tieba() {
var isRequest = typeof $request!= "undefined";
var isSurge = typeof $httpClient!= "undefined";
var isQuanX = typeof $task!= "undefined";
var notify = function(title, subtitle, message) {
if (isQuanX) $notify(title, subtitle, message);
if (isSurge) $notification.post(title, subtitle, message);
};
var write = function(value, key) {
if (isQuanX) return $prefs.setValueForKey(value, key);
if (isSurge) return $persistentStore.write(value, key);
};
var read = function(key) {
if (isQuanX) return $prefs.valueForKey(key);
if (isSurge) return $persistentStore.read(key);
};
var adapterStatus = function(response) {
if (response) {
if (response.status) {
response["statusCode"] = response.status;
} else if (response.statusCode) {
response["status"] = response.statusCode;
}
}
return response;
};
var get = function(options, callback) {
if (isQuanX) {
if (typeof options == "string") options = { url: options};
options["method"] = "GET";
$task.fetch(options).then(function(response) {
callback(null, adapterStatus(response), response.body);
}, function(reason) { callback(reason.error, null, null);});
}
if (isSurge) $httpClient.get(options, function(error, response, body) {
callback(error, adapterStatus(response), body);
});
};
var post = function(options, callback) {
if (isQuanX) {
if (typeof options == "string") options = { url: options};
options["method"] = "POST";
$task.fetch(options).then(function(response) {
callback(null, adapterStatus(response), response.body);
}, function(reason) { callback(reason.error, null, null);});
}
if (isSurge) {
$httpClient.post(options, function(error, response, body) {
callback(error, adapterStatus(response), body);
});
}
};
var done = function(value) {
value = value || {};
if (isQuanX) return $done(value);
if (isSurge) return isRequest? $done(value): $done();
};
return {
isRequest: isRequest,
notify: notify,
write: write,
read: read,
get: get,
post: post,
done: done
};
}
