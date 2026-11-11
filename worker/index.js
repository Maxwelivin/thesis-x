// 萊特博士的後端：Cloudflare Worker。
// 金鑰（GEMINI_API_KEY）和通關密語（PASSCODE）只存在 Worker 的加密設定裡，不會出現在網頁或 repo。
// 要換 AI 供應商，只需要改 callModel()。

const DEFAULT_MODEL = "gemini-3.5-flash-lite"; // 可用環境變數 MODEL 覆蓋
const API = "https://generativelanguage.googleapis.com/v1beta/interactions";

const SYSTEM = `你是「萊特博士」，一位嚴厲但真心想讓學生畢業的碩士論文導師。學生是台灣的國中自然科教師，正在做教育研究的碩士論文。用繁體中文回答（台灣用語）。

【說話風格】
- 直接、簡短、不客套。批評要具體，不羞辱人。每次回覆最多約 6 句話，清單另計。
- 不替學生做決定。資訊不夠就先問，一次最多問 2 個問題，問完就停下來等答案。
- 學生拖延或含糊時，要求他給出具體的日期或產出。

【最小執行單位】拆分任務時，每個小任務必須：
1. 以動詞開頭；2. 做完後有一個看得到的產出（檔案、表格、信件、一頁文字）；3. 大約 30–90 分鐘能做完。
一次拆成 3–8 個，依執行順序排列。不要出現「思考」「了解」「準備」這類看不出做完沒有的詞。

【關鍵任務】標記為關鍵的條件：做完前會擋住後面很多事；需要等別人回覆（指導教授、IRB、專家、家長同意）；或做錯重來代價很高。每個關鍵任務附一句理由，通常只標 1–3 個。

【工具規則】
- 你只能「提案」。學生按「套用」才會真的改。不要說「我已經改好了」，要說「我提了一個修改，你確認後套用」。
- 只能使用提供的工具。你不能把任務標成完成、不能刪除任務、不能改經驗值。
- 任務用 id 指定，id 必須來自提供的任務清單，不可自創。
- 沒把握就先問，不要硬提案。
- 工具的 reason 欄位寫一句給學生看的理由。
- 今天日期會附在訊息裡，預計完成日一律用 YYYY-MM-DD。`;

const TOOLS = [
  { type: "function", name: "split_task", description: "把一個尚未完成的任務拆成多個最小執行單位，取代原任務。",
    parameters: { type: "object", properties: {
      task_id: { type: "string", description: "要拆的任務 id" },
      subtasks: { type: "array", items: { type: "string" }, description: "3–8 個小任務，依順序" },
      reason: { type: "string" } }, required: ["task_id", "subtasks"] } },
  { type: "function", name: "add_tasks", description: "新增任務。after_task_id 省略則加在最後。",
    parameters: { type: "object", properties: {
      tasks: { type: "array", items: { type: "string" } },
      after_task_id: { type: "string" },
      reason: { type: "string" } }, required: ["tasks"] } },
  { type: "function", name: "mark_key", description: "標記或取消關鍵任務，並說明理由。",
    parameters: { type: "object", properties: {
      marks: { type: "array", items: { type: "object", properties: {
        task_id: { type: "string" }, key: { type: "boolean", description: "true 標記、false 取消" }, why: { type: "string", description: "為什麼它是關鍵（一句話）" } },
        required: ["task_id", "key"] } },
      reason: { type: "string" } }, required: ["marks"] } },
  { type: "function", name: "edit_task", description: "改寫一個任務的文字。",
    parameters: { type: "object", properties: {
      task_id: { type: "string" }, text: { type: "string" }, reason: { type: "string" } }, required: ["task_id", "text"] } },
  { type: "function", name: "reorder", description: "調整任務順序，task_ids 依新順序排列。",
    parameters: { type: "object", properties: {
      task_ids: { type: "array", items: { type: "string" } }, reason: { type: "string" } }, required: ["task_ids"] } },
  { type: "function", name: "set_goal_due", description: "修改這個關卡的目標／產出說明或預計完成日。due 傳空字串表示清除。",
    parameters: { type: "object", properties: {
      goal: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD 或空字串" }, reason: { type: "string" } } } },
  { type: "function", name: "create_side", description: "新增一條支線，附上任務。",
    parameters: { type: "object", properties: {
      title: { type: "string" }, goal: { type: "string" },
      tasks: { type: "array", items: { type: "string" } }, reason: { type: "string" } }, required: ["title", "tasks"] } },
];

const KIND_NAME = { main: "主線關卡", side: "支線", idea: "候選題目（點子）" };

function cors(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || "https://maxwelivin.github.io").split(",").map(s => s.trim());
  const ok = allowed.includes(origin);
  return {
    ok,
    headers: {
      "Access-Control-Allow-Origin": ok ? origin : allowed[0],
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  };
}
const json = (obj, status, headers) => new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });

// 固定時間比較，避免從回應時間猜密語
function same(a, b) {
  const x = new TextEncoder().encode(a || ""), y = new TextEncoder().encode(b || "");
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

const s = (v, n) => String(v ?? "").slice(0, n);

function buildInput(body) {
  const sc = body.scope || {};
  const tasks = (Array.isArray(sc.tasks) ? sc.tasks : []).slice(0, 60).map(t => ({
    id: s(t.id, 24), text: s(t.text, 120), status: s(t.status, 6), key: !!t.key }));
  const context = `【目前討論的範圍】${KIND_NAME[sc.kind] || "項目"}「${s(sc.title, 60)}」
目標／產出：${s(sc.goal, 160) || "（未填）"}
預計完成：${s(sc.due, 10) || "（未設定）"}
今天：${s(body.today, 10)}
任務清單（JSON，id 供工具使用）：
${JSON.stringify(tasks)}`;
  const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-12)
    .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", text: s(m.text, 1500) })).filter(m => m.text);
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;
  // 範圍資訊放在最後一則使用者訊息前，每輪都用最新的任務清單
  const last = msgs.pop();
  const input = [
    ...msgs.map(m => ({ type: m.role === "user" ? "user_input" : "model_output", content: [{ type: "text", text: m.text }] })),
    { type: "user_input", content: [{ type: "text", text: context + "\n\n【學生說】" + last.text }] },
  ];
  return input;
}

// ── 供應商：Gemini Interactions API ──
async function callModel(env, input) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      model: env.MODEL || DEFAULT_MODEL,
      system_instruction: SYSTEM,
      input,
      tools: TOOLS,
      store: false,
      generation_config: { max_output_tokens: 2048 },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.log("gemini error", res.status, detail.slice(0, 500));
    return { status: res.status };
  }
  const data = await res.json();
  let text = "";
  const actions = [];
  for (const st of data.steps || []) {
    if (st.type === "model_output") text += (st.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    else if (st.type === "function_call") actions.push({ name: st.name, args: st.arguments || {} });
  }
  return { text: text.trim(), actions };
}

async function underLimit(env) {
  if (!env.KV) return true; // 沒綁 KV 就不做每日上限（Gemini 免費層本身也有限額）
  const key = "n:" + new Date().toISOString().slice(0, 10);
  const n = parseInt((await env.KV.get(key)) || "0", 10);
  if (n >= parseInt(env.DAILY_LIMIT || "200", 10)) return false;
  await env.KV.put(key, String(n + 1), { expirationTtl: 172800 });
  return true;
}

export default {
  async fetch(req, env) {
    const c = cors(env, req.headers.get("Origin") || "");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c.headers });
    // 瀏覽器來源檢查（擋掉別人的網頁）；沒有 Origin 的請求（curl）靠通關密語擋
    if (req.headers.get("Origin") && !c.ok) return json({ error: "origin" }, 403, c.headers);

    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!env.PASSCODE || !same(auth, env.PASSCODE)) return json({ error: "auth" }, 401, c.headers);

    if (req.method === "GET") return json({ ok: true, model: env.MODEL || DEFAULT_MODEL }, 200, c.headers);
    if (req.method !== "POST") return json({ error: "method" }, 405, c.headers);
    if (!env.GEMINI_API_KEY) return json({ error: "no_key" }, 500, c.headers);

    const len = parseInt(req.headers.get("Content-Length") || "0", 10);
    if (len > 60000) return json({ error: "too_large" }, 413, c.headers);
    let body;
    try { body = await req.json(); } catch (e) { return json({ error: "bad_json" }, 400, c.headers); }
    const input = buildInput(body || {});
    if (!input) return json({ error: "bad_request" }, 400, c.headers);

    if (!(await underLimit(env))) return json({ error: "daily_limit" }, 429, c.headers);

    const out = await callModel(env, input);
    if (out.status) return json({ error: "upstream", status: out.status }, out.status === 429 ? 429 : 502, c.headers);
    return json({ text: out.text, actions: out.actions }, 200, c.headers);
  },
};
