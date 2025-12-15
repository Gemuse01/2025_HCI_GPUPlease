import { Pool } from '@neondatabase/serverless';
import { DocumentRow } from '../types';

// =========================================================
// Configuration & Constants
// =========================================================

// ⚠️ SECURITY WARNING: In a production app, never expose DB credentials in frontend code.
// Use a backend proxy instead. We are doing this here for the prototype/demo.
const CONN_STR = "postgresql://neondb_owner:npg_tD0LZdo5QuJR@ep-curly-firefly-a18kb6p7-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const STOP_PHRASES = [
  "어떻게", "왜", "요즘", "지금", "좀", "알려줘", "궁금", "가능", "해줘",
  "뭐야", "뭔가", "어떤", "관련", "대해", "대한", "정리", "설명", "뉴스",
  "같은", "거", "것", "수", "있어", "있나", "해줄래", "부탁", "해봐",
];

// Actual SQL query from Python code
const SEARCH_SQL = `
  SELECT doc_id,
         coalesce(title,'') AS title,
         coalesce(body,'')  AS body,
         press,
         published_at,
         ts_rank_cd(
           to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,'')),
           websearch_to_tsquery('simple', $1)
         ) AS rank
    FROM doc
   WHERE to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body,'')) @@
         websearch_to_tsquery('simple', $2)
   ORDER BY rank DESC
   LIMIT $3;
`;

// =========================================================
// Internal helpers
// =========================================================

function normalizeKo(q: string, maxLen: number = 60): string {
  let s = (q || "").trim();
  if (!s) return "";

  for (const w of STOP_PHRASES) {
    s = s.split(w).join(" ");
  }

  s = s.replace(/\s+/g, " ").trim();
  return s.substring(0, maxLen);
}

function fallbackOr(q: string, maxTerms: number = 5): string {
  const s = normalizeKo(q, 120);
  const allToks = s.split(/\s+/);
  const toks = allToks.filter(t => t.length >= 2);
  const selectedToks = toks.slice(0, maxTerms);
  return selectedToks.length > 0 ? selectedToks.join(" OR ") : (q || "");
}

async function runFts(query: string, topK: number): Promise<DocumentRow[]> {
  console.log(`[Neon DB] Connecting to DB... Query: "${query}"`);

  // Initialize Pool
  const pool = new Pool({ connectionString: CONN_STR });

  try {
    // Note: $1, $2, $3 are the placeholders for the query parameters
    const { rows } = await pool.query(SEARCH_SQL, [query, query, topK]);
    console.log(`[Neon DB] Found ${rows.length} rows.`);
    return rows as DocumentRow[];
  } catch (err) {
    console.error("[Neon DB] Query Error:", err);
    // Fallback: If DB connection fails (e.g., CORS, Auth), return empty array so app doesn't crash
    // In a real app, you might want to show a toast message.
    return [];
  } finally {
    // Close the pool connection (serverless pool handles this efficiently)
    await pool.end(); 
  }
}

// =========================================================
// PUBLIC API
// =========================================================

export async function buildAgentPrompt(
  userQuery: string,
  topK: number = 6,
  snippetMaxChars: number = 800
): Promise<{ prompt: string; docs: DocumentRow[] }> {
  
  // 1) Search Attempts (raw -> norm -> fallback)
  const qRaw = (userQuery || "").trim();
  const qNorm = normalizeKo(qRaw);
  const qFb = fallbackOr(qRaw);

  const tries: string[] = [];
  if (qRaw) tries.push(qRaw);
  if (qNorm && qNorm !== qRaw) tries.push(qNorm);
  if (qFb && !tries.includes(qFb)) tries.push(qFb);

  let rows: DocumentRow[] = [];
  let usedQuery = qRaw;

  // Execute search strategy
  for (const q of tries) {
    rows = await runFts(q, topK);
    usedQuery = q;
    if (rows.length > 0) {
      console.log(`[Search] Hit found using query variant: "${q}"`);
      break;
    }
  }

  // 2) Construct Retrieved Context
  let retrievedBlock = "";
  if (rows.length === 0) {
    retrievedBlock = "No relevant documents were retrieved.";
  } else {
    const blocks = rows.map((row, i) => {
      const idx = i + 1;
      const safeBody = row.body || "";
      const snippet = safeBody.substring(0, snippetMaxChars);
      
      // Handle Date object or string depending on what pg driver returns
      const dateStr = row.published_at 
        ? new Date(row.published_at).toISOString() 
        : 'Unknown';

      return `[${idx}]\n` +
             `Title: ${row.title.substring(0, 160)}\n` +
             `Source: ${row.press}\n` +
             `Date: ${dateStr}\n` +
             `Snippet: ${snippet}\n`;
    });
    retrievedBlock = blocks.join("\n");
  }

  // 3) Final Prompt Construction
  const prompt = `
You are a financial assistant.

Below is a user query and a set of retrieved documents.

**INSTRUCTIONS**:
1. **Analyze the Query**: Understand what the user is asking.
2. **Evaluate Context**:
   - Check if the RETRIEVED DOCUMENTS contain information relevant to the query.
   - If they are relevant, USE THEM to formulate your answer.
   - If they are NOT relevant (e.g., unrelated topic, too old), IGNORE THEM completely.
3. **Draft the Answer**:
   - Answer the user's question directly, professionally, and naturally.
   - **IF using documents**: You MUST cite the source naturally within the text (e.g., "Recent reports from [Press], such as '[Title]', suggest that...").
   - **IF NOT using documents**: Answer based on your general knowledge.
   
**CRITICAL NEGATIVE CONSTRAINTS**:
- **DO NOT** explain what the provided documents are about if you are not using them.
- **DO NOT** say sentences like "The provided documents focus on X, so they are not relevant."
- **DO NOT** mention the existence of the documents if they are not used. Just act as if you are answering from your own knowledge base.
- **DO NOT** apologize for the documents being irrelevant.

────────────────────────────────
USER QUERY:
${userQuery}
────────────────────────────────
RETRIEVED DOCUMENTS:
${retrievedBlock}
────────────────────────────────
Answer:`.trim();

  return { prompt, docs: rows };
}

