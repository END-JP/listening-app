// /api/generate-dialogue.js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // JSON本文を堅牢に読む
  let body = {};
  try {
    if (req.body && typeof req.body === "object") {
      body = req.body;
    } else {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      body = raw ? JSON.parse(raw) : {};
    }
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { keyword } = body || {};
  if (!keyword) return res.status(400).json({ error: "keyword required" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY not set" });

  // 1) 会話文生成（B1想定・元と雰囲気を保ちつつ別シチュ）
  const prompt = [
    "You are an expert ESL teacher. Create a short, natural-sounding dialogue (6–8 turns) for listening practice.",
    `Target level: CEFR B1. Use the keyword naturally: "${keyword}".`,
    "Make it a different situation from the original lesson, but keep a similar casual tone and usefulness.",
    "Keep utterances short and conversational. Do not add explanations.",
    "Output format (only lines):",
    "A: ...",
    "B: ...",
  ].join("\n");

  let dialogueText = "";
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.7,
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
    dialogueText = data?.choices?.[0]?.message?.content?.trim() || "";
    if (!dialogueText) {
      return res.status(200).json({ text: "", audio_b64: "", mime: "audio/mpeg" });
    }
  } catch (e) {
    return res.status(500).json({ error: "LLM error", detail: String(e) });
  }

  // 2) TTS（mp3, voice=alloy）
  try {
    const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: dialogueText,
        format: "mp3"
      })
    });

    if (!ttsResp.ok) {
      const errText = await ttsResp.text().catch(()=>"");
      return res.status(ttsResp.status).json({ error: "TTS error", detail: errText });
    }

    const arrayBuf = await ttsResp.arrayBuffer();
    // Node.js ランタイムを想定（Buffer使用）
    const b64 = Buffer.from(arrayBuf).toString("base64");

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).end(JSON.stringify({
      text: dialogueText,
      audio_b64: b64,
      mime: "audio/mpeg"
    }));
  } catch (e) {
    return res.status(500).json({ error: "TTS server error", detail: String(e) });
  }
}
