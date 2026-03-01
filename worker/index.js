export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }
    if (request.method !== "POST") {
      return json({ ok: true, service: "scroll-and-sword-api" }, 200);
    }

    try {
      const body = await request.json();
      const { theme, hp, act, step, previousChoice, history } = body || {};

      if (!theme || !act || !step) {
        return json({ error: "missing fields" }, 400);
      }

      const sys = [
        "You are the narrator for a pixel RPG called Scroll and Sword.",
        "MANDATORY: Return ONLY a raw JSON object. No markdown blocks. No extra text.",
        "Narration: 1-3 gritty, actionable sentences.",
        "Choices: Exactly 4 separate options, 3-8 words each.",
        "Risk: 'low'|'mid'|'high'.",
        "Tag: 'combat'|'exploration'|'social'|'hazard'|'boss'.",
      ].join(" ");

      const schemaHint = {
        narration: "string",
        choices: ["string", "string", "string", "string"],
        risk: "low|mid|high",
        tag: "combat|exploration|social|hazard|boss"
      };

      const user = {
        game: "Scroll and Sword",
        theme,
        hp,
        act,
        step,
        previousChoice: previousChoice || null,
        history: Array.isArray(history) ? history.slice(-6) : [],
        outputSchema: schemaHint
      };

      const models = [
        "meta-llama/llama-3.1-8b-instruct:free",
        "google/gemini-2.0-flash:free",
        "google/gemini-2.0-flash-lite-preview-02-05:free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "mistralai/mistral-7b-instruct:free",
        "nousresearch/hermes-3-llama-3.1-8b:free",
        "google/gemma-2-9b-it:free",
        "microsoft/phi-3-mini-128k-instruct:free",
        "qwen/qwen2.5-72b-instruct:free",
        "openrouter/auto-free"
      ];

      let parsed = null;
      let lastErr = null;
      let usedModel = null;

      for (const model of models) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

          const raw = await callOpenRouter(env.OPENROUTER_API_KEY, model, sys, user, controller.signal);
          clearTimeout(timeoutId);

          let text = raw?.choices?.[0]?.message?.content || "{}";
          text = text.replace(/```json/g, "").replace(/```/g, "").trim();

          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) text = jsonMatch[0];

          const obj = JSON.parse(text);
          if (isValid(obj)) {
            parsed = obj;
            usedModel = model;
            break;
          }
          lastErr = `Invalid JSON from ${model}: ${text.slice(0, 50)}`;
        } catch (e) {
          const isTimeout = e.name === "AbortError";
          lastErr = `${model} ${isTimeout ? "TIMED OUT" : "FAILED"}: ${e.message || e}`;
          console.log(lastErr);
        }
      }

      if (!parsed) {
        return json({
          error: "AI_EXHAUSTED",
          detail: lastErr,
          narration: "The Oracle remains silent after ten attempts. The stars are clouded.",
          choices: ["RETRY ORACLE", "BACK TO MENU", "TRY DIFFERENT PATH", "FORCE AWAKENING"],
          risk: "high",
          tag: "hazard",
          _source: "error"
        }, 503);
      }

      parsed._model = usedModel;
      parsed._source = "ai";
      return json(parsed, 200);
    } catch (e) {
      return json({
        narration: "A mechanical hush falls before danger returns.",
        choices: ["Scout ahead", "Charge", "Hide", "Parley"],
        risk: "mid",
        tag: "exploration",
        _error: String(e?.message || e)
      }, 200);
    }
  }
};

async function callOpenRouter(apiKey, model, systemPrompt, userObj, signal) {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://badrazzam9.github.io",
      "X-Title": "Scroll and Sword"
    },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      max_tokens: 220,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userObj) }
      ]
    }),
    signal
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`openrouter ${resp.status}: ${t.slice(0, 300)}`);
  }
  return resp.json();
}

function isValid(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.narration !== "string" || !obj.narration.trim()) return false;
  if (!Array.isArray(obj.choices) || obj.choices.length !== 4) return false;
  if (!obj.choices.every((c) => typeof c === "string" && c.trim())) return false;
  if (!["low", "mid", "high"].includes(obj.risk)) return false;
  if (!["combat", "exploration", "social", "hazard", "boss"].includes(obj.tag)) return false;
  return true;
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors() }
  });
}
