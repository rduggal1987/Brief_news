export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const topic = req.query.topic || "India";
  const GROQ_KEY = process.env.GROQ_KEY;

  try {
    // Step 1: Fetch Google News RSS — get up to 50 articles
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en&num=50`;
    const rssRes = await fetch(rssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)" }
    });
    const rssText = await rssRes.text();

    // Step 2: Parse all items
    const items = [...rssText.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 50);

    const articles = await Promise.all(items.map(async (m) => {
      const block = m[1];

      const title = (
        block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
        block.match(/<title>(.*?)<\/title>/)
      )?.[1]?.replace(/\s*-\s*[^-]*$/, "").trim() || "";

      const link = (
        block.match(/<link>(.*?)<\/link>/) ||
        block.match(/<guid[^>]*>(.*?)<\/guid>/)
      )?.[1]?.trim() || "#";

      const source = block.match(/<source[^>]*>(.*?)<\/source>/)?.[1]?.trim() || "Google News";

      const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() || "";

      let image = "";
      const mediaMatch = block.match(/<media:content[^>]*url=["'](.*?)["']/);
      if (mediaMatch) image = mediaMatch[1];

      if (!image) {
        const enclosureMatch = block.match(/<enclosure[^>]*url=["'](.*?)["']/);
        if (enclosureMatch) image = enclosureMatch[1];
      }

      if (!image) {
        const descMatch = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/);
        if (descMatch) {
          const imgMatch = descMatch[1].match(/<img[^>]*src=["'](.*?)["']/);
          if (imgMatch) image = imgMatch[1];
        }
      }

      if (!image && link && link !== "#") {
        try {
          const pageRes = await fetch(link, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)" },
            signal: AbortSignal.timeout(3000)
          });
          const pageText = await pageRes.text();
          const ogMatch =
            pageText.match(/<meta[^>]*property=["']og:image["'][^>]*content=["'](.*?)["']/i) ||
            pageText.match(/<meta[^>]*content=["'](.*?)["'][^>]*property=["']og:image["']/i);
          if (ogMatch) image = ogMatch[1];
        } catch (e) {}
      }

      return { title, link, source, pubDate, image };
    }));

    const validArticles = articles.filter(a => a.title);

    if (!validArticles.length) {
      return res.status(200).json({ error: "No articles found for this topic." });
    }

    // Step 3: Summarize in batches of 10 to avoid Groq token limits
    const batchSize = 10;
    const allSummaries = [];

    for (let i = 0; i < validArticles.length; i += batchSize) {
      const batch = validArticles.slice(i, i + batchSize);

      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_KEY}`
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.3,
          max_tokens: 3000,
          messages: [
            {
              role: "system",
              content: `You are a news summarizer like Inshorts. Given news headlines, return ONLY a valid JSON array. No markdown, no explanation. Each object has: "short_title" (max 8 words, catchy), "summary" (strictly under 60 words, simple English).`
            },
            {
              role: "user",
              content: `Summarize these ${batch.length} headlines:\n${batch.map((a, idx) => `${idx + 1}. ${a.title}`).join("\n")}\n\nReturn ONLY the JSON array with exactly ${batch.length} objects.`
            }
          ]
        })
      });

      const groqData = await groqRes.json();
      const raw = groqData.choices?.[0]?.message?.content || "[]";
      const clean = raw.replace(/```json|```/g, "").trim();
      const start = clean.indexOf("[");
      const end = clean.lastIndexOf("]");
      const batchSummaries = JSON.parse(clean.substring(start, end + 1));
      allSummaries.push(...batchSummaries);
    }

    // Step 4: Merge everything
    const result = allSummaries.map((s, i) => ({
      short_title: s.short_title,
      summary: s.summary,
      source: validArticles[i]?.source || "Google News",
      link: validArticles[i]?.link || "#",
      image: validArticles[i]?.image || "",
      pubDate: validArticles[i]?.pubDate || ""
    }));

    return res.status(200).json({ articles: result, total: result.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
