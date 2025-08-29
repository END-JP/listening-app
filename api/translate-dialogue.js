// /api/translate-dialogue.js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = {};
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { text } = body;
  if (!text) return res.status(400).json({ error: "text required" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY not set" });

  const prompt = [
    "あなたは優れた英語教師兼翻訳者です。",
    "以下の英語の会話を、日本人学習者向けに自然でわかりやすい日本語に翻訳してください。",
    "直訳ではなく、自然な口語で。学習者が理解しやすいように意訳も取り入れてください。",
    "",
    text
  ].join("\n");

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
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: prompt }
        ]
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: "OpenAI error", detail: data });
    }

    const translation = data?.choices?.[0]?.message?.content?.trim() || "";
    res.status(200).json({ translation });
  } catch (e) {
    res.status(500).json({ error: "Translation error", detail: String(e) });
  }
}
