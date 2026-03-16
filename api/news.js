export default async function handler(req, res) {

  // ── Disable ALL caching — always fetch fresh news ──────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();

  const topic = req.query.topic || "India";
  const GROQ_KEY = process.env.GROQ_KEY;

  if (!GROQ_KEY) {
    return res.status(500).json({ error: "GROQ_KEY environment variable is not set." });
  }

  try {

    // ── STEP 1: Fetch Google News RSS with cache-busting ───────────
    const cacheBuster = Date.now();
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en&_=${cacheBuster}`;

    const rssRes = await fetch(rssUrl, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      }
    });

    if (!rssRes.ok) {
      return res.status(500).json({ error: `Failed to fetch Google News: ${rssRes.status}` });
    }

    const rssText = await rssRes.text();
    const rawItems = rssText.match(/<item>[\s\S]*?<\/item>/g) || [];
    const items = rawItems.slice(0, 30);

    if (items.length === 0) {
      return res.status(200).json({ articles: [], total: 0 });
    }

    // ── STEP 2: Parse RSS items ────────────────────────────────────
    const parsed = items.map((item) => {

      let title = "";
      const titleCdata = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/);
      const titlePlain = item.match(/<title>([\s\S]*?)<\/title>/);
      if (titleCdata) title = titleCdata[1];
      else if (titlePlain) title = titlePlain[1];
      title = title.replace(/<[^>]+>/g, "").replace(/\s*-\s*[^-]*$/, "").trim();

      let link = "#";
      const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
      const guidMatch = item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/);
      if (linkMatch) link = linkMatch[1].trim();
      else if (guidMatch) link = guidMatch[1].trim();

      let source = "Google News";
      const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      if (sourceMatch) source = sourceMatch[1].replace(/<[^>]+>/g, "").trim();

      let pubDate = "";
      const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      if (dateMatch) pubDate = dateMatch[1].trim();

      return { title, link, source, pubDate };
    }).filter(a => a.title.length > 5);

    // ── STEP 3: Fetch og:image from each article page ──────────────
    const withImages = await Promise.all(
      parsed.map(async (article) => {
        let image = "";
        try {
          if (article.link && article.link !== "#") {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);

            const pageRes = await fetch(article.link, {
              signal: controller.signal,
              cache: "no-store",
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
                "Cache-Control": "no-cache"
              }
            });
            clearTimeout(timeout);

            if (pageRes.ok) {
              const reader = pageRes.body.getReader();
              let html = "";
              let done = false;

              while (!done && html.length < 10000) {
                const { value, done: d } = await reader.read();
                done = d;
                if (value) html += new TextDecoder().decode(value);
              }
              reader.cancel();

              // Try og:image
              const ogImg =
                html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["'](https?:\/\/[^"']+)["']/i) ||
                html.match(/<meta[^>]*content=["'](https?:\/\/[^"']+)["'][^>]*property=["']og:image["']/i);
              if (ogImg) image = ogImg[1];

              // Fallback: twitter:image
              if (!image) {
                const twitterImg =
                  html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["'](https?:\/\/[^"']+)["']/i) ||
                  html.match(/<meta[^>]*content=["'](https?:\/\/[^"']+)["'][^>]*name=["']twitter:image["']/i);
                if (twitterImg) image = twitterImg[1];
              }

              // Fallback: first img src
              if (!image) {
                const imgTag = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*?)["']/i);
                if (imgTag) image = imgTag[1];
              }
            }
          }
        } catch (e) {}

        return { ...article, image };
      })
    );

    if (withImages.length === 0) {
      return res.status(200).json({ articles: [], total: 0 });
    }

    // ── STEP 4: Summarize with Groq ────────────────────────────────
    const headlines = withImages.map((a, i) => `${i + 1}. ${a.title}`).join("\n");

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
            content: "You are a news summarizer like Inshorts. Return ONLY a valid JSON array. No markdown. No explanation. Each object must have: short_title (max 8 words) and summary (max 60 words, simple English)."
          },
          {
            role: "user",
            content: `Summarize each of these ${withImages.length} headlines. Return a JSON array with exactly ${withImages.length} objects.\n\n${headlines}`
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
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const jsonStart = cleaned.indexOf("[");
    const jsonEnd = cleaned.lastIndexOf("]");

    if (jsonStart === -1 || jsonEnd === -1) {
      return res.status(500).json({ error: "Groq returned unexpected format. Please try again." });
    }

    const summaries = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));

    // ── STEP 5: Merge and return with timestamp ────────────────────
    const articles = withImages.map((p, i) => ({
      short_title: summaries[i]?.short_title || p.title,
      summary: summaries[i]?.summary || "",
      source: p.source,
      link: p.link,
      image: p.image,
      pubDate: p.pubDate
    }));

    return res.status(200).json({
      articles,
      total: articles.length,
      fetchedAt: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({ error: `Server error: ${err.message}` });
  }
}
