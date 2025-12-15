// api/dashboard-learning.ts
// Generate 5-minute learning cards using mlapi.run (GPT-5) JSON output.

const ML_BASE_URL =
  (process.env.SENTIMENT_API_URL as string | undefined) ||
  "https://mlapi.run/daef5150-72ef-48ff-8861-df80052ea7ac/v1";
const ML_API_KEY = process.env.SENTIMENT_API_KEY as string | undefined;

async function callOpenAiJson(prompt: string, maxTokens: number): Promise<any> {
  if (!ML_BASE_URL || !ML_API_KEY) {
    throw new Error(
      "SENTIMENT_API_URL / SENTIMENT_API_KEY are not configured on the server",
    );
  }

  const res = await fetch(`${ML_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ML_API_KEY}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-5",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      // Let the server-side default token limits apply; no max_completion_tokens.
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  const data: any = await res.json();
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Empty content from GPT");
  }

  try {
    return JSON.parse(content);
  } catch (err) {
    console.error("[api/dashboard-learning] JSON parse error:", err, content);
    throw new Error("Failed to parse JSON from GPT response");
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let count = 3;
  let seed = 0;
  try {
    if (req.query?.count) {
      count = Math.max(
        1,
        Math.min(12, parseInt(String(req.query.count), 10) || 3),
      );
    }
  } catch {
    count = 3;
  }

  try {
    if (req.query?.seed) {
      seed = parseInt(String(req.query.seed), 10) || 0;
    }
  } catch {
    seed = 0;
  }

  const prompt = `
You are a financial educator for beginner retail investors.
Create ${count} short "5-minute learning" cards about basic investing concepts.

Requirements:
- Mix global topics and market context (for example: US tech, index ETFs, diversification, risk management).
- Use clear, simple English. Do not include any Korean language.
- Use the numeric session seed ${seed} to make results vary between calls.
- Return ONLY valid JSON that can be parsed by JSON.parse, with this exact shape:
[
  {"title":"string","duration":"string like '3 min'","category":"string tag like 'Basic Term' | 'Strategy' | 'Market Concepts'","content":"markdown string, 3-5 short paragraphs, under 220 words total"},
  ...
]
- Do not wrap the JSON in backticks.
- Do not add any text before or after the JSON.
`.trim();

  try {
    const raw = await callOpenAiJson(prompt, 900);
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error("Model returned non-list or empty result.");
    }

    const cards = raw
      .map((item: any, idx: number) => {
        if (!item || typeof item !== "object") return null;
        const title = String(item.title || "").trim();
        const content = String(item.content || "").trim();
        const duration = String(item.duration || "5 min").trim();
        const category = String(item.category || "Learning").trim();
        if (!title || !content) return null;
        return {
          id: idx + 1,
          title,
          duration,
          category,
          content,
        };
      })
      .filter(Boolean);

    if (!cards.length) {
      throw new Error("No valid learning cards extracted from GPT output.");
    }

    res.status(200).json({ cards });
  } catch (err: any) {
    console.error("[api/dashboard-learning] error:", err);
    res.status(500).json({ error: String(err?.message || err), cards: [] });
  }
}


