import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

// /api/advise : 투자 조언(퍼소나/포트폴리오 반영)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { history, user, portfolio } =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!user || !portfolio) return res.status(400).json({ error: "user, portfolio required" });

    const holdingsSummary =
      portfolio?.assets?.map((a: any) => `${a.quantity} shares of ${a.symbol} (Avg: $${a.avg_price.toFixed(2)})`)
        .join(", ") || "No current holdings";

    const systemInstruction = `
You are FinGuide, an AI financial mentor.
User Goal: ${user.goal}
Risk Tolerance: ${user.risk_tolerance}
Current Portfolio: Cash $${portfolio.cash?.toFixed?.(2) ?? portfolio.cash}, Holdings: [${holdingsSummary}]
Keep responses concise, encouraging, and educational. No direct "buy now" advice.
`.trim();

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: history ?? [],
      config: { systemInstruction, temperature: 0.7, maxOutputTokens: 800 }
    });

    // @ts-ignore
    const text = resp.text ?? resp.response?.text?.() ?? "";
    res.status(200).json({ ok: true, text });
  } catch (e: any) {
    console.error("API /advise error:", e);
    res.status(500).json({ ok: false, error: e?.message || "unknown error" });
  }
}
