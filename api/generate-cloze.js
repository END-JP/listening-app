// /api/generate-cloze.js  — Responses API (text.format=json_schema) 完全版
export default async function handler(req, res) {
  // POST 以外は405（簡易ヘルスチェックが必要なら適宜 GET を許可してOK）
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- JSON本文を安全に読む（環境差による req.body 空対策） ---
  let payload = {};
  try {
    if (req.body && typeof req.body === 'object') {
      payload = req.body;
    } else {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      payload = raw ? JSON.parse(raw) : {};
    }
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const {
    text,
    keyword = '',
    num = 4,
    locale = 'en',
    level = 'B1'
  } = payload || {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required (string)' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not set' });
  }

  // 壊れない JSON を返させるスキーマ
  const schema = {
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
  };

  // 長すぎる本文は軽くトリム（任意）
  const trimmed = text.slice(0, 8000);

  try {
    const oaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        // 会話形式（system + user）
        input: [
          {
            role: "system",
            content: [{
              type: "text",
              text: [
                "You are an expert ESL listening teacher.",
                "Create high-quality cloze (fill-in-the-blank) questions for listening training.",
                `Return STRICT JSON via the provided schema. Aim for exactly ${num} items if the text allows.`,
                "Rules:",
                "- Prefer discourse markers, reductions, collocations, phrasal verbs, function words.",
                "- Use ONE continuous blank per item; preserve other words/punctuation.",
                "- answers must be the exact original substring replaced by the blank.",
                `- Learner level target: ${level}.`,
                `- UI hints language: ${locale}.`,
                keyword ? `- Consider the pedagogical keyword: "${keyword}".` : ""
              ].filter(Boolean).join("\n")
            }]
          },
          {
            role: "user",
            content: [{ type: "text", text: `Transcript:\n${trimmed}` }]
          }
        ],
        // ★ 新仕様：text.format に json_schema を指定し、schema/strict を同梱
        text: {
          format: "json_schema",
          schema,
          strict: true
        }
      })
    });

    const rawText = await oaiResp.text(); // まずは生の文字列で取得
    let data;
    try { data = JSON.parse(rawText); } catch { data = null; }

    if (!oaiResp.ok) {
      // OpenAI 側の詳細もそのまま返す（画面に表示される）
      return res.status(oaiResp.status).json({
        error: 'OpenAI error',
        detail: rawText
      });
    }

    // 取り出し：新仕様では parsed がトップレベルで返ることがある
    // 互換のため複数パスを試す
    let parsed = null;

    // 1) 既に構造化された出力（例：output_parsed / parsed など）
    if (data && typeof data === 'object') {
      if (data.output_parsed) parsed = data.output_parsed;
      else if (data.parsed) parsed = data.parsed;
    }

    // 2) テキストとして返ってきた場合（content[0].text にJSON文字列）
    if (!parsed) {
      const maybeText = data?.output?.[0]?.content?.[0]?.text;
      if (typeof maybeText === 'string') {
        try { parsed = JSON.parse(maybeText); } catch { /* noop */ }
      }
    }

    // 3) どうしても無ければ空配列
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
