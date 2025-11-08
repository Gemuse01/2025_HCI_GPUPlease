// services/geminiService.ts
// 브라우저에서는 API_KEY를 쓰지 않습니다. 서버 함수로만 호출합니다.

import type { Content } from "@google/genai";
import type { UserProfile, Portfolio, DiaryEntry } from "../types";

export async function getStockAnalysis(
  symbol: string,
  marketCondition: string,
  riskTolerance: string
): Promise<string> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "stock", symbol, marketCondition, riskTolerance })
  });
  if (!res.ok) throw new Error(`API /api/generate ${res.status}`);
  const data = await res.json();
  return data.text as string;
}

export async function generateFinancialAdvice(
  history: Content[],
  user: UserProfile,
  portfolio: Portfolio
): Promise<string> {
  const res = await fetch("/api/advise", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history, user, portfolio })
  });
  if (!res.ok) throw new Error(`API /api/advise ${res.status}`);
  const data = await res.json();
  return data.text as string;
}

export async function generateDiaryFeedback(
  entry: DiaryEntry,
  user: UserProfile
): Promise<string> {
  const res = await fetch("/api/diary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry, user })
  });
  if (!res.ok) throw new Error(`API /api/diary ${res.status}`);
  const data = await res.json();
  return (data.text as string) || "Great job recording your thoughts. Consistency is key!";
}