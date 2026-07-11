// Serverless function (Vercel) - proxy Text-to-Speech.
// Trả về file mp3 TỪ CHÍNH TÊN MIỀN của app, nên không bị WebView (app Notion
// trên Android) chặn vì cross-origin/ORB. Nhờ đó phát âm được ngay trong embed.

// Google Translate TTS giới hạn ~200 ký tự mỗi lần -> tự chia nhỏ rồi ghép lại.
function chunkText(text, max = 190) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const chunks = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      if (cur) chunks.push(cur.trim());
      if (w.length > max) {
        for (let i = 0; i < w.length; i += max) chunks.push(w.slice(i, i + max));
        cur = "";
      } else {
        cur = w;
      }
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) chunks.push(cur.trim());
  return chunks.length ? chunks : [String(text).slice(0, max)];
}

async function fetchChunk(chunk, tl) {
  const url =
    "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" +
    encodeURIComponent(tl) +
    "&q=" +
    encodeURIComponent(chunk);
  const upstream = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://translate.google.com/",
    },
  });
  if (!upstream.ok) {
    throw new Error("Upstream " + upstream.status);
  }
  return Buffer.from(await upstream.arrayBuffer());
}

export default async function handler(req, res) {
  const text = (req.query.text || "").toString().trim();
  const tl = (req.query.tl || "en").toString().slice(0, 10);

  if (!text) {
    res.status(400).send("Missing text");
    return;
  }
  // Giới hạn độ dài để tránh lạm dụng.
  const safeText = text.slice(0, 800);

  try {
    const chunks = chunkText(safeText);
    const buffers = [];
    for (const c of chunks) {
      buffers.push(await fetchChunk(c, tl));
    }
    const audio = Buffer.concat(buffers);

    res.setHeader("Content-Type", "audio/mpeg");
    // Cache trên CDN của Vercel để giảm số lần gọi hàm (tiết kiệm hạn mức).
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
    res.status(200).send(audio);
  } catch (e) {
    res.status(502).send("TTS failed");
  }
}
