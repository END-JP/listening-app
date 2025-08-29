export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = {};
  try {
    body = await new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", chunk => raw += chunk);
      req.on("end", () => resolve(JSON.parse(raw || "{}")));
      req.on("error", reject);
    });
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { keyword } = body;
  if (!keyword) return res.status(400).json({ error: "keyword required" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY not set" });

  const prompt = `
You are an expert ESL teacher. 
Generate a short dialogue (6–8 turns) for listening practice.
- Use the keyword: "${keyword}" naturally in the conversation.
- Make it a different situation from the original script, but keep the same casual tone.
- The dialogue should be useful for learners (CEFR B1 level).
- Output only the conversation lines, like:
A: ...
B: ...
  `;

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      })
    });
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || "";
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e) });
  }
}
