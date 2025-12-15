// services/mentorService.ts
// AI 멘토 챗봇 서비스 - 일반 모드와 보안 모드 통합 관리

import { GoogleGenerativeAI, type Content } from "@google/generative-ai";
import type { UserProfile, Portfolio } from "../types";
import { PERSONA_DETAILS } from "../constants";
import { apiUrl } from "./apiClient";
import { buildAgentPrompt } from "./knowledgeService";


// Vite: only VITE_* env vars are exposed to client
const apiKey = import.meta.env.VITE_API_KEY as string;
const hasApiKey = apiKey && apiKey.trim().length > 0;
const genAI = hasApiKey ? new GoogleGenerativeAI(apiKey) : null;


// GPT (mlapi.run) base URL & key
// URL: 프론트에서는 별도 VITE_* 없이, 백엔드와 동일한 기본값을 그대로 사용한다.
//   - yfinance_api.py 의 SENTIMENT_API_URL 기본값과 맞춰둠.
const rawMlBaseUrl =
  (process.env.SENTIMENT_API_URL as string | undefined) ??
  "https://mlapi.run/1f0accc6-a96b-4bb2-9a0f-670c8aa0fd62/v1";
const mlBaseUrl = rawMlBaseUrl.replace(/\/+$/, "");

const mlApiKey =
  (import.meta.env.VITE_SENTIMENT_API_KEY as string | undefined) ||
  (process.env.SENTIMENT_API_KEY as string | undefined);

// Feature flag: enable/disable AI Mentor in‑chat micro‑surveys
const mentorSurveyEnabled =
  ((import.meta.env.VITE_MENTOR_SURVEY_ENABLED as string | undefined) ?? "true")
    .toLowerCase() === "true";

// GPT5 API 호출 유틸리티
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
      model: "openai/gpt-5",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  const data: any = await res.json();
  const choice = data?.choices?.[0];

  const fallback =
    "I don't have anything reliable to add right now. Please try asking your question in a slightly different way, or narrow it down to one concrete situation.";

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

/**
 * 일반 모드 AI 멘토 - Knowledge Base 검색 + GPT5
 * 사용자 쿼리를 Knowledge Base에서 검색한 후 RAG 프롬프트로 GPT5에 전달
 */
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

  // Extract the last user message from history
  const lastUserMessage = (history || [])
    .slice()
    .reverse()
    .find((msg) => msg.role === "user");
  
  const userQuery = lastUserMessage
    ? (lastUserMessage.parts || [])
        .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join(" ")
    : "";

  // Detect language from user's last message
  const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(userQuery);
  const responseLanguage = isKorean ? "Korean" : "English";

  // Build agent prompt with knowledge base retrieval (DB query happens here)
  let knowledgePrompt = "";
  let retrievedDocs: any[] = [];
  
  if (userQuery.trim()) {
    try {
      const { prompt, docs } = await buildAgentPrompt(userQuery, 6, 800);
      knowledgePrompt = prompt;
      retrievedDocs = docs;
      console.log(`[generateFinancialAdvice] Retrieved ${docs.length} documents for query: "${userQuery}"`);
    } catch (err) {
      console.error("[generateFinancialAdvice] Error building agent prompt:", err);
      // Fallback: use user query directly if knowledge service fails
      knowledgePrompt = userQuery;
    }
  }

  // Flatten Gemini-style history into a simple chat transcript
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
CRISIS CHECK (internal, do not show):

Before doing anything else, silently decide whether the user's last message
indicates emotional distress or a negative situation.

Consider it a crisis ONLY if the message clearly includes:
- emotional discomfort (e.g. anxiety, fear, frustration, regret)
- or loss-related stress (e.g. loss, drop, crash, panic)
- or urgency / confusion about what to do next

If the message is neutral, informational, or casual,
you MUST NOT generate a checklist or survey.

If this is NOT a crisis:
- Respond with a normal, supportive conversational reply.
- Do NOT include any checklist.
- Do NOT include reflection questions.
- Stop after a short response.

If this IS a crisis:
- Proceed with the survey instructions below.

You are FinGuide.

You are NOT giving advice.
You are NOT explaining outcomes.
You are NOT summarizing the situation.

Your task is to start a short self-check survey that helps the user notice
what was happening inside their head at the moment of the decision.

You will be given:
- the user's persona
- a vocabulary bank of first-person self-talk phrases specific to that persona
- recent user's portfolio(stock symbols, average prices, quantities, recent price movement)

PORTFOLIO CONTEXT (for reference only):

- Cash available: $${portfolio.cash.toFixed(2)}
- Current holdings:
${portfolio.assets
  .map(
    (a) =>
      `• ${a.symbol}: ${a.quantity} shares at avg price $${a.avg_price.toFixed(2)}`
  )
  .join("\n") || "• No current holdings"}

IMPORTANT:
- Use ONE concrete holding above as a situational example when writing checklist items.
- Do NOT analyze performance or give advice.
- Do NOT calculate profit or loss.
- Only reference prices or quantities as moments the user likely noticed.


IMPORTANT ROLE
- You are a checklist composer.
- You do not invent thoughts.
- You do not interpret meaning.
- You only rephrase and surface likely internal self-talk.

SURVEY RULES
1. Begin with exactly TWO short empathy sentences.
   - Neutral, validating, no advice.
2. Add ONE transition sentence that invites reflection (not diagnosis).
3. Show EXACTLY THREE checklist items.
4. Each checklist item:
   - must be written in first person ("I")
   - must reflect something the user likely told themselves
   - must clearly show what they relied on or skipped internally
5. Do NOT mention personas, types, or psychology.
6. Do NOT add growth, lessons, or next steps.
7. This is not a test. Not all items need to apply.

PERSONA CONSTRAINTS
- Help Seeker:
  Focus on reassurance-seeking, urgency to act, reliance on authority.
- Solo Struggler:
  Focus on handling things alone, avoiding outside input, trusting own judgment.
- Optimist:
  Focus on opportunity framing, minimizing downside, selective attention.
- Motivation Seeker:
  Focus on avoidance, disengagement, dropping rules or plans.

LANGUAGE CONSTRAINTS
- Respond in ${responseLanguage}. Match the language the user used in their last message.
- No bullet explanations.
- No conclusions.
- No advice.

END STATE
- The output should feel like “These are thoughts I might have had.”
- The user should only see the checklist, not your reasoning.

Now generate the survey.
`
    : "";

  // Combine the knowledge-enhanced prompt with the original FinGuide context
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
- Explain concepts clearly and avoid jargon where possible.
- Do NOT give direct "buy now" or "sell now" instructions. Instead, explain trade-offs and options.
- Keep answers focused and under about 220–260 words unless the user explicitly asks for something longer.
- IMPORTANT: Respond in ${responseLanguage}. Match the language the user used in their last message. If the user wrote in English, respond in English. If the user wrote in Korean, respond in Korean.
${surveyInstructions}

Conversation so far:
${conversation}

${knowledgePrompt ? `\n\n${knowledgePrompt}` : "\n\nNow respond as FinGuide to the user's last message."}
`.trim();

  try {
    const text = await callMlChat(prompt, 800);
    const trimmed = (text || "").trim();
    if (!trimmed) {
      console.warn("[generateFinancialAdvice] Empty response from GPT, returning fallback.");
      return "I don't have a detailed answer right now, but remember this is a safe practice environment. Try asking about one concrete position, plan, or concern at a time so we can work through it together.";
    }
    return trimmed;
  } catch (err) {
    console.error("[generateFinancialAdvice] AI error, returning fallback:", err);
    return "I'm having trouble generating a full answer right now. Nothing in this practice account is at risk, so feel free to rephrase your question or ask about a smaller, specific decision instead.";
  }
};

/**
 * 보안 모드 AI 멘토 - Qwen FinSec
 * 보안/규제 관점에서 답변을 제공하는 모드
 */
export interface SimpleMessage {
  role: 'user' | 'model';
  text: string;
}

export async function generateSecurityAdvice(
  history: SimpleMessage[]
): Promise<string> {
  const payloadHistory = history.map((m) => ({
    role: m.role,
    content: m.text,
  }));

  const res = await fetch(apiUrl('/api/security-chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history: payloadHistory }),
  });

  if (!res.ok) {
    throw new Error(`Security API error: ${res.status}`);
  }

  const data = await res.json();
  return data.answer ?? 'Security assistant could not generate a response.';
}

