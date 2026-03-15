export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const topic = req.query.topic || "India";
  const GROQ_KEY = process.env.GROQ_KEY;

  if (!GROQ_KEY) {
    return res.status(500).json({ error: "GROQ_KEY environment variable is not set." });
  }

  try {

    // ── STEP 1: Fetch Google News RSS ──────────────────────────────
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`;

    const rssRes = await fetch(rssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });

    if (!rssRes.ok) {
      return res.status(500).json({ error: `Failed to fetch Google News: ${rssRes.status}` });
    }

    const rssText = await rssRes.text();

    // ── STEP 2: Parse RSS items ────────────────────────────────────
    const rawItems = rssText.match(/<item>[\s\S]*?<\/item>/g) || [];
    const items = rawItems.slice(0, 30);

    if (items.length === 0) {
      return res.status(200).json({ articles: [], total: 0 });
    }

    // Extract basic info from each item
    const parsed = items.map((item) => {

      // Title
      let title = "";
      const titleCdata = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/);
      const titlePlain = item.match(/<title>([\s\S]*?)<\/title>/);
      if (titleCdata) title = titleCdata[1];
      else if (titlePlain) title = titlePlain[1];
      title = title.replace(/<[^>]+>/g, "").replace(/\s*-\s*[^-]*$/, "").trim();

      // Link
      let link = "#";
      const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
      const guidMatch = item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/);
      if (linkMatch) link = linkMatch[1].trim();
      else if (guidMatch) link = guidMatch[1].trim();

      // Source
      let source = "Google News";
      const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      if (sourceMatch) source = sourceMatch[1].replace(/<[^>]+>/g, "").trim();

      // Publication date
      let pubDate = "";
      const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      if (dateMatch) pubDate = dateMatch[1].trim();

      // Image — try multiple locations in RSS
      let image = "";

      const mediaSrc = item.match(/url=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|gif)[^"']*?)["']/i);
      if (mediaSrc) image = mediaSrc[1];

      if (!image) {
        const enclosure = item.match(/<enclosure[^>]*url=["'](https?:\/\/[^"']+)["'][^>]*type=["']image/i);
        if (enclosure) image = enclosure[1];
      }

      if (!image) {
        const descBlock = item.match(/<description>([\s\S]*?)<\/description>/);
        if (descBlock) {
          const decoded = descBlock[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
          const imgTag = decoded.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
          if (imgTag) image = imgTag[1];
        }
      }

      return { title, link, source, pubDate, image };
    }).filter(a => a.title.length > 5);

    if (parsed.length === 0) {
      return res.status(200).json({ articles: [], total: 0 });
    }

    // ── STEP 3: Summarize with Groq in one call ────────────────────
    const headlines = parsed.map((a, i) => `${i + 1}. ${a.title}`).join("\n");

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.3,
        max_tokens: 4000,
        messages: [
          {
            role: "system",
            content: "You are a news summarizer like Inshorts. Return ONLY a valid JSON array. No markdown. No explanation. No extra text. Each object must have exactly two keys: short_title (max 8 words) and summary (max 60 words, simple English)."
          },
          {
            role: "user",
            content: `Summarize each of these ${parsed.length} news headlines. Return a JSON array with exactly ${parsed.length} objects.\n\n${headlines}`
          }
        ]
      })
    });

    if (!groqRes.ok) {
      const groqErr = await groqRes.json();
      return res.status(500).json({ error: `Groq error: ${groqErr.error?.message || groqRes.status}` });
    }

    const groqData = await groqRes.json();
    const rawText = groqData.choices?.[0]?.message?.content || "";

    // Clean and parse JSON
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const jsonStart = cleaned.indexOf("[");
    const jsonEnd = cleaned.lastIndexOf("]");

    if (jsonStart === -1 || jsonEnd === -1) {
      return res.status(500).json({ error: "Groq returned unexpected format. Please try again." });
    }

    const summaries = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));

    // ── STEP 4: Merge and return ───────────────────────────────────
    const articles = parsed.map((p, i) => ({
      short_title: summaries[i]?.short_title || p.title,
      summary: summaries[i]?.summary || "",
      source: p.source,
      link: p.link,
      image: p.image,
      pubDate: p.pubDate
    }));

    return res.status(200).json({ articles, total: articles.length });

  } catch (err) {
    return res.status(500).json({ error: `Server error: ${err.message}` });
  }
}
