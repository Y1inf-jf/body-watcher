# 隐私政策(Privacy Policy)

本仓库为 Body Watcher 个人健康监测项目的源代码。该项目是一个仅供个人用户自己使用的本地应用,通过 Google Health API(Fit)只读同步用户本人的健康与运动数据。

## 数据收集范围

应用通过 OAuth 2.0 获得用户授权后,仅从用户的 Google Health 账户读取以下类别的数据:

- 活动与运动数据(步数、锻炼记录等)
- 健康指标(静息心率、HRV、血氧、呼吸频率、体重等)
- 睡眠数据

全部接口均为只读(readonly)权限,应用不会向 Google Health 写入或删除任何数据。

## 数据存储与处理

- 同步到的数据仅保存在用户本人运行环境本地的 SQLite 数据库文件中(`data/body-watcher.db`),不上传到任何第三方服务器。
- 用户可随时删除本地数据库文件以清除全部数据,也可随时在 Google 账号安全页面撤销本应用的授权(https://myaccount.google.com/permissions)。
- OAuth 凭据(access token / refresh token)仅存储在本地,从不出境到除 Google API 之外的任何服务。

## 数据共享

除用户本人主动选择将代码仓库或本地数据公开外,应用本身不与任何第三方共享、出售或转让用户数据。

## 联系方式

如对隐私政策有疑问,请通过 GitHub 仓库 Issues 联系维护者(https://github.com/Y1inf-jf/body-watcher)。

*最后更新:2026-09-05*
