# 密码用户与云端 JSON

前端继续发布在 GitHub Pages。Cloudflare Worker 提供鉴权接口；KV 的 `plans/<用户ID>.json` 保存用户方案 JSON。用户 ID 由密码和服务端密钥经 PBKDF2 派生，不包含明文密码。

KV 本身是最终一致存储，没有比较并交换操作，因此 SQLite Durable Object 负责串行处理和保存当前版本，防止两台设备覆盖对方的修改。它同时保留用户、短期会话和当前 JSON；每次成功保存都先写 KV，再确认当前版本。两者均使用 Cloudflare 支持的免费计划能力，不使用 R2，也不需要购买服务器。

## 用户操作

- 首次点击“创建新用户”，填写名称和至少 6 字符的密码。密码相同就是同一用户；重复密码不能创建新用户。
- 之后只需输入密码登录。换设备输入同一个密码，会读取同一份方案。
- 编辑停止约 5 秒后自动合并保存，也可点击“保存到云端”。页面显示成功时间才表示服务端已确认。
- 同时编辑出现版本冲突时，停止自动上传并保留本页改动。先导出当前改动，再选择载入云端；也可以之后导入备份重新整理。
- 登录会话保存在当前标签页的 sessionStorage，8 小时过期。退出会撤销会话并清除该用户的标签页缓存。
- 原来浏览器里的本机方案不自动归入任何用户。登录后用“导入旧本机方案”显式迁移，旧 localStorage 数据不会被删除。

密码没有找回功能，请保存到密码管理器。此登录只保护用户的云端方案；仓库中原本就公开的默认 501 户型和源码仍然公开。

## 部署

需要 Node.js 22 或以上及 Cloudflare 账号。首次执行 Wrangler 命令时可通过 `npx --yes wrangler@4` 调用，不要求全局安装。

1. `npx --yes wrangler@4 login`，授权相关 Workers、KV 和账号读取权限。
2. `npx --yes wrangler@4 kv namespace create FLOORPLAN_501_JSON`，把 namespace ID 写入 `cloud/wrangler.jsonc` 的 `JSON_DATA`，核对 account_id。
3. `npx --yes wrangler@4 deploy --config cloud/wrangler.jsonc`，创建 Worker 和 SQLite Durable Object。
4. `npx --yes wrangler@4 secret put IDENTITY_KEY --config cloud/wrangler.jsonc`，输入至少 32 字符的安全随机服务端密钥。只通过隐藏输入或 stdin 传入，不提交到 Git。
5. 将 `cloud-config.js` 的 `apiBase` 设置为返回的 Worker HTTPS 地址，并设置 `enabled:true`。
6. 运行 `npm test`，发布 GitHub Pages。`ALLOWED_ORIGINS` 只允许实际前端 origin，默认 `https://tiggerhat.github.io`。

**部署更新时保留 `IDENTITY_KEY`。** 更换该密钥会改变所有密码对应的用户 ID，原有密码将无法定位原有方案。密钥仅存于 Cloudflare Secret 和所有者的私有备份，不写进页面、仓库或用户 JSON。

## 免费额度与限制

- KV 免费版额度是账号共享的：每天 1,000 次写入，同一 key 每秒最多写一次，存储 1 GB。账号内其他项目也可能占用这些额度。
- 本应用只把方案快照写入 KV，用户及短期会话使用协调器，避免每次登录消耗 KV 写入。
- 应用另设每天最多 800 次成功方案保存的保护上限，按 UTC 日期重置（北京时间 08:00）。连续修改会合并；没有新改动时点击保存不重复写入。
- 达到免费额度、保护上限或网络失败时不会显示“已保存”，当前改动保留在标签页，可重试或导出 JSON。关闭页面前应确认保存成功。
- 每个方案最大 2 MB，最多 50 个用户；登录/注册按 IP 限制为每分钟 10 次。
- 免费计划资源耗尽会报错，不会由应用自动升级套餐或开通付费订阅。

官方说明：[KV 限制](https://developers.cloudflare.com/kv/platform/limits/)、[Durable Objects 免费计划](https://developers.cloudflare.com/durable-objects/platform/pricing/)。

## 本地验证

创建被 Git 忽略的 `cloud/.dev.vars`：

```dotenv
IDENTITY_KEY="local-only-random-key-at-least-32-characters"
ALLOWED_ORIGINS="http://localhost:8767"
```

分别运行：

```bash
npx --yes wrangler@4 dev --local --config cloud/wrangler.jsonc --port 8787
node scripts/dev-cloud.cjs
```

访问 `http://localhost:8767`。开发服务器只覆盖前端的公开接口地址，不会把测试密码或开发密钥加入源码。Wrangler 的本地数据位于被忽略的 `.wrangler` 目录。

`npm test` 包含用户隔离、会话撤销、版本冲突、无效输入不覆盖、KV 配额失败与写入保护等测试。服务端数据、OAuth 凭据和 `.dev.vars` 都不应提交到公共仓库。
