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
        env.MODEL_PRIMARY || "google/gemini-2.5-flash:free",
        env.MODEL_FALLBACK || "meta-llama/llama-3.3-70b-instruct:free"
      ];

      let parsed = null;
      let lastErr = null;

      for (const model of models) {
        try {
          const raw = await callOpenRouter(env.OPENROUTER_API_KEY, model, sys, user);
          let text = raw?.choices?.[0]?.message?.content || "{}";

          // Resilient JSON extraction
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) text = jsonMatch[0];

          const obj = JSON.parse(text);
          if (isValid(obj)) {
            parsed = obj;
            break;
          }
          lastErr = `invalid schema: ${JSON.stringify(obj).slice(0, 100)}`;
        } catch (e) {
          lastErr = `parse/call error: ${String(e?.message || e)}`;
        }
      }

      if (!parsed) {
        return json({
          error: "AI_FAILURE",
          detail: lastErr,
          narration: "The Oracle's voice fades into static. Check your connection.",
          choices: ["Try again", "Reset luck", "Wait...", "Force path"],
          risk: "mid",
          tag: "hazard"
        }, 200);
      }

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

async function callOpenRouter(apiKey, model, systemPrompt, userObj) {
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
    })
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
