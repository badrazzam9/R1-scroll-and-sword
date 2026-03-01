export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }
    if (request.method !== "POST") {
      return json({ ok: true, service: "scroll-and-sword-api", version: "v18" }, 200);
    }

    try {
      const body = await request.json();
      const { theme, hp, step, previousChoice, history } = body || {};

      // Defaults for stability — never reject a request
      const finalTheme = theme || "medieval";
      const finalStep = step || 1;
      const finalHp = hp || 10;

      const sys = [
        "You are the narrator for a pixel RPG called Scroll and Sword.",
        "MANDATORY: Return ONLY a raw JSON object. No markdown. No extra text.",
        "The JSON must have these keys:",
        "narration (string, 1-3 gritty sentences),",
        "choices (array of exactly 4 short strings),",
        "risk (one of: low, mid, high),",
        "tag (one of: combat, exploration, social, hazard, boss).",
        "Example: {\"narration\":\"A shadow looms.\",\"choices\":[\"Fight\",\"Run\",\"Hide\",\"Talk\"],\"risk\":\"mid\",\"tag\":\"combat\"}"
      ].join(" ");

      const userMsg = JSON.stringify({
        theme: finalTheme,
        hp: finalHp,
        step: finalStep,
        previousChoice: previousChoice || null,
        history: Array.isArray(history) ? history.slice(-4) : []
      });

      let parsed = null;
      let lastErr = null;
      let usedModel = null;

      // ═══════════════════════════════════════════════
      // ATTEMPT 1: Cloudflare Workers AI (env.AI)
      // This runs INSIDE Cloudflare — no external keys needed
      // ═══════════════════════════════════════════════
      if (env.AI) {
        try {
          const aiResp = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
            messages: [
              { role: "system", content: sys },
              { role: "user", content: userMsg }
            ],
            max_tokens: 300
            // NOTE: response_format removed — not supported by all CF models
          });

          // Cloudflare AI returns { response: "..." } — extract the string
          const rawText = typeof aiResp === "string" ? aiResp : (aiResp?.response || "");
          const obj = extractJSON(rawText);

          if (obj && isValid(obj)) {
            parsed = obj;
            usedModel = "@cf/llama-3.1-8b";
          } else {
            lastErr = `CF AI returned invalid structure: ${rawText.slice(0, 100)}`;
          }
        } catch (e) {
          lastErr = `CF AI Error: ${e.message}`;
        }
      }

      // ═══════════════════════════════════════════════
      // ATTEMPT 2: OpenRouter fallback (external)
      // ═══════════════════════════════════════════════
      if (!parsed && env.OPENROUTER_API_KEY) {
        const models = [
          "google/gemini-2.0-flash:free",
          "meta-llama/llama-3.1-8b-instruct:free",
          "google/gemini-1.5-flash:free",
          "google/gemma-2-9b-it:free",
          "openrouter/auto-free"
        ];

        for (const model of models) {
          if (parsed) break;
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              const controller = new AbortController();
              const tid = setTimeout(() => controller.abort(), 8000);

              const raw = await callOpenRouter(env.OPENROUTER_API_KEY, model, sys, userMsg, controller.signal);
              clearTimeout(tid);

              const text = raw?.choices?.[0]?.message?.content || "";
              const obj = extractJSON(text);

              if (obj && isValid(obj)) {
                parsed = obj;
                usedModel = model;
                break;
              }
              lastErr = `Invalid JSON from ${model}`;
            } catch (e) {
              lastErr = `${model}: ${e.name === "AbortError" ? "TIMEOUT" : e.message}`;
              if (attempt === 1) await sleep(800);
            }
          }
        }
      }

      // ═══════════════════════════════════════════════
      // ATTEMPT 3: Hardcoded Epic Lore (always works)
      // ═══════════════════════════════════════════════
      if (!parsed) {
        parsed = getHardcodedScene(finalTheme, finalStep, finalHp);
        usedModel = "hardcoded-lore";
      }

      parsed._model = usedModel;
      parsed._source = usedModel === "hardcoded-lore" ? "fallback" : "ai";
      parsed._debug = lastErr || "none";
      return json(parsed, 200);

    } catch (e) {
      // Ultimate safety net — game NEVER breaks
      return json({
        narration: "The Oracle flickers. A path still opens before you.",
        choices: ["Press forward", "Search the shadows", "Hold your ground", "Call for aid"],
        risk: "mid",
        tag: "exploration",
        _source: "emergency",
        _error: String(e?.message || e)
      }, 200);
    }
  }
};

// ═══════════════════════════════════════════════
// Extract JSON from messy LLM output
// ═══════════════════════════════════════════════
function extractJSON(text) {
  if (!text || typeof text !== "string") return null;
  // Strip markdown code fences
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // Find the first { ... } block
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════
// Relaxed validation — accept flexible AI output
// ═══════════════════════════════════════════════
function isValid(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.narration !== "string" || !obj.narration.trim()) return false;
  if (!Array.isArray(obj.choices) || obj.choices.length < 2 || obj.choices.length > 6) return false;

  // Pad to 4 choices if fewer
  while (obj.choices.length < 4) obj.choices.push("Continue onward");
  // Trim to 4 if more
  if (obj.choices.length > 4) obj.choices = obj.choices.slice(0, 4);

  // Normalize risk
  const riskMap = { low: "low", medium: "mid", med: "mid", mid: "mid", high: "high", danger: "high", extreme: "high" };
  obj.risk = riskMap[(obj.risk || "").toLowerCase()] || "mid";

  // Normalize tag
  const validTags = ["combat", "exploration", "social", "hazard", "boss"];
  if (!validTags.includes(obj.tag)) obj.tag = "exploration";

  return true;
}

// ═══════════════════════════════════════════════
// Hardcoded scenes — game is ALWAYS playable
// ═══════════════════════════════════════════════
function getHardcodedScene(theme, step, hp) {
  const scenes = {
    medieval: [
      { narration: "A torchlit corridor groans beneath your boots. Ancient runes pulse faintly on the walls.", choices: ["Draw your sword", "Read the runes", "Sneak past", "Turn back"], risk: "mid", tag: "exploration" },
      { narration: "A hooded ranger blocks the ruined gate. Her eyes gleam with suspicion.", choices: ["State your business", "Attack first", "Offer gold", "Find another way"], risk: "mid", tag: "social" },
      { narration: "The village bell rings thrice at midnight. Shadows move between the houses.", choices: ["Investigate the bell", "Hide in an alley", "Rally the guards", "Flee the village"], risk: "high", tag: "hazard" },
      { narration: "A merchant's cart lies overturned on the road. Wolves howl in the distance.", choices: ["Search the cart", "Set a trap", "Build a fire", "Press on quickly"], risk: "mid", tag: "exploration" },
      { narration: "The dungeon door creaks open. Something breathes in the darkness below.", choices: ["Descend carefully", "Throw a torch down", "Seal the door", "Call for backup"], risk: "high", tag: "combat" },
    ],
    noir: [
      { narration: "Rain crawls down neon windows as a saxophone fades into silence. Someone left a matchbook on the bar.", choices: ["Examine the matchbook", "Ask the bartender", "Leave quietly", "Light a cigarette"], risk: "low", tag: "exploration" },
      { narration: "A black sedan idles outside the diner. The driver hasn't moved in twenty minutes.", choices: ["Confront the driver", "Note the plates", "Exit through the back", "Call your contact"], risk: "mid", tag: "hazard" },
      { narration: "Your office phone rings at 3 AM. The voice on the line whispers a name you thought was buried.", choices: ["Listen carefully", "Hang up", "Trace the call", "Grab your revolver"], risk: "high", tag: "social" },
      { narration: "The alley smells of copper and regret. A figure slumps against the brickwork, still breathing.", choices: ["Help them up", "Search their pockets", "Call an ambulance", "Walk away"], risk: "mid", tag: "hazard" },
      { narration: "A manila envelope slides under your door. Inside: photographs of places you've never been.", choices: ["Study the photos", "Destroy them", "Take them to a friend", "Set a trap at the door"], risk: "mid", tag: "exploration" },
    ],
    scifi: [
      { narration: "Warning glyphs pulse in the airlock. The hull integrity is at 40% and dropping.", choices: ["Seal the breach", "Reroute power", "Evacuate the sector", "Send a distress signal"], risk: "high", tag: "hazard" },
      { narration: "A drone swarm shadows your route through the industrial district. Their formation is too precise to be random.", choices: ["Jam their signal", "Take cover", "Shoot the lead drone", "Hack their network"], risk: "mid", tag: "combat" },
      { narration: "The reactor core hums like distant thunder. Your scanner shows an anomalous energy signature.", choices: ["Investigate further", "Report to command", "Shut it down", "Collect a sample"], risk: "mid", tag: "exploration" },
      { narration: "A cryopod opens with a hiss. The person inside hasn't aged a day in three hundred years.", choices: ["Wake them gently", "Check their identity", "Seal the pod again", "Call medical"], risk: "low", tag: "social" },
      { narration: "The AI's voice crackles through static: 'Last chance to comply.' Alarms flood the corridor.", choices: ["Comply immediately", "Override the AI", "Run for the escape pod", "Negotiate"], risk: "high", tag: "boss" },
    ]
  };

  const pool = scenes[theme] || scenes.medieval;
  const idx = ((step || 1) - 1) % pool.length;
  const scene = JSON.parse(JSON.stringify(pool[idx]));

  // Add flavor based on HP
  if (hp <= 3) {
    scene.narration += " Your wounds slow you down. Every breath is an effort.";
  }

  return scene;
}

// ═══════════════════════════════════════════════
// OpenRouter API call
// ═══════════════════════════════════════════════
async function callOpenRouter(apiKey, model, systemPrompt, userContent, signal) {
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
        { role: "user", content: userContent }
      ]
    }),
    signal
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`${resp.status}: ${t.slice(0, 200)}`);
  }
  return resp.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
