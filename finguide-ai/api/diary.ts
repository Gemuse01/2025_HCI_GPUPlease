import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

// /api/diary : 심리/다이어리 피드백
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { entry, user } =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!entry || !user) return res.status(400).json({ error: "entry, user required" });

    const prompt = `
As an AI trading psychology coach, give a brief (2-3 sentences) feedback.
Persona: ${user.persona}
Emotion: ${entry.emotion}
Driver: ${entry.reason}
Note: "${entry.note}"
Be encouraging but insightful. Mention behavioral patterns if relevant.
`.trim();

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { temperature: 0.7, maxOutputTokens: 300 }
    });

    // @ts-ignore
    const text = resp.text ?? resp.response?.text?.() ?? "Good job reflecting on your trade.";
    res.status(200).json({ ok: true, text });
  } catch (e: any) {
    console.error("API /diary error:", e);
    res.status(500).json({ ok: false, error: e?.message || "unknown error" });
  }
}