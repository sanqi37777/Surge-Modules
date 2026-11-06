# Loon 插件（由 Surge 模块转换，2026-11-06）

本目录是 `Surge/` 模块的 Loon 对应版本，**原 Surge 文件保持不变**，两套并存。脚本仍引用原来的 `.js` 文件（`Scripts/` 或原作者地址），脚本本身没有改动；改的是插件的写法：Loon 3.5.1(983) 及以上的新版脚本语法，参数用插件 `[Argument]` 界面填写，`$argument` 仍以字符串形式传给脚本，和 Surge 时一致。

## ⚠️ 先看这条，再装插件

**一个模块只能在一边跑。先在 Surge 里停用（或删除）对应的模块，再在 Loon 里启用它的插件，绝不要两边同时开。** 两边同时跑，签到会重复触发、通知会重复发，蜂鸟商城抢购会重复下单——话费红包每月只能抢中 1 次，重复跑可能直接烧掉当月额度。

- 蜂鸟商城抢购插件在 2026 年 11 月剩余时间**保持关闭**，12 月 1 日 10 点场前再开（11 月额度已抢到）。
- 切换当天注意：早上 06:00–06:40 是签到集中时段，别在这个时间段前后脚切换，避免某一家漏签或两家都跑。

## 安装方法

1. Loon → 配置 → 插件 → 右上角 `+` → 粘贴下面对应链接 → 保存并启用。
2. Loon 的 MITM 证书要单独装：Loon → 配置 → MitM → 生成证书 → 去系统设置里安装并信任。**不要复用 Surge 的 p12**，两个 App 的证书不通用。
3. 插件需要 Loon 3.5.1(983) 及以上版本。版本太老会认不出新版脚本语法，先去 App Store 更新 Loon。

| 插件 | 安装链接 |
|---|---|
| 中国移动自动签到 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/cmcc_checkin.plugin |
| 中国联通首页签到 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/unicom_checkin.plugin |
| 蜂鸟众包自动签到 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/fengniao_checkin.plugin |
| 蜂鸟商城话费红包抢购 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/fengniao_mall_rush.plugin |
| PingMe 签到 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/pingme.plugin |
| IQOO社区签到 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/IQOO%E7%A4%BE%E5%8C%BA%E4%BB%BB%E5%8A%A1.plugin |
| 春风摩托每日任务 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/CFMOTO.plugin |
| Rokid每日任务 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/Rokid.plugin |
| 百度贴吧签到 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/%E7%99%BE%E5%BA%A6%E8%B4%B4%E5%90%A7%E7%AD%BE%E5%88%B0.plugin |
| 彩云天气去广告 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/caiyun.plugin |
| 美团App去广告 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/meituan-adblock.plugin |
| 网盘追剧 & 玩偶资源站直连 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/PanVod.plugin |
| Emby 公益服直连 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/emby-direct.plugin |

主配置（三七的 Loon 配置，全自动版）不在插件里，在这里：

- https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/sanqi-loon-20261106.conf

## 凭证不会从 Surge 带过来，必须重新抓

Loon 与 Surge 是两个 App，Surge 里已存的登录态、Cookie、Token 一个都不会带过来。每个带捕获的插件，装好后都要在 Loon 开着（MITM 已信任）时把对应的 App 打开一次，让捕获脚本重新存一遍：

| 插件 | 打开这个 App，做这个动作 |
|---|---|
| 中国移动自动签到 | 中国移动 App → 我的 → 签到领流量，进一次签到页 |
| 中国联通首页签到 | 联通 App → 退出登录 → 切换账号登录一次（或直接在插件参数里粘贴完整 Cookie） |
| 蜂鸟众包自动签到 | 蜂鸟众包 App，正常打开一次 |
| 蜂鸟商城话费红包抢购 | 蜂鸟众包 App，正常打开一次；再手动运行一次插件里的「蜂鸟商城手机号预存」 |
| PingMe 签到 | PingMe App，正常打开一次 |
| IQOO社区签到 | IQOO 社区 App，正常打开一次 |
| 春风摩托每日任务 | 春风摩托 App，打开一次，等 user_info 请求被捕获 |
| 百度贴吧签到 | 百度贴吧 App，登录一次 |

## 要在手机上填的参数（只填在手机上，不要提交到仓库）

| 插件 | 参数 | 填什么 |
|---|---|---|
| 中国移动自动签到 | 手机号 cmcc_phone | 自己的 11 位手机号（默认是占位文字 fill-your-phone，不改会通知提醒） |
| 中国联通首页签到 | 完整 Cookie unicom_cookie | 联通 App 的完整 Cookie（小组件用的那条）；留空则回落到 token_online 捕获路径 |
| 蜂鸟商城话费红包抢购 | 支付宝手机号 mobile | 支付宝绑定的手机号，只用于下单前自校验 |
| Rokid每日任务 | 账号密码 accounts | 格式 `账号&密码`，多个账号用空格分隔 |
| IQOO社区签到 | 发帖任务 / 抽奖任务 / 浏览文章数量 | 开关默认都是关，浏览数量默认 15（1-26） |
| 百度贴吧签到 | 启用 Cookie 捕获 | 默认开；关掉后不再捕获登录态 |

其他参数（签到时间、视频数、间隔等）都有默认值，和 Surge 版一样，一般不用改。

## 定时表（和 Surge 版完全一致）

| 时间 | 任务 |
|---|---|
| 06:00 | 中国移动自动签到 |
| 06:05 | 中国联通首页签到 |
| 06:10 | 蜂鸟众包自动签到 |
| 06:15 | PingMe 签到 |
| 06:20 | IQOO社区签到 |
| 06:40 | 蜂鸟众包自动签到（补签检查，已签则静默跳过） |
| 07:00 | 春风摩托每日任务 |
| 08:34、17:34 | Rokid每日任务 |
| 08:40 | 百度贴吧签到 |
| 09:59、13:59、19:59 | 蜂鸟商城 open_id 预刷新 |
| 10:00、14:00、20:00 | 蜂鸟商城话费红包抢购 |

## 没转成插件的东西

### 三七合集没有转成 `三七合集.plugin`

`Surge/三七合集.sgmodule` 是 1149 行的合并大模块，里面有三样东西 Loon 插件没有对应的写法，没法原样转：

1. `[Body Rewrite]` 约 850 行和 `[Map Local]` 约 163 行——Loon 插件没有这两个段。
2. `[Rule]` 里大量 `extended-matching,pre-matching` 是 Surge 专用的规则选项。
3. 它和 `caiyun.plugin` 里的彩云天气去广告是同一份内容，整包转了会重复。

它里面唯一一个独立的定时任务是百度贴吧签到（08:40），已经单独抽出来做了 `百度贴吧签到.plugin`，不会重复跑。合集里其他各 App 的去广告规则/重写没有转；主配置的远程规则和去广告插件已经覆盖了其中一部分，想要其中某一个 App（比如哔哩哔哩、淘宝、京东、Spotify、微信小程序）的去广告单独转成插件，找助理按 App 单独转。

### 两份规则表是内联的，不会自动更新

- `PanVod.plugin`：上游 eulac-dev/Proxy 的 PanVod（47 条，2026-08-14 版）和 ResourceSite（25 条，2026-10-23 版）已内联进插件，上游更新后不会自动生效，找助理重新同步。
- `emby-direct.plugin`：仓库 `Rules/Emby.list` 的 23 个域名已内联（2026-11-06 版），新增服务器后找助理重新同步。主配置里也内联了同一份 23 个域名，两边都是 DIRECT，结果一致。

### 转换时改动过的两处

- Rokid：Surge 版模块里定时表达式两边是全角引号，Loon 版已改成标准引号，时间不变（08:34、17:34）。
- IQOO / 春风摩托：Surge 版里「禁用获取Cookie / 禁用MITM」两个参数并不实际控制任何脚本行（只是提示性文字），Loon 版未保留；如需停用捕获，直接在 Loon 里停用本插件或对应脚本即可。
