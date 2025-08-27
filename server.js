// server.js — تصنيف أكل عام + قيم غذائية لكل 100غ (OpenRouter)
require("dotenv").config();

const express = require("express");
const path = require("path");

// fetch مدمجة في Node 18+، وسقوط على node-fetch لو ناقصة
const fetch =
  globalThis.fetch ||
  ((...args) => import("node-fetch").then(({ default: f }) => f(...args)));

const app = express();

// ====================== الإعدادات ======================
const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || ""; // انتقال سلس
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_SITE_URL =
  process.env.OPENROUTER_SITE_URL || "http://localhost:5001";
const OPENROUTER_APP_NAME = process.env.OPENROUTER_APP_NAME || "Food Classifier Dev";
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

// تقديم واجهة الموقع
app.use(express.static(path.join(__dirname)));
app.use(express.json({ limit: "15mb" }));

// صفحة رئيسية
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// طباعة حالة المفتاح
console.log(
  OPENROUTER_API_KEY
    ? `🔐 Using OpenRouter key (len=${OPENROUTER_API_KEY.length}, startsWith=${OPENROUTER_API_KEY.slice(0,3)}...)`
    : "❌ OPENROUTER_API_KEY is MISSING in .env"
);

/**
 * POST /api/classify
 * body: { imageBase64: DataURL | base64 }
 * return JSON:
 * {
 *   label, label_ar, score,
 *   calories_100g, protein_100g, carbs_100g, fat_100g, fiber_100g
 * }
 */
app.post("/api/classify", async (req, res) => {
  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 مطلوب" });
    }
    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({
        error: "missing_api_key",
        message: "مفتاح OpenRouter غير موجود في .env (OPENROUTER_API_KEY)",
      });
    }

    // ضمن أنه DataURL
    const imageUrl = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    // نطلب من الموديل JSON صارم
    const apiRes = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": OPENROUTER_SITE_URL, // اختياري
        "X-Title": OPENROUTER_APP_NAME,      // اختياري
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 350,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  'You are a nutrition assistant. Analyze the food image and reply ONLY strict JSON with keys EXACTLY:\n' +
                  '{"label":"<english name>","label_ar":"<arabic name>",' +
                  '"calories_100g":<number>,"protein_100g":<number>,' +
                  '"carbs_100g":<number>,"fat_100g":<number>,"fiber_100g":<number>,' +
                  '"confidence":<0..1>}.\n' +
                  'All values are approximate averages per 100 grams. No extra text, no code fences.',
              },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    const data = await apiRes.json().catch(() => ({}));
    if (!apiRes.ok) {
      console.error("OpenRouter error status:", apiRes.status);
      console.error("OpenRouter error body:", data);
      return res.status(apiRes.status).json({ error: "openrouter_error", details: data });
    }

    // نص الرد
    const text =
      data?.choices?.[0]?.message?.content?.trim
        ? data.choices[0].message.content.trim()
        : "";

    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      console.warn("JSON parse failed. Raw text:", text);
      return res.status(500).json({
        error: "parse_error",
        message: "فشلنا نفك JSON من ردّ النموذج",
        raw: text,
      });
    }

    // دوال مساعدة
    const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
    const clamp01 = (v) =>
      typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;

    // قيم آمنة
    const labelEn =
      typeof parsed.label === "string" && parsed.label.trim()
        ? parsed.label.trim()
        : "unknown";
    const labelAr =
      typeof parsed.label_ar === "string" && parsed.label_ar.trim()
        ? parsed.label_ar.trim()
        : "غير معروف";

    const payload = {
      label: labelEn.toLowerCase(),
      score: clamp01(parsed.confidence),
      label_ar: labelAr,
      calories_100g:
        num(parsed.calories_100g) !== null ? Math.max(0, Math.round(parsed.calories_100g)) : null,
      protein_100g: num(parsed.protein_100g),
      carbs_100g:   num(parsed.carbs_100g),
      fat_100g:     num(parsed.fat_100g),
      fiber_100g:   num(parsed.fiber_100g),
    };

    return res.json(payload);
  } catch (err) {
    console.error("Server classify error:", err?.stack || err);
    return res.status(500).json({
      error: "server_error",
      message: String(err?.message || err),
    });
  }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
