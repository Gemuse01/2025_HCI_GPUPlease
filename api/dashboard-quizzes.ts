// api/dashboard-quizzes.ts
// Generate multiple-choice quiz questions using mlapi.run (GPT-5).

const ML_BASE_URL =
  (process.env.SENTIMENT_URL as string | undefined) ||
  (process.env.SENTIMENT_API_URL as string | undefined) ||
  "https://mlapi.run/0cd91e02-b942-453d-852a-bc83e8d3125a";
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
      // Let server decide tokens; we just parse JSON.
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  const data: any = await res.json();
  const choice = data?.[0] ?? data?.choices?.[0];
  const content = choice?.message?.content ?? choice;
  const text =
    typeof content === "string" ? content : JSON.stringify(content ?? "");
  if (!text || !text.trim()) {
    throw new Error("Empty content from GPT");
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("[api/dashboard-quizzes] JSON parse error:", err, text);
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
        Math.min(20, parseInt(String(req.query.count), 10) || 3),
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
You are creating multiple-choice quizzes for beginner retail investors.
Generate ${count} short questions about personal investing, risk management, stock markets (including Korean stocks like KOSPI/KOSDAQ) and basic products (ETFs, bonds, etc.).

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
- Use the numeric session seed ${seed} to make question sets differ between calls.
`.trim();

  try {
    const raw = await callOpenAiJson(prompt, 900);
    if (!Array.isArray(raw) || !raw.length) {
      throw new Error("Model returned non-list or empty result.");
    }

    const quizzes = raw
      .map((item: any) => {
        if (!item || typeof item !== "object") return null;
        const question = String(item.question || "").trim();
        const options = item.options as any;
        if (!question || !Array.isArray(options) || options.length !== 4)
          return null;
        const opts = options.map((o: any) => String(o || "").trim());
        if (opts.some((o: string) => !o)) return null;
        const correctIndex = Number(item.correctIndex);
        if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3)
          return null;
        const explanation = String(item.explanation || "").trim();
        if (!explanation) return null;
        return {
          question,
          options: opts,
          correctIndex,
          explanation,
        };
      })
      .filter(Boolean);

    if (!quizzes.length) {
      throw new Error("No valid quizzes extracted from GPT output.");
    }

    res.status(200).json({ quizzes });
  } catch (err: any) {
    console.error("[api/dashboard-quizzes] error:", err);
    res.status(500).json({ error: String(err?.message || err), quizzes: [] });
  }
}


