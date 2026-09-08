# Codex Galaxy Relay Ranking Service

独立服务，默认监听 `127.0.0.1:18110`。

- 不接收 API Key、OAuth、完整 prompt、完整输出或聊天正文。
- 只保存 Base host、平台名、模型名、测试时间、聚合分数和脱敏测试指标。
- 公开排名只能表示“兼容性/稳定性测试表现”，不能证明官方上游来源。
- 通过独立 systemd service 和独立 Cloudflare Tunnel hostname 部署，不修改其他项目。
- 当前公网入口是 `https://api.vx314490015.cn`，Tunnel 转发到本机 `127.0.0.1:18110`；Worker 入口为 `https://codex-galaxy-relay-rank.guanjingyang.workers.dev`。
- 服务端独立重算评分：模型核对 40 分、协议 25 分、能力探针 15 分、稳定性 10 分、速度 10 分；模型明确不匹配时总分最高 49 分。
- 排名页面向用户展示站点、模型、测试时间、分项得分、综合得分和历史表现。
- `/topup/` 提供 Codex Galaxy 套餐、价格、状态、咨询步骤和联系二维码的只读展示，不包含账号登录、在线购买、购物车或查单。
