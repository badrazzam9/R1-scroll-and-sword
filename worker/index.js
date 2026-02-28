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
        "You are the narrator for a compact pixel RPG called Scroll and Sword.",
        "Return STRICT JSON only.",
        "Keep narration 1-3 sentences, gritty, vivid, actionable.",
        "Provide exactly 4 choices, each 3-8 words.",
        "Set risk one of: low|mid|high.",
        "Set tag one of: combat|exploration|social|hazard|boss.",
        "No markdown. No extra keys."
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
        env.MODEL_PRIMARY || "openai/gpt-4o-mini",
        env.MODEL_FALLBACK || "meta-llama/llama-3.1-8b-instruct"
      ];

      let parsed = null;
      let lastErr = null;

      for (const model of models) {
        try {
          const raw = await callOpenRouter(env.OPENROUTER_API_KEY, model, sys, user);
          const text = raw?.choices?.[0]?.message?.content || "{}";
          const obj = JSON.parse(text);
          if (isValid(obj)) {
            parsed = obj;
            break;
          }
          lastErr = "invalid schema";
        } catch (e) {
          lastErr = String(e?.message || e);
        }
      }

      if (!parsed) {
        // fail-safe scene
        parsed = {
          narration: "Static crackles through the dark corridor as your next move decides everything.",
          choices: [
            "Advance with caution",
            "Set an ambush",
            "Attempt negotiation",
            "Retreat to recover"
          ],
          risk: "mid",
          tag: "exploration"
        };
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
      response_format: { type: "json_object" },
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
