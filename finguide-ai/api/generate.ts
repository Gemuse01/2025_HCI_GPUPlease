import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

// /api/generate : 주식 스냅샷
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { symbol, marketCondition, riskTolerance } =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!symbol || !marketCondition || !riskTolerance) {
      return res.status(400).json({ error: "symbol, marketCondition, riskTolerance required" });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    const prompt = `
Acting as a senior financial analyst, provide a concise 3-bullet point analysis of ${symbol} for an investor with ${riskTolerance} risk tolerance.
Current simulated market condition: ${marketCondition}.

Format:
**Snapshot**: [One sentence summary]
• **Strength**: [...]
• **Risk**: [...]
• **Verdict**: [Buy/Hold/Sell]
    `.trim();

    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { temperature: 0.7, maxOutputTokens: 300 }
    });

    // @google/genai SDK는 resp.text 로 텍스트 접근
    // 타입 버전에 따라 resp.response.text() 인 경우도 있으니 필요시 조정
    // 아래는 가장 흔한 형태:
    // @ts-ignore
    const text = resp.text ?? resp.response?.text?.() ?? "";
    res.status(200).json({ ok: true, text });
  } catch (e: any) {
    console.error("API /generate error:", e);
    res.status(500).json({ ok: false, error: e?.message || "unknown error" });
  }
}
