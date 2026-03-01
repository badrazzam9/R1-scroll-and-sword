export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }
    if (request.method !== "POST") {
      return json({ ok: true, service: "scroll-and-sword-api", version: "v21" }, 200);
    }

    try {
      const body = await request.json();
      const { theme, hp, step, previousChoice, history } = body || {};

      const finalTheme = theme || "medieval";
      const finalStep = step || 1;
      const finalHp = hp || 10;

      const sys = [
        "You narrate 'Scroll and Sword', a dark 20-step RPG.",
        "CRITICAL RULES:",
        "1. CAUSE AND EFFECT: The player just made a choice. Your narration must show the DIRECT result. If they said 'kick the door', describe the door breaking. Never start a scene unrelated to their choice.",
        "2. KEEP IT SHORT: Max 2 sentences. Be direct. 'You kick the door in. A man jumps up from the table, reaching for a knife.' — that's the style.",
        "3. REAL CHOICES: 4 options a real person would think of in that situation. One risky, one safe, one clever, one desperate. Each 3-6 words.",
        "4. NO RANDOM EVENTS: Everything must connect to the story so far. No 'suddenly a dragon appears' unless dragons were already established.",
        "5. PACING: Steps 1-5 = introduction. Steps 6-10 = complications. Steps 11-15 = things get serious. Steps 16-20 = climax and resolution.",
        "6. LOW HP (1-3): Character is hurt. Show it without being dramatic — shaking hands, blurred vision, limping.",
        "Return ONLY raw JSON: {\"narration\":\"...\",\"choices\":[\"...\",\"...\",\"...\",\"...\"],\"risk\":\"low|mid|high\",\"tag\":\"combat|exploration|social|hazard|boss\"}"
      ].join(" ");

      const messages = [
        { role: "system", content: sys },
        {
          role: "user", content: JSON.stringify({
            theme: finalTheme, hp: finalHp, step: finalStep,
            previousChoice: previousChoice || null,
            history: Array.isArray(history) ? history.slice(-3) : []
          })
        }
      ];

      let parsed = null;
      let lastErr = null;

      // ═════ PRIMARY: Groq (Llama 3.3 70B — fast & smart) ═════
      if (env.GROQ_API_KEY) {
        try {
          const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.GROQ_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              messages,
              temperature: 0.9,
              max_tokens: 300,
              response_format: { type: "json_object" }
            })
          });

          if (resp.ok) {
            const data = await resp.json();
            const text = data?.choices?.[0]?.message?.content || "";
            const obj = extractJSON(text);
            if (obj && isValid(obj)) {
              parsed = obj;
            } else {
              lastErr = "Groq: invalid response";
            }
          } else {
            const errText = await resp.text();
            lastErr = `Groq ${resp.status}: ${errText.slice(0, 100)}`;
          }
        } catch (e) {
          lastErr = `Groq: ${e.message}`;
        }
      }

      // ═════ BACKUP: Cloudflare Workers AI (70B → 8B) ═════
      if (!parsed && env.AI) {
        const cfModels = [
          "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          "@cf/meta/llama-3.1-8b-instruct"
        ];

        for (const cfModel of cfModels) {
          if (parsed) break;
          try {
            const aiResp = await env.AI.run(cfModel, {
              messages,
              max_tokens: 300
            });

            let obj = null;
            if (typeof aiResp === "object" && aiResp !== null) {
              if (aiResp.response !== undefined) {
                const inner = aiResp.response;
                if (typeof inner === "string") obj = extractJSON(inner);
                else if (typeof inner === "object" && inner !== null) obj = inner;
              }
              if (!obj && aiResp.narration) obj = aiResp;
              if (!obj) obj = extractJSON(JSON.stringify(aiResp));
            } else if (typeof aiResp === "string") {
              obj = extractJSON(aiResp);
            }

            if (obj && isValid(obj)) {
              parsed = obj;
            } else {
              lastErr = `CF ${cfModel}: invalid`;
            }
          } catch (e) {
            lastErr = `CF ${cfModel}: ${e.message}`;
          }
        }
      }

      // ═════ RESPONSE ═════
      if (parsed) {
        parsed._source = "ai";
        return json(parsed, 200);
      }

      // All AI failed
      return json({
        narration: "The Oracle is resting. Try again in a moment.",
        choices: ["Try again", "Back to menu", "Change theme", "Wait"],
        risk: "low", tag: "exploration",
        _source: "offline",
        _error: lastErr || "unknown"
      }, 200);

    } catch (e) {
      return json({
        narration: "Something went wrong. The path is unclear.",
        choices: ["Try again", "Back to menu", "Restart", "Wait"],
        risk: "low", tag: "exploration",
        _source: "offline", _error: String(e?.message || e)
      }, 200);
    }
  }
};

function extractJSON(text) {
  if (!text || typeof text !== "string") return null;
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function isValid(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.narration !== "string" || !obj.narration.trim()) return false;
  if (!Array.isArray(obj.choices) || obj.choices.length < 2 || obj.choices.length > 6) return false;
  while (obj.choices.length < 4) obj.choices.push("Continue onward");
  if (obj.choices.length > 4) obj.choices = obj.choices.slice(0, 4);
  const riskMap = { low: "low", medium: "mid", med: "mid", mid: "mid", high: "high", danger: "high", extreme: "high" };
  obj.risk = riskMap[(obj.risk || "").toLowerCase()] || "mid";
  const validTags = ["combat", "exploration", "social", "hazard", "boss"];
  if (!validTags.includes(obj.tag)) obj.tag = "exploration";
  return true;
}

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }; }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors() } }); }
