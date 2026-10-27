# 项目发布约定

- 使用中文与用户交流。
- 这里是带户型编辑和 Cloudflare 云保存的 501 版本，目标仓库为 `tiggerhat/floorplan-501`，发布分支为 `main`，页面为 `https://tiggerhat.github.io/floorplan-501/`。不要与 `floorplan-3d` 原版混用。
- 每次修改后运行 `npm test`，验证相关交互，提交并推送到此仓库，确认自动测试和 Pages 发布成功。
- 本目录位于知识库中；只发布本应用的源码、测试、依赖和说明，不发布整个知识库。可使用该应用的独立 Git 检出目录发布。
- 若修改涉及 `cloud/` 服务端代码或配置，同步更新对应 Cloudflare Workers/KV 等服务；仅前端修改无需重部署服务端。保留现有身份密钥和用户数据。
