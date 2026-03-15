export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const topic = req.query.topic || "India";
  const GROQ_KEY = process.env.GROQ_KEY;

  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`;
    const rssRes = await fetch(rssUrl);
    const rssText = await rssRes.text();

    const items = [...rssText.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8);
    const articles = items.map(m => {
      const block = m[1];
      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/))?.[1]?.replace(/\s*-\s*[^-]*$/, "").trim() || "";
      const link = (block.match(/<link>(.*?)<\/link>/) || block.match(/<guid>(.*?)<\/guid>/))?.[1]?.trim() || "#";
      const source = block.match(/<source[^>]*>(.*?)<\/source>/)?.[1]?.trim() || "Google News";
      return { title, link, source };
    }).filter(a => a.title);

    if (!articles.length) {
      return res.status(200).json({ error: "No articles found for this topic." });
    }

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.3,
        max_tokens: 2000,
        messages: [
          {
            role: "system",
            content: `You are a news summarizer like Inshorts. Given news headlines, return ONLY a valid JSON array. No markdown, no explanation. Each object has: "short_title" (max 8 words), "summary" (strictly under 60 words, simple English).`
          },
          {
            role: "user",
            content: `Summarize these headlines:\n${articles.map((a, i) => `${i + 1}. ${a.title}`).join("\n")}\n\nReturn ONLY the JSON array.`
          }
        ]
      })
    });

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content || "[]";
    const clean = raw.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("[");
    const end = clean.lastIndexOf("]");
    const summaries = JSON.parse(clean.substring(start, end + 1));

    const result = summaries.map((s, i) => ({
      short_title: s.short_title,
      summary: s.summary,
      source: articles[i]?.source || "Google News",
      link: articles[i]?.link || "#"
    }));

    return res.status(200).json({ articles: result });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
