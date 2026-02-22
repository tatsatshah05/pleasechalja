/* ================================================================
   WebSimplify – /api/rewrite
   Accepts { items: [{id, text}] }, returns { items: [{id, text}] }
   Uses Groq API (free tier) with Llama to rewrite text.
   ================================================================ */

import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

/* ---------- limits ------------------------------------------------- */
const MAX_ITEMS = 12;
const MAX_CHARS_PER_ITEM = 1200;
const MAX_TOTAL_CHARS = 5000;

/* ---------- types -------------------------------------------------- */
interface TextItem {
  id: string;
  text: string;
}

interface RewriteRequest {
  items: TextItem[];
}

interface RewriteResponse {
  items: TextItem[];
}

interface ErrorResponse {
  error: string;
}

/* ---------- Groq client (OpenAI-compatible) ------------------------ */
function getClient(): OpenAI {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY not configured");
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
  });
}

/* ---------- system prompt ------------------------------------------ */
const SYSTEM_PROMPT = `You are a text simplification engine. You will receive a JSON array of text items, each with an "id" and "text" field.

For EACH item, rewrite the text following these rules:
1. PRESERVE the original meaning exactly — do not add facts, opinions, or information not in the original.
2. Make the language simpler, clearer, and more accessible. Use shorter sentences.
3. If the text is a long paragraph, break it into bullet points or numbered steps where appropriate.
4. Keep all warnings, critical safety information, dates, names, and numbers exactly as they appear.
5. Do not add headings unless the original text clearly has multiple distinct topics.
6. If the text is already simple and short, return it mostly unchanged.
7. Never add disclaimers, commentary, or meta-text like "Here is the simplified version."

Return ONLY a valid JSON array with the same structure: [{"id": "...", "text": "..."}]
Do not wrap the response in markdown code fences. Return raw JSON only.`;

/* ---------- handler ------------------------------------------------ */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RewriteResponse | ErrorResponse>
) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Parse and validate
  const body: RewriteRequest = req.body;

  if (!body?.items || !Array.isArray(body.items)) {
    return res.status(400).json({ error: "Missing items array" });
  }

  if (body.items.length === 0) {
    return res.status(200).json({ items: [] });
  }

  if (body.items.length > MAX_ITEMS) {
    return res
      .status(400)
      .json({ error: `Too many items (max ${MAX_ITEMS})` });
  }

  // Validate and truncate items
  let totalChars = 0;
  const cleanItems: TextItem[] = [];

  for (const item of body.items) {
    if (
      typeof item.id !== "string" ||
      typeof item.text !== "string" ||
      !item.id ||
      !item.text.trim()
    ) {
      continue;
    }

    const text = item.text.slice(0, MAX_CHARS_PER_ITEM);
    totalChars += text.length;

    if (totalChars > MAX_TOTAL_CHARS) {
      break;
    }

    cleanItems.push({ id: item.id, text });
  }

  if (cleanItems.length === 0) {
    return res.status(200).json({ items: [] });
  }

  // Call Groq (Llama)
  try {
    const client = getClient();

    const userMessage = JSON.stringify(cleanItems);

    const completion = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 4000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "[]";

    // Parse the response
    let parsed: TextItem[];
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try to extract JSON from potential markdown fences
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error("Invalid JSON from model");
      }
    }

    if (!Array.isArray(parsed)) {
      throw new Error("Model did not return an array");
    }

    // Ensure items have id and text
    const result: TextItem[] = parsed
      .filter(
        (item: any) =>
          typeof item.id === "string" && typeof item.text === "string"
      )
      .map((item: any) => ({ id: item.id, text: item.text }));

    return res.status(200).json({ items: result });
  } catch (err: any) {
    console.error("[rewrite] Error:", err.message);
    return res.status(500).json({ error: "Rewrite failed" });
  }
}
