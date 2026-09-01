# Google Health API 打样验证记录(2026-09-01)

> 目标:用 Fitbit Air 手环的数据,通过 Google Health API 接入 body-watcher,
> 复刻 Whoop 的核心体验(Recovery 恢复分 / Strain 负荷 / Sleep 睡眠表现)。
> 本文记录打样验证(Phase 0)当天的完整操作步骤、踩坑与结论,作为 Phase 1 正式集成的依据。

## 结论速览

- **调用链路已 100% 打通**:OAuth 授权 → token → 读取真实数据,全流程验证成功。
- **正确的 API 端点是 `https://health.googleapis.com/v4`**(不是 googlehealth.googleapis.com)。
- 本机直连 Google 被墙,所有请求走本地代理 `http://127.0.0.1:7897`(Node fetch 需显式挂代理)。
- 当前云端只有 1 条手动体重记录(71kg),手环传感器数据尚未同步上云,等手机端同步后即可见。

## 今日操作步骤(时序)

1. **网络连通性验证**
   - DNS 解析 Google 域名正常;直连 `googleapis.com` TCP 全部超时(被墙)。
   - 发现系统代理 `127.0.0.1:7897`(Clash 系),走代理后三台 Google 服务器全部秒通
     (HTTP 404/302 都算通,只证明链路)。
2. **GCP 控制台配置**(console.cloud.google.com,免费,无需绑卡)
   - 建项目 body-watcher → API 库启用 **Google Health API**。
   - Credentials → 创建 OAuth 客户端(Web 应用类型),得 client_id / client_secret。
   - OAuth 客户端添加已获授权的重定向 URI:`http://localhost:8765/callback`。
   - Google Auth Platform → 数据访问:勾选三个 readonly scope
     (activity_and_fitness / health_metrics_and_measurements / sleep)。
   - 目标对象(Audience)→ 测试用户:添加自己的 Gmail 账号。
3. **打样脚本**:`scripts/google-health-spike/spike.mjs`(Node 22 原生运行)
   - 本地起 HTTP 服务(8765 端口)接授权回调 → 打印授权链接 → 换 token →
     存 `.tokens.json` → 依次拉 identity / sleep / HRV / 静息心率 / 步数。
   - 代理通过 undici 的 `ProxyAgent` 挂载(Node fetch 默认不理会 HTTPS_PROXY)。
4. **授权与首次数据读取**:浏览器走完"未验证应用警告 → 高级 → 继续 → 同意"流程,
   token 成功落盘,拉通 5 个接口。

## 踩坑实录(重要)

| # | 现象 | 原因 | 解法 |
|---|------|------|------|
| 1 | dev server 启动即 500,Turbopack panic | 项目根目录存在名为 `nul` 的 0 字节文件(Git Bash 里 `> nul` 的产物),Windows 保留设备名,PostCSS/Tailwind 管道读取时崩溃 | 删除该文件;Git Bash 丢弃输出请用 `> /dev/null` |
| 2 | 杀掉旧 dev server 后新实例起不来 | npm 的子进程 `next dev` 成孤儿,仍占用 3000 端口 | `taskkill //PID <pid> //F` 后重启 |
| 3 | 授权页报 400 `redirect_uri_mismatch` | OAuth 客户端未登记回调地址(列表为空) | 客户端详情页 → 已获授权的重定向 URI → 添加 `http://localhost:8765/callback` → 保存,等约 5 分钟生效 |
| 4 | 授权页报 403 `access_denied`(尚未完成验证流程) | 应用处于"测试"状态,登录账号不在测试用户名单 | 目标对象 → 测试用户 → 添加该 Gmail |
| 5 | 授权成功但换 token 报 `invalid_grant: Malformed auth code` | 回调 code 解析的转义坑(searchParams 会把 `+` 当空格) | 改用正则从原始 query 提取 + `decodeURIComponent` 解码;并打印原始回调便于排查 |
| 6 | 所有数据接口返回 HTML 404 | **API 域名用错**:`googlehealth.googleapis.com` 不存在 API | 正确域名 `health.googleapis.com`,discovery 文档可佐证:`https://health.googleapis.com/$discovery/rest?version=v4` |

## 验证过的关键事实(Phase 1 直接用)

- **端点**:`https://health.googleapis.com/v4/users/{userId}/dataTypes/{dataType}/dataPoints`
- **身份映射**:`GET /v4/users/me/identity` → `legacyUserId: DGTY57`(Fitbit 老 ID)、
  `healthUserId: 8550421270310983276`
- **已验证的数据类型**:steps / heart-rate / exercise / sleep / weight /
  daily-heart-rate-variability / daily-oxygen-saturation / daily-respiratory-rate
  (全部 HTTP 200;数据结构见下例)
- **数据样例**(weight,含时区、来源,JSON 干净):

```json
{
  "name": "users/8550421270310983276/dataTypes/weight/dataPoints/2685750969756559996",
  "dataSource": { "recordingMethod": "MANUAL", "platform": "FITBIT" },
  "weight": {
    "sampleTime": {
      "physicalTime": "2026-08-31T08:58:04.528193Z",
      "utcOffset": "28800s",
      "civilTime": { "date": {"year": 2026, "month": 8, "day": 31},
                     "time": {"hours": 16, "minutes": 58} }
    },
    "weightGrams": 71000
  }
}
```

- **OAuth 要点**:
  - scope 前缀 `https://www.googleapis.com/auth/googlehealth.*`,本次申请了三个 readonly
  - 授权参数必须带 `access_type=offline` + `prompt=consent`(否则拿不到 refresh_token)
  - **不要**带 `include_granted_scopes=true`(社区实测:与旧 Fit scope 混合会 403)
  - access_token 约 1 小时;refresh_token 务必落库
- **网络**:本机所有 Google 请求必须走 `HTTPS_PROXY=http://127.0.0.1:7897`;
  Node 侧用 undici ProxyAgent(项目已加 devDependency)
- **凭据安全**:client_secret 与 token 存于 `scripts/google-health-spike/.env` 与
  `.tokens.json`,均已被 .gitignore 忽略,不进仓库

## 已知风险 / 限制

- **Restricted scope 审核**:所有 googlehealth.* scope 属受限范围。测试模式(现状)下
  refresh_token **7 天过期**,需定期重新授权;生产发布需过 Google 验证,个人自用
  (<100 用户)可点"未验证应用"警告页豁免。Phase 1 需设计"重新连接"兜底入口。
- **手机端同步依赖代理**:手环 → Google Health App → 云端,手机必须能连 Google,
  否则云端无数据(API 再正确也读不到)。
- **API 仍在滚动发版**(2026 年有 Q2/Q3 roadmap),只读核心数据(steps/sleep/HR/HRV/SpO2)
  已稳定;写权限对第三方基本未开放。

## 下一步(Phase 1-4 路线)

1. **Phase 1 数据管道**:正式集成进 body-watcher——Next.js route handler 做 OAuth 回调、
   token 入库(加密)、定时任务经代理拉取 sleep / daily-heart-rate-variability /
   daily-resting-heart-rate / daily-respiratory-rate / daily-oxygen-saturation /
   heart-rate / exercise 入 SQLite,失败可重试、代理断连有提示。
2. **Phase 2 算法层**:滚动 21 天个人基线 → Recovery(0-100,z-score 合成)、
   Strain(0-21,Foster TRIMP 按心率区间加权)、睡眠表现(基线+睡债+一致性)。
3. **Phase 3 UI**:首页"今日状态卡"(恢复分 / 负荷 / 睡眠),与既有趋势图并列。
4. **Phase 4 相关性**:昨日饮食(嘌呤/酒精/蛋白)× 训练负荷 → 今晨 HRV/恢复分——
   Whoop 做不到的差异化功能。

## 如何重跑打样

```bash
# 手机端同步上手环数据后:
node scripts/google-health-spike/spike.mjs
# token 已缓存则直接拉数据;7 天过期会提示重新授权(删 .tokens.json 重走授权)
```
