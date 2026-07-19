// Vercel serverless function: POST { image: base64string, mediaType: "image/jpeg" } or { text: "..." }
// Keeps GEMINI_API_KEY server-side - never expose it in app.js/config.js, since those
// ship to the client and anyone could read the key out of the network tab otherwise.
// Set GEMINI_API_KEY in Vercel: Project Settings -> Environment Variables.
// Free key: https://aistudio.google.com/apikey

const SYSTEM_PROMPT = `Du bist ein Ernährungs-Schätzer für eine Fitness-App. Du bekommst entweder ein Foto einer Mahlzeit
oder eine kurze Textbeschreibung einer Mahlzeit.
Schätze realistisch die Portionsgröße und die Makronährstoffe insgesamt (wenn mehrere
Speisen genannt/zu sehen sind, fasse sie zu einer Gesamtschätzung zusammen, z. B. "Teller mit Nudeln und Hähnchen").
Fülle IMMER alle Felder aus (food_name, grams, calories, protein, carbs, fat, confidence) - niemals leer lassen oder weglassen.
Prüfe deine Zahlen auf Plausibilität, bevor du antwortest (z. B. 2 Eier ≈ 12-14 g Protein, nicht 140 g - Größenordnung zählt).
Wenn kein Essen erkennbar ist, setze food_name auf "Kein Essen erkannt", alle Zahlenwerte auf 0 und confidence auf "low".`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    food_name: { type: "STRING" },
    grams: { type: "INTEGER" },
    calories: { type: "INTEGER" },
    protein: { type: "INTEGER" },
    carbs: { type: "INTEGER" },
    fat: { type: "INTEGER" },
    confidence: { type: "STRING", enum: ["high", "medium", "low"] }
  },
  required: ["food_name", "grams", "calories", "protein", "carbs", "fat", "confidence"],
  propertyOrdering: ["food_name", "grams", "calories", "protein", "carbs", "fat", "confidence"]
};

const MODEL = "gemini-3.1-flash-lite";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const { image, mediaType, text } = req.body || {};
  const isImageRequest = Boolean(image && mediaType);
  const isTextRequest = Boolean(text && text.trim().length >= 3);
  if (!isImageRequest && !isTextRequest) {
    res.status(400).json({ error: "missing_input" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "server_not_configured" });
    return;
  }

  const parts = isImageRequest
    ? [
        { inline_data: { mime_type: mediaType, data: image } },
        { text: "Schätze Nährwerte für dieses Foto." }
      ]
    : [{ text: `Schätze Nährwerte für: ${text.trim()}` }];

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      res.status(502).json({ error: "ai_request_failed", detail });
      return;
    }

    const data = await response.json();
    const textOut = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const finishReason = data.candidates?.[0]?.finishReason;
    if (!textOut) {
      res.status(502).json({ error: "empty_ai_response", detail: `finishReason: ${finishReason || "unknown"}` });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(textOut.trim());
    } catch (e) {
      // Fall back for cases where the model still wraps the JSON in ```json fences or adds
      // stray text around it despite responseMimeType - strip fences, then grab the first
      // {...} block as a last resort before giving up.
      try {
        const stripped = textOut.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(stripped);
      } catch (e2) {
        const match = textOut.match(/\{[\s\S]*\}/);
        if (match) {
          try { parsed = JSON.parse(match[0]); } catch (e3) { /* give up below */ }
        }
      }
    }

    if (!parsed) {
      res.status(502).json({ error: "unparseable_ai_response", detail: textOut.slice(0, 500) });
      return;
    }

    if (!parsed.grams && !parsed.calories) {
      res.status(200).json({ error: "no_food_detected" });
      return;
    }

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: "server_error", detail: String(e) });
  }
}
