// services/geminiService.ts
import { GoogleGenerativeAI, type Content } from "@google/generative-ai";
import type { UserProfile, Portfolio, DiaryEntry } from "../types";
import { PERSONA_DETAILS } from "../constants";

/**
 * NOTE
 * - This file is written to NEVER cause infinite loading in UI:
 *   → It always throws errors quickly with a user-readable message.
 * - UI must wrap calls with try/catch/finally and always clear loading in finally.
 */

// Vite: only VITE_* env vars are exposed to client
const apiKey = import.meta.env.VITE_API_KEY as string;
const hasApiKey = apiKey && apiKey.trim().length > 0;
const genAI = hasApiKey ? new GoogleGenerativeAI(apiKey) : null;

// GPT (mlapi.run) base URL & key for dashboard content generation
const mlBaseUrl = (import.meta.env.VITE_MLAPI_BASE_URL as string | undefined)?.replace(/\/+$/, "");
const mlApiKey = import.meta.env.VITE_SENTIMENT_API_KEY as string | undefined;

// (구) 외부 감성분석 직접 호출은 제거하고, 백엔드 프록시 (/api/news-sentiment) 를 사용

function model(name = "gemini-2.5-flash") {
  if (!genAI) {
    throw new Error("Gemini API key is not configured. Please set VITE_API_KEY in .env.local");
  }
  return genAI.getGenerativeModel({ model: name });
}

/* -----------------------------
 * Utilities
 * ----------------------------- */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Try to parse Gemini "Please retry in XXs." hints.
function parseRetryAfterSeconds(err: any): number | null {
  const msg = String(err?.message || err);
  const m = msg.match(/retry in\s+([0-9.]+)s/i);
  if (!m?.[1]) return null;
  const sec = Number(m[1]);
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return Math.ceil(sec);
}

function isRateLimitOrQuota(err: any): boolean {
  const msg = String(err?.message || err);
  const low = msg.toLowerCase();
  return (
    msg.includes("429") ||
    low.includes("quota") ||
    low.includes("rate limit") ||
    low.includes("rate-limit") ||
    low.includes("too many requests")
  );
}

function isOverloadedOrTransient(err: any): boolean {
  const msg = String(err?.message || err);
  const low = msg.toLowerCase();
  return (
    msg.includes("503") ||
    low.includes("overloaded") ||
    low.includes("timeout") ||
    low.includes("network") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("504")
  );
}

/**
 * Normalize errors to a message your UI can show.
 * IMPORTANT: We intentionally keep "429" in the message so UI can detect it.
 */
function toUserFacingError(err: any): Error {
  const msg = String(err?.message || err);

  if (isRateLimitOrQuota(err)) {
    const sec = parseRetryAfterSeconds(err) ?? 60;
    return new Error(`429: Rate limited. Please retry in ${sec}s.`);
  }

  if (isOverloadedOrTransient(err)) {
    return new Error("503: The AI service is temporarily overloaded. Please try again soon.");
  }

  return new Error(`AI_ERROR: ${msg}`);
}

function looksCutOff(text: string, minChars = 80) {
  const t = (text || "").trim();
  if (!t) return true;
  if (t.length < minChars) return true;
  if (!/[.!?]["')\]]?$/.test(t)) return true;
  return false;
}

/* -----------------------------
 * Core generator with safe retry
 * ----------------------------- */
async function generateWithRetry(
  prompt: string,
  opts?: { maxTokens?: number; temperature?: number; maxRetries?: number }
): Promise<string> {
  const maxOutputTokens = opts?.maxTokens ?? 320;
  const temperature = opts?.temperature ?? 0.6;
  const maxRetries = opts?.maxRetries ?? 1;

  let lastErr: any = null;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      const res = await model("gemini-2.5-flash").generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens },
      });

      const text = (res.response.text() || "").trim();
      if (!text) throw new Error("Empty model response.");
      return text;
    } catch (err) {
      lastErr = err;

      if (isRateLimitOrQuota(err)) {
        if (i < maxRetries) {
          const sec = parseRetryAfterSeconds(err);
          // keep UI snappy; don't sleep too long even if retry hint says longer
          const waitMs = sec ? Math.min(sec * 1000, 1200) : 600;
          await sleep(waitMs);
          continue;
        }
        throw toUserFacingError(err);
      }

      if (isOverloadedOrTransient(err) && i < maxRetries) {
        await sleep(450 + i * 250);
        continue;
      }

      throw toUserFacingError(err);
    }
  }

  throw toUserFacingError(lastErr);
}

async function callMlChat(prompt: string, maxTokens: number): Promise<string> {
  if (!mlBaseUrl || !mlApiKey) {
    throw new Error(
      "GPT sentiment API is not configured. Please set VITE_MLAPI_BASE_URL and VITE_SENTIMENT_API_KEY in .env.local"
    );
  }

  const url = `${mlBaseUrl}/chat/completions`;

  const body = {
    model: "openai/gpt-5-nano",
    messages: [{ role: "user", content: prompt }],
    // ✅ 서버가 max_completion_tokens를 무시하는 경우가 많아서 둘 다 보냄
    max_completion_tokens: maxTokens,
    stream: false,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${mlApiKey}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text().catch(() => "");

  // ✅ HTTP 레벨부터 로그
  console.groupCollapsed("%c[MLAPI][chat] response", "color:#2563eb;font-weight:700");
  console.log("url:", url);
  console.log("status:", res.status, res.statusText);
  console.log("raw preview:", raw.slice(0, 600));
  console.groupEnd();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${raw || res.statusText}`);
  }

  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`GPT returned non-JSON. Preview: ${raw.slice(0, 240)}`);
  }

  // ✅ 응답 구조 로그 (content 비어있을 때 원인 찾기용)
  const choice = data?.choices?.[0];
  const finishReason = choice?.finish_reason;
  console.groupCollapsed("%c[MLAPI][chat] parsed", "color:#16a34a;font-weight:700");
  console.log("finish_reason:", finishReason);
  console.log("choice keys:", choice ? Object.keys(choice) : null);
  console.log("message keys:", choice?.message ? Object.keys(choice.message) : null);
  console.log("full data preview:", JSON.stringify(data).slice(0, 900));
  console.groupEnd();

  // 1) 표준: message.content (string)
  const content = choice?.message?.content;

  if (typeof content === "string") {
    const trimmed = content.trim();
    if (!trimmed) throw new Error(`Empty GPT response content. finish_reason=${finishReason || "unknown"}`);
    return trimmed;
  }

  // 2) content가 배열로 오는 케이스 (파트 리스트)
  if (Array.isArray(content)) {
    const joined = content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .join("")
      .trim();

    if (!joined) throw new Error(`Empty GPT response content[]. finish_reason=${finishReason || "unknown"}`);
    return joined;
  }

  // 3) 일부 서버는 choices[0].text 로 줄 때도 있음
  if (typeof choice?.text === "string") {
    const trimmed = choice.text.trim();
    if (!trimmed) throw new Error(`Empty GPT choice.text. finish_reason=${finishReason || "unknown"}`);
    return trimmed;
  }

  // 4) 여기까지 오면 구조가 예상 밖 → 전체를 에러로 던져서 디버그
  throw new Error(`Unsupported GPT response format. Preview: ${JSON.stringify(data).slice(0, 600)}`);
}



/* -----------------------------
 * JSON extraction (no code fences)
 * ----------------------------- */
function stripCodeFences(text: string): string {
  const t = String(text || "").trim();
  if (!t) return "";
  if (t.startsWith("```")) {
    const withoutFirst = t.replace(/^```[a-zA-Z0-9]*\s*/m, "");
    const withoutLast = withoutFirst.replace(/```$/m, "");
    return withoutLast.trim();
  }
  return t;
}

/**
 * 텍스트에서 "첫 번째 JSON 블록" (object 또는 array)을 찾아 파싱
 * - 문자열/이스케이프 고려해서 괄호 매칭
 */
function extractFirstJsonValue(text: string): any {
  const cleaned = stripCodeFences(text);

  // 1) 전체가 JSON이면 바로 파싱
  try {
    return JSON.parse(cleaned);
  } catch {
    // fallthrough
  }

  const firstObj = cleaned.indexOf("{");
  const firstArr = cleaned.indexOf("[");
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);

  if (start === -1) {
    const preview = cleaned.slice(0, 240);
    throw new Error(`Model did not return JSON. Preview: ${preview}`);
  }

  const openChar = cleaned[start];
  const closeChar = openChar === "{" ? "}" : "]";

  let i = start;
  let depth = 0;
  let inStr = false;
  let escaped = false;

  for (; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }

    if (ch === '"') {
      inStr = true;
      continue;
    }

    if (ch === openChar) depth++;
    if (ch === closeChar) depth--;

    if (depth === 0) {
      const jsonStr = cleaned.slice(start, i + 1).trim();
      return JSON.parse(jsonStr);
    }
  }

  const preview = cleaned.slice(start, Math.min(cleaned.length, start + 300));
  throw new Error(`JSON seems cut off. Preview: ${preview}`);
}

/* -----------------------------
 * Public APIs
 * ----------------------------- */

export const generateFinancialAdvice = async (
  history: Content[],
  user: UserProfile,
  portfolio: Portfolio
): Promise<string> => {
  const persona = PERSONA_DETAILS[user.persona];
  const holdingsSummary =
    portfolio.assets
      .map((a) => `${a.quantity} shares of ${a.symbol} (Avg: $${a.avg_price.toFixed(2)})`)
      .join(", ") || "No current holdings";

  const systemInstruction = `
You are FinGuide, an AI financial mentor.
Persona: ${persona.label} (${persona.description})
Goal: ${user.goal}
Risk Tolerance: ${user.risk_tolerance}
Portfolio: Cash $${portfolio.cash.toFixed(2)}, Holdings [${holdingsSummary}]
Tone: ${persona.advice}
Keep responses concise, encouraging, and educational. No direct "buy now" advice; present options to consider.
`.trim();

  try {
    const res = await model("gemini-2.5-flash").generateContent({
      contents: history ?? [],
      systemInstruction,
      generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
    });
    const text = (res.response.text() || "").trim();
    if (!text) throw new Error("Empty model response.");
    return text;
  } catch (err) {
    throw toUserFacingError(err);
  }
};

/* -----------------------------------------
 * ✅ Weekly Report (2-step to avoid cut-off)
 *    - Prefer GPT (mlapi) to avoid Gemini quota/truncation
 * ----------------------------------------- */
/* -----------------------------------------
 * ✅ Weekly Report (GPT-only, 2-step)
 *   - Uses VITE_MLAPI_BASE_URL + (VITE_GPT_API_KEY || GPT_API_KEY)
 * ----------------------------------------- */
// services/geminiService.ts
// Weekly report generator (OpenAI)
// - Called from Diary.tsx via dynamic import: generateWeeklyReport(payload)
// - Uses Vite env: VITE_GPT_API

type WeeklyReportPayload = {
  weekRange?: string;
  metrics?: any;
  entries?: any[];
  persona?: any;
};

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

/** Read API key safely (Vite env) */
function getApiKey(): string {
  // Primary: VITE_GPT_API (as you said)
  const raw =
    (import.meta as any).env?.VITE_GPT_API ??
    // Optional fallback (in case you renamed at some point)
    (import.meta as any).env?.VITE_GPT_API_KEY ??
    (import.meta as any).env?.VITE_OPENAI_API_KEY;

  const apiKey = String(raw ?? "").trim();

  // Guard: prevents "Bearer undefined" → 401 verification_failed_key
  if (!apiKey || apiKey === "undefined" || apiKey === "null") {
    throw new Error(
      `Missing OpenAI API key. Set VITE_GPT_API in .env.local and restart dev server. (current="${String(raw)}")`
    );
  }
  return apiKey;
}

/** Small utility: avoid sending huge payloads */
function compactPayload(payload: WeeklyReportPayload) {
  const safe: WeeklyReportPayload = {
    weekRange: payload?.weekRange ?? "",
    metrics: payload?.metrics ?? {},
    persona: payload?.persona ?? undefined,
    entries: Array.isArray(payload?.entries) ? payload.entries : [],
  };

  // Limit entries to keep prompts small (prevents truncation/cutoff)
  const entries = safe.entries ?? [];
  const MAX_ENTRIES = 20;

  const trimmed = entries
    .slice()
    .sort((a: any, b: any) => new Date(a?.date).getTime() - new Date(b?.date).getTime())
    .slice(-MAX_ENTRIES)
    .map((e: any) => ({
      date: e?.date,
      emotion: e?.emotion,
      reason: e?.reason,
      related_symbol: e?.related_symbol,
      trade_type: e?.trade_type,
      trade_qty: e?.trade_qty,
      trade_price: e?.trade_price,
      recheck_pct: e?.recheck_pct,
      what_if: e?.what_if ? String(e.what_if).slice(0, 400) : "",
      note: e?.note ? String(e.note).slice(0, 600) : "",
    }));

  safe.entries = trimmed;
  return safe;
}

function safeJsonStringify(obj: any) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    // last resort
    return String(obj);
  }
}

/**
 * ✅ Main function: called by Diary.tsx
 * Returns: string (markdown) to render in <pre>
 */
export async function generateWeeklyReport(payload: WeeklyReportPayload): Promise<string> {
  const apiKey = getApiKey();
  const compact = compactPayload(payload);

  const weekRange = compact.weekRange || "(unknown week)";
  const entriesCount = Array.isArray(payload?.entries) ? payload!.entries!.length : 0;
  const usedEntriesCount = Array.isArray(compact.entries) ? compact.entries.length : 0;

  // System: style & constraints to prevent overly long output
  const system = [
    "You are an investing diary coach. Produce a weekly report in Korean.",
    "Output MUST be markdown and short enough to fit without truncation.",
    "No JSON. No code fences. No backticks. Avoid very long paragraphs.",
    "Use concrete, actionable bullets. Be supportive but not overly verbose.",
    "If there is little data, say so and give a minimal plan for next week.",
  ].join(" ");

  // User prompt includes metrics + entries
  const user = [
    `주간 투자일지 리포트를 생성해줘.`,
    `주간 범위: ${weekRange}`,
    ``,
    `요청 컨텍스트(요약):`,
    `- 원본 entries 수: ${entriesCount}`,
    `- LLM에 전달된 entries 수(최근 ${usedEntriesCount}개): ${usedEntriesCount}`,
    ``,
    `아래 데이터를 근거로 리포트를 작성해줘.`,
    `리포트 구성(섹션 제목 그대로 사용):`,
    `1) 이번 주 한 줄 요약`,
    `2) 지표 요약 (Coverage/Goal/Patterns 해석)`,
    `3) 잘한 점 (2~4개)`,
    `4) 리스크/경고 (2~4개)`,
    `5) 다음 주 액션 플랜 (딱 5개, 체크리스트)`,
    `6) Recheck 트리거가 있는 종목이 있다면: 무엇을 확인할지 질문 3개`,
    ``,
    `데이터(JSON):`,
    safeJsonStringify(compact),
  ].join("\n");

  const body = {
    model: "gpt-5-nano",
    max_tokens: 500, // 길이 제한 (cut-off 방지)
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  // Timeout (avoid hanging)
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // If API returns non-JSON for some reason
      if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${text}`);
      return text;
    }

    if (!res.ok) {
      const msg =
        json?.error?.message ||
        json?.message ||
        `OpenAI error ${res.status}: ${text}`;
      throw new Error(msg);
    }

    const content = json?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();

    // Fallback: if structure differs
    return safeJsonStringify(json);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error("Weekly report generation timed out. Try again.");
    }
    throw new Error(String(err?.message || err));
  } finally {
    window.clearTimeout(timeoutId);
  }
}





export const generateDiaryFeedback = async (
  entry: DiaryEntry,
  user: UserProfile,
  recentTxs: any[] = [],
  recentDiaryLite: any[] = []
): Promise<string> => {
  const persona = PERSONA_DETAILS[user.persona];

  const compactTxs = (recentTxs || []).slice(0, 12);
  const compactDiary = (recentDiaryLite || []).slice(0, 8);

  const basePrompt = `
You are a practical trading coach speaking directly to the user.
Write in a supportive, realistic tone. No price predictions. No buy/sell calls.

Style rules:
- Use 2nd person ("you").
- Exactly 4 sentences, under 90 words total.
- No bullet points.
- End the final sentence with a period.

Context:
Persona: ${persona.label}
Emotion: ${entry.emotion}
Driver: ${entry.reason}
Ticker: ${entry.related_symbol || "N/A"}
Note: "${(entry.note || "").slice(0, 800)}"
Recent transactions (latest first): ${JSON.stringify(compactTxs)}
Recent diary patterns: ${JSON.stringify(compactDiary)}
`.trim();

  try {
    let text = await generateWithRetry(basePrompt, { maxTokens: 220, temperature: 0.6, maxRetries: 1 });

    if (looksCutOff(text, 70)) {
      const rewritePrompt =
        basePrompt +
        `

Your previous answer was cut off or too short.
Rewrite fully as exactly 4 complete sentences, under 90 words, and end with a period.
`.trim();

      text = await generateWithRetry(rewritePrompt, { maxTokens: 240, temperature: 0.6, maxRetries: 1 });
    }

    const out = (text || "").trim();
    if (!out) throw new Error("Empty model response.");
    return out;
  } catch (err) {
    throw toUserFacingError(err);
  }
};

/* -----------------------------
 * Dashboard: 5-minute learning & quizzes
 * ----------------------------- */

export type LearningCard = {
  id: number;
  title: string;
  duration: string;
  category: string;
  content: string;
};

export type DashboardQuiz = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export const generateDashboardLearningCards = async (count: number = 3, seed?: number): Promise<LearningCard[]> => {
  const safeCount = Math.max(1, Math.min(12, Math.floor(count)));
  const params = new URLSearchParams();
  params.set("count", String(safeCount));
  if (typeof seed === "number") params.set("seed", String(seed));

  try {
    const res = await fetch(`http://localhost:5002/api/dashboard-learning?${params.toString()}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Dashboard learning HTTP error ${res.status}: ${body || "<empty>"}`);
    }
    const data: any = await res.json();
    const rawCards = data?.cards;
    if (!Array.isArray(rawCards) || rawCards.length === 0) {
      throw new Error("Backend returned empty learning cards array.");
    }

    const cards: LearningCard[] = [];
    rawCards.forEach((item: any) => {
      if (!item || typeof item !== "object") return;
      const title = String(item.title || "").trim();
      const duration = String(item.duration || "5 min").trim();
      const category = String(item.category || "Learning").trim();
      const content = String(item.content || "").trim();
      if (!title || !content) return;
      cards.push({
        id: Number(item.id) || cards.length + 1,
        title,
        duration,
        category,
        content,
      });
    });

    if (!cards.length) {
      throw new Error("No valid learning cards extracted from backend output.");
    }

    return cards;
  } catch (err) {
    throw toUserFacingError(err);
  }
};

export const generateDashboardQuizzes = async (count: number = 3, seed?: number): Promise<DashboardQuiz[]> => {
  const safeCount = Math.max(1, Math.min(20, Math.floor(count)));
  const params = new URLSearchParams();
  params.set("count", String(safeCount));
  if (typeof seed === "number") params.set("seed", String(seed));

  try {
    const res = await fetch(`http://localhost:5002/api/dashboard-quizzes?${params.toString()}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Dashboard quizzes HTTP error ${res.status}: ${body || "<empty>"}`);
    }
    const data: any = await res.json();
    const rawQuizzes = data?.quizzes;
    if (!Array.isArray(rawQuizzes) || rawQuizzes.length === 0) {
      throw new Error("Backend returned empty quizzes array.");
    }

    const quizzes: DashboardQuiz[] = [];
    rawQuizzes.forEach((q: any) => {
      if (!q || typeof q !== "object") return;
      const question = String(q.question || "").trim();
      const options = Array.isArray(q.options) ? q.options.map((o: any) => String(o || "").trim()).filter(Boolean) : [];
      const correctIndex = Number.isInteger(q.correctIndex) ? Number(q.correctIndex) : -1;
      const explanation = String(q.explanation || "").trim();

      if (!question || options.length !== 4) return;
      if (correctIndex < 0 || correctIndex > 3) return;
      if (!explanation) return;

      quizzes.push({
        question,
        options,
        correctIndex,
        explanation,
      });
    });

    if (!quizzes.length) {
      throw new Error("No valid quizzes extracted from backend output.");
    }

    return quizzes;
  } catch (err) {
    throw toUserFacingError(err);
  }
};

type Sentiment = "positive" | "negative" | "neutral";

function ruleBasedNewsSentiment(text: string): Sentiment {
  const lower = text.toLowerCase();

  const positiveKeywords = [
    "surge","soar","rally","jump","spike","record high","all-time high",
    "beat expectations","beats expectations","beat estimates","beats estimates",
    "strong growth","strong demand","solid growth","better than expected",
    "raises guidance","hikes guidance","upgrade","upgraded","buy rating",
    "outperform","overweight","bullish","profit surge","rebound","recovery",
    "top gainer","optimistic","beats on earnings","strong quarter",
    "to buy","worth buying","buy now","top pick","could double","multi-bagger",
  ];

  const negativeKeywords = [
    "plunge","plunges","slump","slumps","tumble","tumbles","fall","falls","drop","drops",
    "sink","sinks","tank","tanks","crash","crashes","miss expectations","misses expectations",
    "miss estimates","misses estimates","weak demand","slowdown","decline","loss","losses",
    "cut guidance","cuts guidance","downgrade","downgraded","underperform","miss","warning",
    "profit warning","lawsuit","scandal","probe","investigation","regulatory","fine",
    "penalty","layoffs","job cuts","bankruptcy","concern","headwind",
  ];

  let score = 0;

  for (const kw of positiveKeywords) if (lower.includes(kw)) score += 1;
  for (const kw of negativeKeywords) if (lower.includes(kw)) score -= 1;

  if (lower.includes("up") || lower.includes("higher") || lower.includes("gain") || lower.includes("rise")) score += 0.5;
  if (lower.includes("down") || lower.includes("lower") || lower.includes("drop") || lower.includes("fall")) score -= 0.5;

  console.log("[Sentiment] Rule-based score:", score, "for text:", lower.substring(0, 160));

  if (score >= 0.5) return "positive";
  if (score <= -0.5) return "negative";
  return "neutral";
}

function parseSentimentFromApiResponse(data: any): Sentiment | null {
  if (!data) return null;

  const candidates: string[] = [];

  if (typeof data === "string") candidates.push(data);
  if (typeof data.label === "string") candidates.push(data.label);
  if (typeof (data as any).sentiment === "string") candidates.push((data as any).sentiment);
  if (typeof (data as any).result === "string") candidates.push((data as any).result);

  const probKeys = ["positive", "negative", "neutral"] as const;
  if (probKeys.every((k) => typeof (data as any)[k] === "number")) {
    const best = probKeys.reduce((prev, cur) => ((data as any)[cur] > (data as any)[prev] ? cur : prev));
    return best;
  }

  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (typeof first === "string") {
      candidates.push(first);
    } else if (first && typeof first.label === "string") {
      let best = first;
      if (typeof first.score === "number") {
        best = data.reduce(
          (acc: any, cur: any) => (typeof cur.score === "number" && cur.score > acc.score ? cur : acc),
          first
        );
      }
      candidates.push(best.label);
    }
  }

  for (const raw of candidates) {
    if (!raw || typeof raw !== "string") continue;
    const trimmed = raw.trim();
    const lower = trimmed.toLowerCase();

    if (lower === "positive") return "positive";
    if (lower === "negative") return "negative";
    if (lower === "neutral") return "neutral";

    if (lower.includes("긍정")) return "positive";
    if (lower.includes("부정")) return "negative";
    if (lower.includes("중립")) return "neutral";

    if (lower.includes("pos")) return "positive";
    if (lower.includes("neg")) return "negative";
    if (lower.includes("neu") || lower.includes("neutral")) return "neutral";
  }

  return null;
}

export const analyzeNewsSentiment = async (title: string, summary: string, relatedSymbols: string[]): Promise<Sentiment> => {
  try {
    const res = await fetch("http://localhost:5002/api/news-sentiment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, summary, symbols: relatedSymbols }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      console.error("[Sentiment] /api/news-sentiment error:", res.status, errorBody || "<empty body>");
      throw new Error(`News sentiment HTTP error: ${res.status}`);
    }

    const data = await res.json();
    const raw = String((data as any)?.sentiment || "").toLowerCase();
    if (raw === "positive" || raw === "negative" || raw === "neutral") return raw;

    console.warn("[Sentiment] Unknown sentiment label from backend, falling back to neutral:", raw);
    return "neutral";
  } catch (err) {
    console.error("[Sentiment] Backend sentiment error, using neutral fallback:", err);
    return "neutral";
  }
};
