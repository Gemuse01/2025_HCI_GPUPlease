// services/geminiService.ts
import { GoogleGenerativeAI, type Content } from "@google/generative-ai";
import type { UserProfile, Portfolio, DiaryEntry } from "../types";
import { PERSONA_DETAILS } from "../constants";
import { apiUrl } from "./apiClient";

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

// Feature flag: enable/disable AI Mentor in‑chat micro‑surveys
const mentorSurveyEnabled =
  ((import.meta.env.VITE_MENTOR_SURVEY_ENABLED as string | undefined) ?? "true")
    .toLowerCase() === "true";

// GPT (mlapi.run) base URL & key for dashboard content generation
// URL: 프론트에서는 별도 VITE_* 없이, 백엔드와 동일한 기본값을 그대로 사용한다.
//   - yfinance_api.py 의 SENTIMENT_API_URL 기본값과 맞춰둠.
const rawMlBaseUrl =
  (process.env.SENTIMENT_API_URL as string | undefined) ??
  "https://mlapi.run/daef5150-72ef-48ff-8861-df80052ea7ac/v1";
const mlBaseUrl = rawMlBaseUrl.replace(/\/+$/, "");

// KEY: 프론트에서는 VITE_SENTIMENT_API_KEY 만 필수로 사용 (필요시 백엔드용 SENTIMENT_API_KEY 도 fallback)
const mlApiKey =
  (import.meta.env.VITE_SENTIMENT_API_KEY as string | undefined) ||
  (process.env.SENTIMENT_API_KEY as string | undefined);

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
  // "Please retry in 34.78s."
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

  // If Gemini tells you retry time, keep it.
  if (isRateLimitOrQuota(err)) {
    const sec = parseRetryAfterSeconds(err) ?? 60;
    return new Error(`429: Rate limited. Please retry in ${sec}s.`);
  }

  if (isOverloadedOrTransient(err)) {
    return new Error("503: The AI service is temporarily overloaded. Please try again soon.");
  }

  // Unknown
  return new Error(`AI_ERROR: ${msg}`);
}

function looksCutOff(text: string, minChars = 80) {
  const t = (text || "").trim();
  if (!t) return true;
  if (t.length < minChars) return true;
  // if it doesn't end like a finished sentence, might be cut off
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

  // Keep retries LOW to avoid burning quota (and triggering more 429s).
  const maxRetries = opts?.maxRetries ?? 1; // 0 or 1 is usually best on client

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

      // If rate-limited, do NOT keep retrying many times.
      if (isRateLimitOrQuota(err)) {
        // Optional: wait a tiny bit once, but don't loop.
        if (i < maxRetries) {
          const sec = parseRetryAfterSeconds(err);
          const waitMs = sec ? Math.min(sec * 1000, 1200) : 600;
          await sleep(waitMs);
          continue;
        }
        throw toUserFacingError(err);
      }

      // transient overload: allow small backoff retry
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
      "GPT sentiment API is not configured. Please set VITE_SENTIMENT_API_KEY in .env.local"
    );
  }

  const res = await fetch(`${mlBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${mlApiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-5-nano",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      // NOTE:
      // - Do NOT pass max_completion_tokens here.
      // - On this mlapi.run deployment, forcing max_completion_tokens sometimes makes
      //   the model return an empty string for message.content (see yfinance_api.py call_openai_json).
      // - We keep maxTokens in the function signature for future tuning, but rely on
      //   the server-side default token limits for now.
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  const data: any = await res.json();
  const choice = data?.choices?.[0];

  // 안전한 기본 답변 (API 응답이 비어 있을 때 사용)
  const fallback =
    "I don’t have anything reliable to add right now. Please try asking your question in a slightly different way, or narrow it down to one concrete situation.";

  if (!choice) {
    console.warn("[callMlChat] Empty choices in GPT response, returning fallback.");
    return fallback;
  }

  const content = choice?.message?.content;
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (!trimmed) {
      console.warn("[callMlChat] Empty string content in GPT response, returning fallback.");
      return fallback;
    }
    return trimmed;
  }

  // content 가 배열(part) 형태일 가능성도 방어
  if (Array.isArray(content)) {
    const joined = content
      .map((part: any) => (typeof part === "string" ? part : String(part?.text || "")))
      .join("")
      .trim();
    if (!joined) {
      console.warn("[callMlChat] Empty array content in GPT response, returning fallback.");
      return fallback;
    }
    return joined;
  }

  console.warn("[callMlChat] Unsupported GPT response format, returning fallback:", content);
  return fallback;
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

  // Flatten Gemini-style history into a simple chat transcript for the mlapi.run model.
  const conversation = (history || [])
    .map((msg) => {
      const role = msg.role === "user" ? "User" : "Mentor";
      const textParts = (msg.parts || [])
        .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join(" ");
      return `${role}: ${textParts}`;
    })
    .join("\n");

  const surveyInstructions = mentorSurveyEnabled
    ? `
Optional micro‑survey behaviour (only when it feels natural in the conversation):
- Every 3–5 messages, you MAY ask ONE short "check‑in" question to better understand the user's style.
- Base these questions on four investor types:
  1) Help Seeker: actively looks for support and guidance, sometimes comfortable using leverage.
  2) Solo Struggler: tries to handle everything alone, rarely asks for help, can feel overwhelmed.
  3) Optimist: generally positive and opportunity‑seeking, but may take financial risks quickly.
  4) Motivation Seeker: low energy and follow‑through, tends to delay or avoid decisions.
- Ask only single‑sentence questions that can be answered in a few words (no long forms, no numbered survey pages).
- Tailor questions to the persona: e.g. with Help Seekers ask when they usually reach out; with Solo Strugglers ask when they hesitate to ask for help; with Optimists ask how they balance excitement vs. risk; with Motivation Seekers ask what makes it easier to take one small step.
- Do NOT ask a micro‑survey question in every reply; only when it does not interrupt an urgent question.
- When the user answers, quietly adjust your tone and explanations to match what they told you, but do NOT label them explicitly as a "type".
`
    : "";

  const prompt = `
You are FinGuide, an AI financial mentor for a paper-trading / practice environment.

User profile:
- Persona: ${persona.label} (${persona.description})
- Goal: ${user.goal}
- Risk tolerance: ${user.risk_tolerance}
- Portfolio: Cash $${portfolio.cash.toFixed(2)}, Holdings [${holdingsSummary}]

Tone and constraints:
- Speak directly to the user in the 2nd person ("you").
- Be supportive, realistic, and beginner-friendly. Remind them this is a safe practice account when appropriate.
- Always respond in clear, simple English, even if the user writes in Korean or another language.
- Explain concepts clearly and avoid jargon where possible.
- Do NOT give direct "buy now" or "sell now" instructions. Instead, explain trade-offs and options.
- Keep answers focused and under about 220–260 words unless the user explicitly asks for something longer.
${surveyInstructions}

Conversation so far:
${conversation}

Now respond as FinGuide to the user's last message.
`.trim();

  try {
    const text = await callMlChat(prompt, 800);
    const trimmed = (text || "").trim();
    if (!trimmed) {
      console.warn("[generateFinancialAdvice] Empty response from GPT, returning fallback.");
      return "I don’t have a detailed answer right now, but remember this is a safe practice environment. Try asking about one concrete position, plan, or concern at a time so we can work through it together.";
    }
    return trimmed;
  } catch (err) {
    console.error("[generateFinancialAdvice] AI error, returning fallback:", err);
    return "I’m having trouble generating a full answer right now. Nothing in this practice account is at risk, so feel free to rephrase your question or ask about a smaller, specific decision instead.";
  }
};


export const generateDiaryFeedback = async (
  entry: DiaryEntry,
  user: UserProfile,
  recentTxs: any[] = [],
  recentDiaryLite: any[] = []
): Promise<string> => {
  const persona = PERSONA_DETAILS[user.persona];

  // Keep context small to reduce token usage (less likely to hit quota)
  const compactTxs = (recentTxs || []).slice(0, 12);
  const compactDiary = (recentDiaryLite || []).slice(0, 8);

  const basePrompt = `
You are a practical trading coach speaking directly to the user.
Write in a supportive, realistic tone. No price predictions. No buy/sell calls.

Style rules:
- Use 2nd person ("you").
- Respond in clear, simple English (even if the user's note is in Korean or another language).
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
    // ✅ Diary feedback도 GPT(mlapi.run) 기반으로 생성
    let text = await callMlChat(basePrompt, 260);

    // 답변이 잘려 보이면 한 번만 재작성 요청
    if (looksCutOff(text, 70)) {
      const rewritePrompt =
        basePrompt +
        `

Your previous answer was cut off or too short.
Rewrite fully as exactly 4 complete sentences, under 90 words, and end with a period.
`.trim();

      text = await callMlChat(rewritePrompt, 260);
    }

    const out = (text || "").trim();
    if (!out) throw new Error("Empty model response.");
    return out;
  } catch (err) {
    // IMPORTANT: Throw so Diary.tsx can stop spinner in finally (no infinite loading)
    throw toUserFacingError(err);
  }
};

// Weekly AI coach summary for diary entries (last 7 days)
export const generateWeeklyDiarySummary = async (
  user: UserProfile,
  diary: DiaryEntry[],
  transactions: any[] = []
): Promise<string> => {
  const persona = PERSONA_DETAILS[user.persona];

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const recentDiary = (diary || []).filter((d) => {
    const dt = new Date(d.date as any);
    if (Number.isNaN(dt.getTime())) return false;
    return dt >= sevenDaysAgo && dt <= now;
  });

  if (!recentDiary.length) {
    return "You don’t have any diary entries in the last 7 days yet. Once you’ve logged a week of notes, I can generate a weekly coach summary here.";
  }

  const compactDiary = recentDiary
    .slice()
    .sort((a, b) => new Date(a.date as any).getTime() - new Date(b.date as any).getTime())
    .slice(-30)
    .map((d) => ({
      date: d.date,
      emotion: d.emotion,
      reason: d.reason,
      related_symbol: d.related_symbol,
      note: (d.note || "").slice(0, 260),
    }));

  const compactTxs = (transactions || [])
    .slice()
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 40)
    .map((tx: any) => ({
      date: tx.date,
      type: tx.type,
      symbol: tx.symbol,
      quantity: tx.quantity,
      price: tx.price,
    }));

  const prompt = `
You are an AI trading coach summarizing one week of practice trading diary for a beginner retail investor.

User profile:
- Persona: ${persona.label} (${persona.description})
- Goal: ${user.goal}
- Risk tolerance: ${user.risk_tolerance}

Inputs:
- Weekly diary entries (chronological, last 7 days, trimmed): ${JSON.stringify(compactDiary)}
- Recent transactions (latest first, trimmed): ${JSON.stringify(compactTxs)}

Write a WEEKLY COACH SUMMARY in clear English, using this exact structure and headings:

1) One-line weekly summary
   - 1–2 short sentences capturing the emotional + behavioral theme of the week.

2) Behavior/metric recap
   - Brief bullets about: coverage of decisions logged, clarity of reasons, and repeating patterns you see.

3) Strengths this week
   - 3 short bullets focusing on what the user did WELL (good process, patience, discipline, reviews, etc.).

4) Risks / warnings
   - 3 short bullets about psychological or risk-management issues that showed up (e.g., chasing, averaging down, moving stop levels).

5) Next week action plan (checklist 5 items)
   - 5 bullet items in checklist style (but do NOT use "[ ]" or checkbox syntax; use normal "-" bullets).
   - Each item should be a very small, concrete behavior the user can track next week.

6) Recheck questions (3)
   - Exactly 3 numbered self-reflection questions the user can ask at the end of next week.

Constraints:
- Total length under about 320 words.
- Keep the tone encouraging but honest. Remind them that this is a safe practice environment.
- Do NOT mention that you received JSON as input.
`.trim();

  try {
    const text = await callMlChat(prompt, 600);
    const out = (text || "").trim();
    if (!out) {
      return "I couldn’t generate a full weekly summary right now. Please try again in a moment — your diary entries are still saved and valuable.";
    }
    return out;
  } catch (err) {
    console.error("[generateWeeklyDiarySummary] error:", err);
    return "The AI Coach couldn’t generate a weekly summary right now. Please try again later — meanwhile, simply re-reading your own notes is already a powerful review.";
  }
};

// Weekly Report generator for Diary.tsx "Weekly Report" modal
// - This is called with a compact payload that already contains:
//   - weekRange (string label)
//   - metrics (coverage, weekly goal, patterns)
//   - entries (trimmed diary entries for the selected week)
//   - persona (user persona key)
type WeeklyReportPayload = {
  weekRange: string;
  metrics: {
    diaryCoverage: { covered: number; total: number; pct: number };
    weeklyGoal: { goal: number; count: number; pct: number };
    patterns: {
      sampleN: number;
      topEmotion: any[];
      topDriver: any[];
    };
  };
  entries: any[];
  persona?: UserProfile["persona"];
};

export const generateWeeklyReport = async (
  payload: WeeklyReportPayload
): Promise<string> => {
  const personaKey = payload.persona;
  const persona = personaKey ? PERSONA_DETAILS[personaKey] : undefined;

  const personaLine = persona
    ? `Persona: ${persona.label} (${persona.description})`
    : "Persona: (not specified)";

  const prompt = `
You are an AI trading coach creating a structured WEEKLY REPORT for a beginner retail investor in a practice trading account.

Week range:
- ${payload.weekRange}

User profile:
- ${personaLine}

Weekly metrics (already precomputed):
- Diary coverage (trades with a journal): ${JSON.stringify(payload.metrics.diaryCoverage)}
- Weekly goal (target vs. actual entries): ${JSON.stringify(payload.metrics.weeklyGoal)}
- Pattern snapshots (top emotions/drivers, sample counts & performance snippets): ${JSON.stringify(
    payload.metrics.patterns
  )}

Weekly diary entries (compact, chronological within the selected week):
${JSON.stringify(payload.entries)}

Write a WEEKLY REPORT in clear English, using this exact structure and headings:

1) One-line weekly theme
   - 1–2 short sentences capturing the emotional + behavioral theme of the week.

2) What you actually logged this week
   - 2–4 bullet points about diary coverage, how consistent the logging was, and any gaps.

3) Strengths to keep
   - 3 short bullets focusing on process strengths (pre‑trade planning, sticking to rules, reviewing decisions, etc.).

4) Risks / patterns to watch
   - 3 short bullets about psychological or risk‑management issues that showed up (e.g., chasing, revenge trades, moving stops).

5) Winning pattern watch
   - 2–3 bullets that highlight any emotion + driver combinations that look especially strong or weak so far.

6) Next week checklist (5 items)
   - 5 bullet items in checklist style (but do NOT use "[ ]" or checkbox syntax; use normal "-" bullets).
   - Each item should be a very small, concrete behavior the user can track next week.

7) Reflection questions (3)
   - Exactly 3 numbered self‑reflection questions the user can answer at the end of next week.

Constraints:
- Total length under about 320 words.
- Keep the tone encouraging but honest. Remind them that this is a safe practice environment.
- Do NOT mention that you received JSON as input.
- Do NOT invent specific prices or P&L numbers beyond what is implied by the metrics.
`.trim();

  try {
    const text = await callMlChat(prompt, 700);
    const out = (text || "").trim();
    if (!out) {
      return "I couldn’t generate the weekly report right now. Please try again in a moment — your diary entries and metrics are still safely stored.";
    }
    return out;
  } catch (err) {
    console.error("[generateWeeklyReport] error:", err);
    return "The AI Coach couldn’t generate a weekly report right now. Please try again later — meanwhile, reviewing your own diary entries for this week is already a powerful habit.";
  }
};

/* -----------------------------
 * Dashboard: 5‑minute learning & quizzes
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

export const generateDashboardLearningCards = async (
  count: number = 3,
  seed?: number
): Promise<LearningCard[]> => {
  const safeCount = Math.max(1, Math.min(12, Math.floor(count))); // 1~12 cards per request

  // 로컬 개발 환경(주로 localhost)에서는 백엔드 /api 대신
  // 프론트에서 직접 mlapi.run을 호출해 카드 생성 (백엔드 의존도 ↓)
  const isLocalhost =
    typeof window !== "undefined" && window.location.hostname === "localhost";

  if (isLocalhost) {
    const prompt = `
You are a financial educator for beginner retail investors.
Create ${safeCount} short "5-minute learning" cards about basic investing concepts.

Requirements:
- Mix global topics and market context (for example: US tech, index ETFs, diversification, risk management).
- Use clear, simple English. Do not include any Korean language.
- Use the numeric session seed ${typeof seed === "number" ? seed : 0} to make results vary between calls.
- Return ONLY valid JSON that can be parsed by JSON.parse, with this exact shape:
[
  {"title":"string","duration":"string like '3 min'","category":"string tag like 'Basic Term' | 'Strategy' | 'Market Concepts'","content":"markdown string, 3-5 short paragraphs, under 220 words total"},
  ...
]
- Do not wrap the JSON in backticks.
- Do not add any text before or after the JSON.
`.trim();

    try {
      const text = await callMlChat(prompt, 900);
      let raw: any;
      try {
        raw = JSON.parse(text);
      } catch (err) {
        console.warn(
          "[geminiService] generateDashboardLearningCards (client) JSON parse error:",
          err,
          text
        );
        return [];
      }

      if (!Array.isArray(raw) || raw.length === 0) {
        return [];
      }

      const cards: LearningCard[] = [];
      raw.forEach((item: any, idx: number) => {
        if (!item || typeof item !== "object") return;
        const title = String(item.title || "").trim();
        const content = String(item.content || "").trim();
        const duration = String(item.duration || "5 min").trim();
        const category = String(item.category || "Learning").trim();
        if (!title || !content) return;
        cards.push({
          id: idx + 1,
          title,
          duration,
          category,
          content,
        });
      });

      if (!cards.length) {
        return [];
      }

      return cards;
    } catch (err) {
      console.warn(
        "[geminiService] generateDashboardLearningCards (client) fallback due to error:",
        err
      );
      return [];
    }
  }

  // 프로덕션(Vercel) 및 백엔드가 있는 환경에서는 기존 /api/dashboard-learning 사용
  const params = new URLSearchParams();
  params.set("count", String(safeCount));
  if (typeof seed === "number") params.set("seed", String(seed));

  try {
    const res = await fetch(apiUrl(`/api/dashboard-learning?${params.toString()}`));
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Dashboard learning HTTP error ${res.status}: ${body || "<empty>"}`);
    }
    const data: any = await res.json();
    const rawCards = data?.cards;
    if (!Array.isArray(rawCards) || rawCards.length === 0) {
      return [];
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
      return [];
    }

    return cards;
  } catch (err) {
    console.warn("[geminiService] generateDashboardLearningCards fallback due to error:", err);
    return [];
  }
};

export const generateDashboardQuizzes = async (
  count: number = 3,
  seed?: number
): Promise<DashboardQuiz[]> => {
  const safeCount = Math.max(1, Math.min(20, Math.floor(count))); // 1~20 questions per request

  const isLocalhost =
    typeof window !== "undefined" && window.location.hostname === "localhost";

  if (isLocalhost) {
    const prompt = `
You are creating multiple-choice quizzes for beginner retail investors.
Generate ${safeCount} short questions about personal investing, risk management, stock markets (including Korean stocks like KOSPI/KOSDAQ) and basic products (ETFs, bonds, etc.).

Return ONLY valid JSON that can be parsed by JSON.parse, with this exact structure:
[
  {"question":"string","options":["option A","option B","option C","option D"],"correctIndex":0,"explanation":"short explanation (2-3 sentences, under 80 words)"},
  ...
]

Rules:
- Exactly 4 options per question.
- correctIndex is 0-based (0, 1, 2 or 3).
- Do NOT include the correct answer text anywhere except via correctIndex and explanation.
- No extra keys, no comments, no trailing commas, and nothing outside the JSON.
- Use the numeric session seed ${typeof seed === "number" ? seed : 0} to make question sets differ between calls.
`.trim();

    try {
      const text = await callMlChat(prompt, 900);
      let raw: any;
      try {
        raw = JSON.parse(text);
      } catch (err) {
        console.warn(
          "[geminiService] generateDashboardQuizzes (client) JSON parse error:",
          err,
          text
        );
        return [];
      }

      if (!Array.isArray(raw) || raw.length === 0) {
        return [];
      }

      const quizzes: DashboardQuiz[] = [];
      raw.forEach((item: any) => {
        if (!item || typeof item !== "object") return;
        const question = String(item.question || "").trim();
        const options = Array.isArray(item.options)
          ? item.options.map((o: any) => String(o || "").trim()).filter(Boolean)
          : [];
        const correctIndex = Number.isInteger(item.correctIndex)
          ? Number(item.correctIndex)
          : -1;
        const explanation = String(item.explanation || "").trim();

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
        return [];
      }

      return quizzes;
    } catch (err) {
      console.warn(
        "[geminiService] generateDashboardQuizzes (client) fallback due to error:",
        err
      );
      return [];
    }
  }

  // 프로덕션(Vercel) 및 백엔드가 있는 환경에서는 기존 /api/dashboard-quizzes 사용
  const params = new URLSearchParams();
  params.set("count", String(safeCount));
  if (typeof seed === "number") params.set("seed", String(seed));

  try {
    const res = await fetch(apiUrl(`/api/dashboard-quizzes?${params.toString()}`));
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Dashboard quizzes HTTP error ${res.status}: ${body || "<empty>"}`);
    }
    const data: any = await res.json();
    const rawQuizzes = data?.quizzes;
    if (!Array.isArray(rawQuizzes) || rawQuizzes.length === 0) {
      return [];
    }

    const quizzes: DashboardQuiz[] = [];
    rawQuizzes.forEach((q: any) => {
      if (!q || typeof q !== "object") return;
      const question = String(q.question || "").trim();
      const options = Array.isArray(q.options)
        ? q.options.map((o: any) => String(o || "").trim()).filter(Boolean)
        : [];
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
      return [];
    }

    return quizzes;
  } catch (err) {
    console.warn("[geminiService] generateDashboardQuizzes fallback due to error:", err);
    return [];
  }
};

type Sentiment = "positive" | "negative" | "neutral";

// 기존 규칙 기반 감성분석 로직을 헬퍼로 분리 (외부 API 실패 시 fallback)
function ruleBasedNewsSentiment(text: string): Sentiment {
  const lower = text.toLowerCase();

  const positiveKeywords = [
    "surge",
    "soar",
    "rally",
    "jump",
    "spike",
    "record high",
    "all-time high",
    "beat expectations",
    "beats expectations",
    "beat estimates",
    "beats estimates",
    "strong growth",
    "strong demand",
    "solid growth",
    "better than expected",
    "raises guidance",
    "hikes guidance",
    "upgrade",
    "upgraded",
    "buy rating",
    "outperform",
    "overweight",
    "bullish",
    "profit surge",
    "rebound",
    "recovery",
    "top gainer",
    "optimistic",
    "beats on earnings",
    "strong quarter",
    "to buy",
    "worth buying",
    "buy now",
    "top pick",
    "could double",
    "multi-bagger",
  ];

  const negativeKeywords = [
    "plunge",
    "plunges",
    "slump",
    "slumps",
    "tumble",
    "tumbles",
    "fall",
    "falls",
    "drop",
    "drops",
    "sink",
    "sinks",
    "tank",
    "tanks",
    "crash",
    "crashes",
    "miss expectations",
    "misses expectations",
    "miss estimates",
    "misses estimates",
    "weak demand",
    "slowdown",
    "decline",
    "loss",
    "losses",
    "cut guidance",
    "cuts guidance",
    "downgrade",
    "downgraded",
    "underperform",
    "miss",
    "warning",
    "profit warning",
    "lawsuit",
    "scandal",
    "probe",
    "investigation",
    "regulatory",
    "fine",
    "penalty",
    "layoffs",
    "job cuts",
    "bankruptcy",
    "concern",
    "headwind",
  ];

  let score = 0;

  for (const kw of positiveKeywords) {
    if (lower.includes(kw)) score += 1;
  }

  for (const kw of negativeKeywords) {
    if (lower.includes(kw)) score -= 1;
  }

  if (
    lower.includes("up") ||
    lower.includes("higher") ||
    lower.includes("gain") ||
    lower.includes("rise")
  ) {
    score += 0.5;
  }
  if (
    lower.includes("down") ||
    lower.includes("lower") ||
    lower.includes("drop") ||
    lower.includes("fall")
  ) {
    score -= 0.5;
  }

  console.log(
    "[Sentiment] Rule-based score:",
    score,
    "for text:",
    lower.substring(0, 160)
  );

  if (score >= 0.5) return "positive";
  if (score <= -0.5) return "negative";
  return "neutral";
}

// mlapi.run 응답(또는 LLM 출력 텍스트)에서 sentiment 라벨 뽑아내기
function parseSentimentFromApiResponse(data: any): Sentiment | null {
  if (!data) return null;

  const candidates: string[] = [];

  if (typeof data === "string") {
    candidates.push(data);
  }
  if (typeof data.label === "string") {
    candidates.push(data.label);
  }
  if (typeof (data as any).sentiment === "string") {
    candidates.push((data as any).sentiment);
  }
  if (typeof (data as any).result === "string") {
    candidates.push((data as any).result);
  }

  // {"positive":0.8,"negative":0.1,"neutral":0.1} 형태
  const probKeys = ["positive", "negative", "neutral"] as const;
  if (probKeys.every((k) => typeof (data as any)[k] === "number")) {
    const best = probKeys.reduce((prev, cur) =>
      (data as any)[cur] > (data as any)[prev] ? cur : prev
    );
    return best;
  }

  // HF-style: [{label:"POSITIVE", score:0.98}, ...]
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (typeof first === "string") {
      candidates.push(first);
    } else if (first && typeof first.label === "string") {
      let best = first;
      if (typeof first.score === "number") {
        best = data.reduce(
          (acc: any, cur: any) =>
            typeof cur.score === "number" && cur.score > acc.score ? cur : acc,
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

    // 영어 단어가 그대로 온 경우 (가장 우선)
    if (lower === "positive") return "positive";
    if (lower === "negative") return "negative";
    if (lower === "neutral") return "neutral";

    // 한국어 단어 매핑
    if (lower.includes("긍정")) return "positive";
    if (lower.includes("부정")) return "negative";
    if (lower.includes("중립")) return "neutral";

    // 기존 휴리스틱 (POS / NEG / NEU 등)
    if (lower.includes("pos")) return "positive";
    if (lower.includes("neg")) return "negative";
    if (lower.includes("neu") || lower.includes("neutral")) return "neutral";
  }

  return null;
}

// 뉴스 감성분석
// - 프로덕션: /api/news-sentiment (Node/Flask 프록시) 사용
// - 로컬( localhost ): 백엔드 없이 rule-based 분석만 사용해 콘솔 에러/404 노이즈 제거
export const analyzeNewsSentiment = async (
  title: string,
  summary: string,
  relatedSymbols: string[]
): Promise<Sentiment> => {
  const isLocalhost =
    typeof window !== "undefined" && window.location.hostname === "localhost";

  if (isLocalhost) {
    // 로컬에서는 백엔드 엔드포인트 없이 클라이언트에서 규칙 기반만 사용
    const text = `${title} ${summary}`;
    return ruleBasedNewsSentiment(text);
  }

  try {
    // Backend proxy (/api/news-sentiment) for sentiment labels
    const res = await fetch(apiUrl("/api/news-sentiment"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        summary,
        symbols: relatedSymbols,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      console.error(
        "[Sentiment] /api/news-sentiment error:",
        res.status,
        errorBody || "<empty body>"
      );
      throw new Error(`News sentiment HTTP error: ${res.status}`);
    }

    const data = await res.json();
    const raw = String((data as any)?.sentiment || "").toLowerCase();
    if (raw === "positive" || raw === "negative" || raw === "neutral") {
      return raw;
    }

    console.warn(
      "[Sentiment] Unknown sentiment label from backend, falling back to neutral:",
      raw
    );
    return "neutral";
  } catch (err) {
    console.error(
      "[Sentiment] Backend sentiment error, using neutral fallback:",
      err
    );
    // 외부 API 오류 시에도 neutral 로 고정
    return "neutral";
  }
};
