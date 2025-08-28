// /api/generate-cloze.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Vercel (Node.js) では JSON を自動でパースして req.body に入れてくれます
    const { text, keyword = '', num = 4, locale = 'en', level = 'B1' } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required (string)' });
    }
    const trimmed = text.slice(0, 8000); // 安全のため上限

    // Responses API に JSON Schema を渡して「壊れないJSON」を強制
    const jsonSchema = {
      name: "ClozeItems",
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

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: [
              { type: "text", text: [
                "You are an expert ESL listening teacher.",
                "Create high-quality cloze (fill-in-the-blank) questions that train real-world listening.",
                `Return strict JSON per the provided schema. Exactly ${num} items if the text allows.`,
                "Rules:",
                "- Prefer discourse markers, reductions, collocations, phrasal verbs, function words.",
                "- Keep a single continuous blank per item.",
                "- Do not change any other words; preserve original casing and punctuation.",
                "- answers must be the exact original substring(s) replaced by the blank.",
                `- Learner level target: ${level}.`,
                `- UI hints language: ${locale}.`,
                keyword ? `- If pedagogically salient, you may target the keyword: "${keyword}".` : ""
              ].join("\n") }
            ]
          },
          {
            role: "user",
            content: [{ type: "text", text: `Transcript:\n${trimmed}` }]
          }
        ],
        response_format: { type: "json_schema", json_schema: jsonSchema }
      })
    });

    if (!resp.ok) {
      const t = await resp.text();
      return res.status(resp.status).json({ error: `OpenAI error: ${t}` });
    }

    const data = await resp.json();

    // Responses API の返り値はモデルや設定で形が揺れます。複数パスで安全に取り出す
    let parsed = null;
    try {
      // 典型: data.output[0].content[0].text にJSON文字列
      if (data?.output?.[0]?.content?.[0]?.type === "output_text") {
        parsed = JSON.parse(data.output[0].content[0].text);
      }
    } catch (_) { /* fallbackへ */ }

    if (!parsed) {
      // 互換: 既にパース済みの output_parsed / 旧choices系
      parsed = data.output_parsed
        || (typeof data === 'object' ? data : null)
        || { items: [] };
    }

    // 最低限の形を保証
    if (!parsed.items || !Array.isArray(parsed.items)) {
      parsed = { items: [] };
    }
    return res.status(200).json(parsed);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}
