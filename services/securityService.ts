// services/securityService.ts
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

  const res = await fetch('http://localhost:5002/api/security-chat', {
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
