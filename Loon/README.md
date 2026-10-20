# Loon 插件版（由 Surge 模块转换）

本目录是 `Surge/` 目录四个 Surge 模块的 Loon 对应版本，两套并存、功能一一对应。插件引用的脚本统一放在仓库的 `Scripts/` 目录（脚本框架本身多平台兼容，未改动）。

## 安装方法

Loon → 配置 → 插件 → 右上角 + → 粘贴下面对应链接 → 保存并启用。同时确认 Loon 的 MITM 证书已生成、安装并在系统设置里信任。

| 插件 | 安装链接 |
|---|---|
| 春风摩托 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/CFMOTO.plugin |
| IQOO社区 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/IQOO%E7%A4%BE%E5%8C%BA%E4%BB%BB%E5%8A%A1.plugin |
| Rokid | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/Rokid.plugin |
| 蜂鸟探针 | https://raw.githubusercontent.com/sanqi37777/Surge-Modules/main/Loon/fengniao.plugin |

## 注意事项

1. **数据不互通**：Loon 与 Surge 是两个 App，Surge 里已存的登录态（IQOO 的 Token、蜂鸟探针捕获的请求头）不会带过来。IQOO 需在 Loon 开着 MITM 时打开一次 IQOO 社区 App 重新捕获；蜂鸟探针需重新打开一次蜂鸟众包 App 让捕获规则存到请求头；Rokid 在插件参数里重新填一次账号密码即可（只填在手机上，不要提交到仓库）。
2. **定时时间确认**：CFMOTO 与 IQOO 的执行时间做成了插件参数（默认值与 Surge 版相同）。安装后请在插件详情里确认参数值与脚本列表里显示的执行时间无误。
3. **参数改法**：插件详情页可直接改参数（定时、发帖/抽奖开关、浏览数量、Rokid 账号），不用改文件。
4. **与 Surge 版的对应关系**：Surge 模块里的「禁用获取Cookie / 禁用MITM」两个参数在原版中并不实际控制任何脚本行（只是提示性文字），Loon 版未保留；如需停用捕获，直接在 Loon 里停用整个插件或对应脚本即可。
5. **CFMOTO 的脚本**是第三方脚本（leiyiyan/resource），与 Surge 版引用的是同一个文件，本次未做改动；若在 Loon 下运行异常，反馈后再单独适配。
6. **蜂鸟探针**：捕获后在 Loon「脚本」列表中手动运行「pizza重放探针」一次，结论看通知；验证完请停用插件（与 Surge 版相同）。
