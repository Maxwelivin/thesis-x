# 萊特博士後端（Cloudflare Worker）

App 不直接連 AI，而是連這個 Worker。金鑰和通關密語只存在 Worker 的加密設定裡，不會進網頁或 repo。

## 部署步驟（只需做一次）

1. 到 https://aistudio.google.com 用 Google 帳號申請 Gemini API 金鑰（免費層不用信用卡）。**金鑰不要貼進任何對話或檔案。**
2. 註冊 Cloudflare 帳號（免費）：https://dash.cloudflare.com/sign-up
3. 在這個 `worker` 資料夾開終端機：

```
npx wrangler login
npx wrangler secret put GEMINI_API_KEY     # 貼上 Gemini 金鑰
npx wrangler secret put PASSCODE           # 自己想一組密語（建議 16 字以上）
npx wrangler deploy
```

4. 部署完會印出網址，像 `https://thesis-x-wright.<你的帳號>.workers.dev`。
5. 打開 App →「設定」→ DR. WRIGHT，貼上網址和通關密語，按 TEST 測試連線。

## 設定

- `ALLOWED_ORIGINS`（`wrangler.toml`）：允許呼叫的網站，預設 `https://maxwelivin.github.io`。
- `MODEL`：預設 `gemini-3.5-flash-lite`。若該型號改名或下架，在 `wrangler.toml` 的 `[vars]` 加 `MODEL = "新型號"` 再 `npx wrangler deploy`。
- 每日上限（選用）：`npx wrangler kv namespace create LIMITS`，把 id 填進 `wrangler.toml` 的 `[[kv_namespaces]]`（binding 必須叫 `KV`），預設每天 200 次，可用 `DAILY_LIMIT` 改。

## 換 AI 供應商

只改 `index.js` 裡的 `callModel()`；系統提示詞 `SYSTEM` 和工具定義 `TOOLS` 與供應商無關。

## 隱私

Gemini 免費層的內容可能被 Google 用來改進產品（見其定價頁）。App 只在你按送出時，傳送當前關卡的任務與近 12 則對話。
