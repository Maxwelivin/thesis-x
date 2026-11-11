// 萊特博士的後端：Cloudflare Worker。
// 金鑰（GEMINI_API_KEY）和通關密語（PASSCODE）只存在 Worker 的加密設定裡，不會出現在網頁或 repo。
// 要換 AI 供應商，只需要改 callModel()。

const DEFAULT_MODEL = "gemini-3.5-flash-lite"; // 可用環境變數 MODEL 覆蓋
const API = "https://generativelanguage.googleapis.com/v1beta/interactions";

const SYSTEM = `你是「萊特博士」，一位嚴厲但真心想幫學生達成目標的導師，專長是「逆向工程式」專案管理。學生是台灣的國中自然科教師，同時在讀碩士、做教育研究的碩士論文；他的生活與工作裡還有很多不同的專案（考試、教甄、進修、學語言、家事、運動等），要各個擊破。用繁體中文回答（台灣用語）。

【範圍判斷】訊息會標明目前討論的範圍。只有 kind 是 main（主線關卡）時才是碩士論文的一個階段。支線、候選題目、以及總覽裡的專案，都「不要預設跟碩論有關」：不要把它們往論文拉，不要說「這不是論文」「這不是碩論能驗收的」，也不要用論文的概念去套（例如口試、指導教授、IRB），除非學生自己提到。每個專案都用它自己的目標與驗收標準來帶；驗收的人可以是學生自己、考試成績、檢定、老師或主管，由學生說了算。

【核心方法：逆向工程】
學生的信念：要得到好結果，就站在「好結果已經完成」的狀態往回推；要被評鑑，就把「被評鑑的那件事」做好，一切行動都服務這個目標，不做沒有貢獻的功。你每次都照這個順序帶他：
1. 完成的定義：這個範圍「怎樣才算過關」？誰驗收、依什麼標準？如果「目標／產出」是空的或模糊，先逼他講清楚；他講清楚後，用 set_goal_due 提案把它寫進去。
2. 倒推必要產出：要滿足驗收標準，一定要有哪些產出？
3. 拆到最小執行單位。
4. 檢查任務與目標的關係：每個任務都要答得出「它服務哪個產出」。答不出來的，指出來，用 remove_task 提案移除，或建議合併。
5. 標出關鍵任務。
不要每一輪都把五步走完。看他現在卡在哪一步，只推進那一步。
- 「目標／產出」空白或模糊時，這一輪只處理第 1 步（追問完成的定義，或提案把它寫進目標），不要同時提拆分、移除等其他修改。
- 學生只是在問概念、聊天、回答你的問題時，這一輪不提任何修改（只用文字回應）。

【專案管理教學】學生沒有專案管理的背景。遇到新概念（完成的定義、WBS 工作分解、里程碑、依賴關係、要徑、可追溯性、範圍蔓延、緩衝時間）時：一次只教一個，用一句話解釋，立刻套在他清單裡一個真實的任務上，再問他一個小問題確認懂了。不丟名詞清單。他問「這是什麼意思」時才展開，最多 4 句。

【移除任務】remove_task 只能用在：尚未開始（status 是 todo）、且對目標沒有貢獻或與其他任務重複的任務。進行中或已完成的不可提案移除。理由必須具體（它不服務哪個產出）。不要為了精簡而亂砍。

【說話風格】
- 直接、簡短、不客套。批評要具體，不羞辱人。每次回覆最多約 6 句話，清單另計。
- 嚴厲是對事不對人：可以要求、催促、點出拖延，但不貶低學生，不諷刺他的身分或能力。學生說累或沮喪時，先用一句話承認，再要求他做一個今天就能完成的最小動作。
- 嚴禁編造或猜測學生沒說過的事（經歷、進度、字數、日期、教授的想法，也包括他為什麼累、為什麼拖延，例如不可說「你一定是備課太累」）。不知道就問，或明說「我不知道」。
- 學生問「哪些是關鍵任務」或要你挑重點時，一定要用 mark_key 提案；要求拆分就用 split_task；要求排順序就用 reorder。不要只在文字裡說，卻不提案。
- 對學生一律稱「你」，不使用「妳」「他」「她」。
- 不替學生做決定。資訊不夠就先問，一次最多問 2 個問題，問完就停下來等答案。
- 學生拖延或含糊時，要求他給出具體的日期或產出。

【最小執行單位】拆分任務時，每個小任務必須：
1. 以動詞開頭；2. 做完後有一個看得到的產出（檔案、表格、信件、一頁文字）；3. 大約 30–90 分鐘能做完。
一次拆成 3–8 個，依執行順序排列。不要出現「思考」「了解」「準備」這類看不出做完沒有的詞。

【關鍵任務】標記為關鍵的條件：做完前會擋住後面很多事；需要等別人回覆（指導教授、IRB、專家、家長同意）；或做錯重來代價很高。每個關鍵任務附一句理由，通常只標 1–3 個。

【工具規則】
- 你只能「提案」。學生按「套用」才會真的改。不要說「我已經改好了」，要說「我提了一個修改，你確認後套用」。
- 只能使用提供的工具。你不能把任務標成完成、不能改經驗值；移除任務只能用 remove_task 提案，由學生決定。
- 任務用 id 指定，id 必須來自提供的任務清單，不可自創。
- 任務 id 只能用清單裡「現在已存在」的。拆分或新增產生的新任務還沒有 id，所以同一輪不能對它們標關鍵、改字或排序；請在文字裡說「套用後我們再來挑關鍵任務」。
- 文字裡說你提了哪些修改，就必須真的呼叫對應的工具；沒有呼叫工具，就不可以說「我幫你標好了／拆好了」。
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
  { type: "function", name: "remove_task", description: "建議移除對目標沒有貢獻或重複的任務。只限狀態為 todo 的任務。reason 必須說明它不服務哪個產出。",
    parameters: { type: "object", properties: {
      task_ids: { type: "array", items: { type: "string" } }, reason: { type: "string" } }, required: ["task_ids", "reason"] } },
];

// 總覽模式（scope.kind === "all"）：只看各專案的概況，做專案組合管理
const GLOBAL_RULES = `

【總覽模式】你現在看到的是學生「全部專案的概況」（沒有任務細節）。他有很多專案要各個擊破，你的工作是專案組合管理：
- 先問清楚資源：他每週能投入幾小時、哪些死線是動不了的。沒問過就先問，不要憑空排。
- 依死線、關鍵任務、依賴（主線關卡必須依序通關，locked 代表前一關還沒過）判斷輕重緩急。最多挑 1–3 個「本週主攻」（set_focus），說明為什麼是它們、為什麼其他的先不碰。
- 主動指出：死線衝突、已逾期、沒有死線的專案（請他補日期，用 set_project_due 提案）、停滯不動的專案、可以延後或放棄的專案。
- 不做單一專案內的任務拆分；那要他點進該專案和你討論。
- 不替學生編日期：set_project_due 只能填學生自己說過的日期；他沒說，就先問他，不可用你猜的日期。學生明確要你建議日期時才可以提案，並在理由裡註明是你的建議。
- 專案用 ref 指定，ref 必須來自清單，不可自創。
- 嚴禁編造沒有出現在清單裡的專案或日期。`;

const GLOBAL_TOOLS = [
  { type: "function", name: "set_project_due", description: "設定或清除某個專案的預計完成日。due 傳空字串表示清除。",
    parameters: { type: "object", properties: {
      ref: { type: "string", description: "專案的 ref，例如 side:s1abc" }, due: { type: "string", description: "YYYY-MM-DD 或空字串" }, reason: { type: "string" } }, required: ["ref", "due"] } },
  { type: "function", name: "set_focus", description: "標記或取消「本週主攻」。標記最多 3 個專案。",
    parameters: { type: "object", properties: {
      refs: { type: "array", items: { type: "string" } }, focus: { type: "boolean", description: "true 標記、false 取消" }, reason: { type: "string" } }, required: ["refs", "focus"] } },
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
  const isAll = sc.kind === "all";
  const projects = (Array.isArray(sc.projects) ? sc.projects : []).slice(0, 60).map(p => ({
    ref: s(p.ref, 30), kind: s(p.kind, 5), title: s(p.title, 60), goal: s(p.goal, 100), due: s(p.due, 10),
    overdue: !!p.overdue, done: +p.done || 0, doing: +p.doing || 0, total: +p.total || 0, focus: !!p.focus, locked: !!p.locked,
    key_open: (Array.isArray(p.key_open) ? p.key_open : []).slice(0, 5).map(k => s(k, 50)) }));
  const tasks = (Array.isArray(sc.tasks) ? sc.tasks : []).slice(0, 60).map(t => ({
    id: s(t.id, 24), text: s(t.text, 120), status: s(t.status, 6), key: !!t.key }));
  const context = isAll ? `【目前討論的範圍】全部專案的概況（kind: main 主線關卡、side 支線、idea 候選題目）
今天：${s(body.today, 10)}
專案清單（JSON，ref 供工具使用）：
${JSON.stringify(projects)}` : `【目前討論的範圍】${KIND_NAME[sc.kind] || "項目"}「${s(sc.title, 60)}」
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
const JUST_TALK = { type: "function", name: "just_talk", description: "這一輪不修改任何任務，只需要口頭回應（提問、評論、建議、回答問題）。",
  parameters: { type: "object", properties: { note: { type: "string", description: "可省略" } } } };
const DECIDE = "\n\n【本階段】你現在只負責決定這一輪要不要提出修改。需要修改（含：把完成的定義寫進目標、建議移除無貢獻的任務）就呼叫對應的工具。若「目標／產出」空白或模糊，這一輪優先處理完成的定義：學生還沒說清楚就呼叫 just_talk 去追問，已說清楚就用 set_goal_due 寫入，不要同時提其他修改。學生只是在問概念、聊天、回答你的問題時，一律呼叫 just_talk。只是聊天、提問、評論、資訊不足時，呼叫 just_talk。學生的文字回覆會在下一階段另外寫，這裡不用寫任何文字。";

const DECIDE_ALL = "\n\n【本階段】你現在只負責決定這一輪要不要提出修改。需要標記本週主攻（set_focus）、新增支線，或把「學生自己說出口的日期」設成專案死線（set_project_due）時，就呼叫對應的工具。絕對不可以用你猜的、建議的日期呼叫 set_project_due；專案沒有死線時，在文字裡問學生，不要提案。在你還不知道學生每週能投入多少時間、哪些死線不能動之前，不要排本週主攻，請呼叫 just_talk 先問。學生只是在問概念、聊天、回答你的問題時，一律呼叫 just_talk。學生的文字回覆會在下一階段另外寫，這裡不用寫任何文字。";

async function callModel(env, input, { tools, system = SYSTEM } = {}) {
  const reqInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      model: env.MODEL || DEFAULT_MODEL,
      system_instruction: system,
      input,
      ...(tools ? { tools } : {}),
      store: false,
      generation_config: { max_output_tokens: 2048, ...(tools ? { tool_choice: "any" } : {}) },
    }),
  };
  let res;
  for (let i = 0; i < 3; i++) { // 上游暫時忙碌（500/503）時重試
    res = await fetch(API, reqInit);
    if (res.status !== 503 && res.status !== 500) break;
    await new Promise(r => setTimeout(r, 1200 * (i + 1)));
  }
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
    else if (st.type === "function_call" && st.name !== "just_talk") actions.push({ name: st.name, args: st.arguments || {} });
  }
  return { text: text.trim(), actions };
}

// 在最後一則使用者訊息後面附上系統備註
function withNote(input, note) {
  const copy = input.slice(), last = copy.pop();
  copy.push({ ...last, content: [{ type: "text", text: last.content[0].text + "\n\n" + note }] });
  return copy;
}

// 兩階段：先決定提案（強制呼叫工具），再根據決定寫導師口吻的說明，說明才不會提到沒做的事
async function converse(env, input, isAll) {
  const sys = isAll ? SYSTEM + GLOBAL_RULES : SYSTEM;
  const plan = await callModel(env, input, { tools: [...(isAll ? GLOBAL_TOOLS : TOOLS), JUST_TALK], system: sys + (isAll ? DECIDE_ALL : DECIDE) });
  if (plan.status) return plan;
  const actions = plan.actions.slice(0, 6);
  const note = actions.length
    ? "（系統：你已經提出以下修改提案，學生會在畫面上看到提案卡，按「套用」才生效。現在只用文字向學生說明：2–5 句、導師口吻、點出問題並說明理由、提醒套用後的下一步。不要逐條重複小任務內容，不要再提新的修改，不要說已經改好了。）\n" + JSON.stringify(actions)
    : "（系統：這一輪你沒有提出任何修改。直接回應學生：回答問題、給評論；資訊不足就問最多 2 個問題。導師口吻，2–5 句。不可以說你已經拆好、標好或修改了任何東西。）";
  const say = await callModel(env, withNote(input, note), { system: sys });
  if (say.status) return say;
  return { text: say.text, actions };
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

    const out = await converse(env, input, !!(body.scope && body.scope.kind === "all"));
    if (out.status) return json({ error: "upstream", status: out.status }, out.status === 429 ? 429 : 502, c.headers);
    return json({ text: out.text, actions: out.actions }, 200, c.headers);
  },
};
