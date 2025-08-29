// /api/generate-cloze.js — Chat Completions (JSONモード) 安定版
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 本文パース（環境差吸収）
  let payload = {};
  try {
    if (req.body && typeof req.body === "object") {
      payload = req.body;
    } else {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      payload = raw ? JSON.parse(raw) : {};
    }
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const {
    text,
    keyword = "",
    num = 4,
    locale = "en",
    level = "B1"
  } = payload || {};

  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "text is required (string)" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not set" });
  }

  const systemPrompt = [
    "You are an expert ESL listening teacher.",
    "Create high-quality cloze (fill-in-the-blank) questions for listening training.",
    `Output must be strict JSON with the structure: {"items":[{"text_with_blanks":string,"answers":[string],"rationale":string}]}.`,
    `Create exactly ${num} items if the text allows; otherwise fewer is acceptable.`,
    "Rules:",
    "- Prefer discourse markers, reductions, collocations, phrasal verbs, function words.",
    "- Use ONE continuous blank per item; do not change other words or punctuation.",
    "- answers must be the EXACT original substring replaced by the blank.",
    `- Learner level target: ${level}.`,
    `- UI hints language: ${locale}.`,
    keyword ? `- Consider the pedagogical keyword: "${keyword}".` : ""
  ].filter(Boolean).join("\n");

  const userPrompt = `Transcript:\n${text.slice(0, 8000)}`;

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.3,
        // ★ JSONモード（壊れないJSONを返す）
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    const rawText = await resp.text();
    let data;
    try { data = JSON.parse(rawText); } catch { data = null; }

    if (!resp.ok) {
      return res.status(resp.status).json({ error: "OpenAI error", detail: rawText });
    }

    // Chat Completions の JSONモードでは content が JSON文字列で返る
    const content = data?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(content); } catch { parsed = null; }

    if (!parsed || !Array.isArray(parsed.items)) {
      parsed = { items: [] };
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).end(JSON.stringify(parsed));
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
