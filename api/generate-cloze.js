// /api/generate-cloze.js — Responses API 構造化出力 正しい書き方
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

  const { text, keyword = "", num = 4, locale = "en", level = "B1" } = payload;

  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not set" });
  }

  const schema = {
    name: "cloze_questions",
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text_with_blanks: { type: "string" },
              answers: { type: "array", items: { type: "string" } },
              rationale: { type: "string" }
            },
            required: ["text_with_blanks", "answers"],
            additionalProperties: false
          }
        }
      },
      required: ["items"],
      additionalProperties: false
    },
    strict: true
  };

  try {
    const oaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "You are an expert ESL listening teacher.",
                  `Create ${num} cloze (fill-in-the-blank) questions from the given transcript.`,
                  "Return valid JSON following the schema.",
                  `Learner level: ${level}.`,
                  keyword ? `Focus keyword: ${keyword}` : ""
                ].join("\n")
              }
            ]
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: `Transcript:\n${text.slice(0, 8000)}` }
            ]
          }
        ],
        // ✅ 正しい指定
        response_format: {
          type: "json_schema",
          json_schema: schema
        }
      })
    });

    const rawText = await oaiResp.text();
    let data;
    try { data = JSON.parse(rawText); } catch { data = null; }

    if (!oaiResp.ok) {
      return res.status(oaiResp.status).json({ error: "OpenAI error", detail: rawText });
    }

    let parsed = data?.output_parsed || data?.parsed;
    if (!parsed) {
      const maybeText = data?.output?.[0]?.content?.[0]?.text;
      try { parsed = JSON.parse(maybeText); } catch { parsed = null; }
    }

    if (!parsed || !Array.isArray(parsed.items)) {
      parsed = { items: [] };
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
