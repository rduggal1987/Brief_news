export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const topic = req.query.topic || "India";
  const GROQ_KEY = process.env.GROQ_KEY;
  const log = [];

  // Test 1: Check GROQ_KEY exists
  log.push(`GROQ_KEY set: ${GROQ_KEY ? "YES ✅" : "NO ❌"}`);

  // Test 2: Fetch Google News RSS
  let rssStatus = "";
  let rssItemCount = 0;
  let firstTitle = "";
  let firstPubDate = "";

  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`;
    const rssRes = await fetch(rssUrl, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache" }
    });
    rssStatus = `HTTP ${rssRes.status}`;
    const rssText = await rssRes.text();
    const items = rssText.match(/<item>[\s\S]*?<\/item>/g) || [];
    rssItemCount = items.length;

    if (items[0]) {
      const titleMatch = items[0].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || items[0].match(/<title>(.*?)<\/title>/);
      firstTitle = titleMatch?.[1] || "no title found";
      const dateMatch = items[0].match(/<pubDate>(.*?)<\/pubDate>/);
      firstPubDate = dateMatch?.[1] || "no date found";
    }

    log.push(`RSS fetch status: ${rssStatus}`);
    log.push(`RSS items found: ${rssItemCount}`);
    log.push(`First title: ${firstTitle}`);
    log.push(`First pubDate: ${firstPubDate}`);
    log.push(`Server time now: ${new Date().toISOString()}`);

  } catch (e) {
    log.push(`RSS fetch error: ${e.message}`);
  }

  // Test 3: Test Groq connection
  let groqStatus = "";
  try {
    const groqTest = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { "Authorization": `Bearer ${GROQ_KEY}` }
    });
    groqStatus = `HTTP ${groqTest.status}`;
    log.push(`Groq connection: ${groqStatus}`);
  } catch (e) {
    log.push(`Groq connection error: ${e.message}`);
  }

  return res.status(200).json({
    debug: log,
    timestamp: new Date().toISOString(),
    topic
  });
}
