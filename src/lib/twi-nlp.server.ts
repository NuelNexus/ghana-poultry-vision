import process from "node:process";

// Twi word helper (edge/twi_nlp.py, GhanaNLP's DistilABENA v2). Optional:
//   TWI_NLP_URL    - e.g. http://127.0.0.1:5003
//   TWI_NLP_TOKEN  - bearer token, when the helper sets PG_NLP_TOKEN

export const twiWordsEnabled = () => Boolean(process.env.TWI_NLP_URL);

export type TwiSuggestion = { word: string; score: number };

export async function twiSuggest(text: string, k = 5) {
  const url = process.env.TWI_NLP_URL;
  if (!url) return { words: [] as TwiSuggestion[], mode: "next" as const };
  const token = process.env.TWI_NLP_TOKEN;
  const res = await fetch(`${url.replace(/\/$/, "")}/suggest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ text, k }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Twi word helper failed (${res.status})`);
  return (await res.json()) as { words: TwiSuggestion[]; mode: "next" | "blank" };
}
