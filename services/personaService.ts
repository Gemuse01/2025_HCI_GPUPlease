// services/personaService.ts
import { UserProfile } from "../types";

export async function updatePersonaBySurveyAnswers(
  answers: string[],
  currentPersona: string
): Promise<{ persona: string; label: string; changed: boolean }> {
  const res = await fetch("http://localhost:5002/api/update-persona", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers, current_persona: currentPersona }),
  });
  if (!res.ok) {
    const error = await res.text().catch(() => "");
    throw new Error(`Persona update API error: ${res.status} ${error}`);
  }
  return await res.json();
}
