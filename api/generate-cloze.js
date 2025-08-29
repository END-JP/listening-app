// /api/generate-cloze.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, keyword, num, locale, level } = req.body;

  try {
    const apiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `You are an English teacher.
Make ${num || 3} cloze (fill-in-the-blank) questions from this transcript:

---
${text}
---

Each question should:
- be one short sentence,
- replace exactly one word/phrase with "____",
- include the correct answer(s).

Output JSON array like:
[{"text_with_blanks": "...", "answers": ["..."]}, ...]`,
        // ✅ 新しい書き方
        text: { format: "json" }
      }),
    });

    const data = await apiRes.json();
    console.log("OpenAI raw:", data);

    if (!apiRes.ok) {
      throw new Error(data.error?.message || "OpenAI API error");
    }

    // ✅ 新しい Responses API の出力は data.output[0].content[0].text に入っている
    const raw = data.output?.[0]?.content?.[0]?.text || "[]";
    let items;
    try {
      items = JSON.parse(raw);
    } catch (e) {
      console.error("JSON parse error", e, raw);
      items = [];
    }

    return res.status(200).json({ items });

  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ error: String(err) });
  }
}
