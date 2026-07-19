// Vercel serverless function: POST { image: base64string, mediaType: "image/jpeg" } or { text: "..." }
// Keeps GEMINI_API_KEY server-side - never expose it in app.js/config.js, since those
// ship to the client and anyone could read the key out of the network tab otherwise.
// Set GEMINI_API_KEY in Vercel: Project Settings -> Environment Variables.
// Free key: https://aistudio.google.com/apikey

const SYSTEM_PROMPT = `Du bist ein Ernährungs-Schätzer für eine Fitness-App. Du bekommst entweder ein Foto einer Mahlzeit
oder eine kurze Textbeschreibung einer Mahlzeit.
Schätze realistisch die Portionsgröße und die Makronährstoffe insgesamt (wenn mehrere
Speisen genannt/zu sehen sind, fasse sie zu einer Gesamtschätzung zusammen, z. B. "Teller mit Nudeln und Hähnchen").
Antworte NUR mit validem JSON, exakt in diesem Format:
{"food_name": "kurzer deutscher Name", "grams": Zahl, "calories": Zahl, "protein": Zahl, "carbs": Zahl, "fat": Zahl, "confidence": "high"|"medium"|"low"}
Wenn kein Essen erkennbar ist, antworte exakt mit {"error": "no_food_detected"}`;

const MODEL = "gemini-flash-latest";

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
            maxOutputTokens: 300
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
    if (!textOut) {
      res.status(502).json({ error: "empty_ai_response" });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(textOut.trim());
    } catch (e) {
      res.status(502).json({ error: "unparseable_ai_response" });
      return;
    }

    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: "server_error", detail: String(e) });
  }
}
