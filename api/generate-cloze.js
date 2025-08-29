// /api/generate-cloze.js  — Robust version
export default async function handler(req, res) {
  // 同一オリジンからの呼び出しのみ想定。CORSは不要
  if (req.method !== 'POST') {
    // 簡易ヘルスチェック（ブラウザで直アクセスしたとき用）
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).end(JSON.stringify({ ok: true, route: '/api/generate-cloze' }));
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // --- JSON本文を堅牢に読む（環境により req.body が空のことがあるため） ---
    let payload = {};
    try {
      if (req.body && typeof req.body === 'object') {
        payload = req.body;
      } else {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        payload = raw ? JSON.parse(raw) : {};
      }
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const { text, keyword = '', num = 4, locale = 'en', level = 'B1' } = payload || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required (string)' });
    }
    const trimmed = text.slice(0, 8000); // 安全のため上限

    // --- JSON Schema（壊れないJSONを要求） ---
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

    // --- OpenAI Responses API 呼び出し ---
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not set' });
    }

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
              { type: "text", text: [
                "You are an expert ESL listening teacher.",
                "Create high-quality cloze (fill-in-the-blank) questions for listening training.",
                `Return strict JSON per the provided schema. Exactly ${num} items if the text allows.`,
                "Rules:",
                "- Prefer discourse markers, reductions, collocations, phrasal verbs, function words.",
                "- One continuous blank per item; preserve all other words and punctuation.",
                "- answers must be the exact original substring replaced by the blank.",
                `- Learner level: ${level}.`,
                `- UI hints language: ${locale}.`,
                keyword ? `- Consider the pedagogical keyword: "${keyword}".` : ""
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

    if (!oaiResp.ok) {
      const t = await oaiResp.text().catch(()=>'');
      return res.status(oaiResp.status).json({ error: `OpenAI error`, detail: t });
    }

    const data = await oaiResp.json();

    // --- 返却の取り出しパスを複数用意（揺れ対策） ---
    let parsed = null;
    try {
      if (data?.output?.[0]?.content?.[0]?.type === "output_text") {
        parsed = JSON.parse(data.output[0].content[0].text);
      }
    } catch (_) {}

    if (!parsed) {
      if (data?.output_parsed) parsed = data.output_parsed;
      else if (data?.items) parsed = { items: data.items };
    }
    if (!parsed || !Array.isArray(parsed.items)) {
      parsed = { items: [] };
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).end(JSON.stringify(parsed));
  } catch (e) {
    console.error('Server error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
