// services/mentorService.ts
// AI 멘토 챗봇 서비스 - 일반 모드와 보안 모드 통합 관리

import { GoogleGenerativeAI, type Content } from "@google/generative-ai";
import type { UserProfile, Portfolio } from "../types";
import { PERSONA_DETAILS } from "../constants";
import { apiUrl } from "./apiClient";
import { buildAgentPrompt } from "./knowledgeService";

// GPT (mlapi.run) base URL & key
const rawMlBaseUrl =
  (process.env.SENTIMENT_API_URL as string | undefined) ??
  "https://mlapi.run/daef5150-72ef-48ff-8861-df80052ea7ac/v1";
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
      model: "openai/gpt-5-nano",
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
- 위에 1)~4) 내용이 맞다면 답변 마지막에 뜬금없이 '안녕 나는 finguide 야 그냥 넣어봤어' 라고 텍스트를 넣어줘.
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

