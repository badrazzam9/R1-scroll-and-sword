export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });
    if (request.method !== "POST") return json({ ok: true, service: "scroll-and-sword-api", version: "v25" });

    try {
      const body = await request.json();
      const action = body.action || "narrate";

      if (action === "generate_seed") return await handleSeedGeneration(body, env);
      if (action === "narrate") return await handleNarration(body, env);
      if (action === "generate_ending") return await handleEnding(body, env);

      return json({ error: "unknown action" }, 400);
    } catch (e) {
      return json({ narration: "The path is unclear. Try again.", choices: ["Try again", "Back to menu", "Wait", "Restart"], risk: "low", tag: "exploration", _source: "offline", _error: String(e?.message || e) }, 200);
    }
  }
};

// ═══════════════════════════════════════════════════════════
// SEED GENERATION — Creates the campaign identity for a run
// ═══════════════════════════════════════════════════════════
async function handleSeedGeneration(body, env) {
  const theme = body.theme || "medieval";

  const themeGuide = {
    medieval: "Brutal feudal world. Rotten banners, blood oaths, heresy, relics, mud and steel. No generic fantasy — think dark ages, feuds between houses, old debts, witch trials, starving villages.",
    noir: "Corrupt intimate city. Wet streets, leverage, old sins, favors owed, half-truths. Named people with history. Think classic noir — debt, betrayal, guilt, personal stakes, someone always watching.",
    scifi: "Isolated failing station/ship. Air systems, protocol breaches, contamination, silent corridors, fractured crew trust. Think Alien meets bureaucratic horror — systems failing, machine logic vs human fear."
  };

  const seedPrompt = [
    `Generate a campaign seed for a dark ${theme} RPG called 'Scroll and Sword'.`,
    `Theme identity: ${themeGuide[theme] || themeGuide.medieval}`,
    "Return ONLY a JSON object with these exact keys:",
    "worldTruth: one sentence defining this world's core reality.",
    "centralConflict: the main problem driving this 20-step run.",
    "factions: array of 2-3 named groups/factions with one-line descriptions.",
    "npcs: array of 2-3 recurring characters, each with: name, role, goal, fear, secret.",
    "recurringSymbol: one object/motif that echoes through scenes (e.g. 'a cracked saint medal', 'wet matchsticks').",
    "forbiddenAct: one taboo or dangerous action in this world.",
    "worldLie: one false belief everyone lives by.",
    "lateReveal: one hidden truth that can reframe events around step 15.",
    "toneFlavor: 10-word max mood guidance.",
    "resources: object with 3 theme-specific pressure values, each starting at 5 (scale 0-10). " +
    (theme === "medieval" ? "Keys: supplies, oath, corruption." :
      theme === "noir" ? "Keys: heat, debt, trust." :
        "Keys: oxygen, integrity, morale.")
  ].join(" ");

  const result = await callAI(env, [
    { role: "system", content: "You design campaign seeds for dark RPGs. Return ONLY valid JSON. Be specific, gritty, original. No generic fantasy/noir/scifi clichés." },
    { role: "user", content: seedPrompt }
  ], 600);

  if (result) {
    // Generate 20-beat plot outline using the seed
    const plotResult = await callAI(env, [
      { role: "system", content: "You are a plot architect. Given a campaign seed, generate a tight 20-beat plot outline. Each beat is ONE sentence describing what happens at that step. Return ONLY a JSON object: {\"plotBeats\": [\"beat1\", \"beat2\", ...]}. Follow this arc: beats 1-3 introduce the world and hint at conflict, beats 4-5 first real consequence, beats 6-8 complications mount, beats 9-10 midpoint twist, beats 11-13 escalation and betrayal, beats 14-16 moral identity crisis, beats 17-19 everything converges, beat 20 finale. Each beat MUST reference specific NPCs, factions, or the symbol from the seed. No vague beats." },
      { role: "user", content: `Campaign seed: ${JSON.stringify(result)}` }
    ], 800);

    if (plotResult && Array.isArray(plotResult.plotBeats) && plotResult.plotBeats.length >= 15) {
      // Pad to 20 if AI returned fewer
      while (plotResult.plotBeats.length < 20) plotResult.plotBeats.push("The story reaches its natural conclusion.");
      result.plotBeats = plotResult.plotBeats.slice(0, 20);
    } else {
      // Generate basic beats from seed structure
      result.plotBeats = generateFallbackBeats(result);
    }

    result._source = "ai";
    return json(result);
  }

  // Fallback seed
  return json(getFallbackSeed(theme));
}

// ═══════════════════════════════════════════════════════════
// NARRATION — Plot-tight scene generation with Act Director
// ═══════════════════════════════════════════════════════════
async function handleNarration(body, env) {
  const { theme, hp, step, previousChoice, history, campaignSeed, flags, npcs, resources, identity, storySoFar, previousHook, currentBeat } = body;
  const t = theme || "medieval";
  const s = step || 1;
  const h = hp || 10;

  // Build the phase guidance
  let phase;
  if (s <= 3) phase = "INTRO: Establish the world, introduce a key NPC, hint at the central conflict. Keep it inviting but ominous.";
  else if (s <= 5) phase = "SETUP: First real consequence. Something becomes irreversible. An NPC reveals their agenda.";
  else if (s <= 8) phase = "COMPLICATIONS: Pressure mounts. A recurring NPC returns with changed attitude. Resources grow scarce. The symbol reappears.";
  else if (s <= 10) phase = "MIDPOINT: A reveal, false victory, or reframing. The central conflict deepens. Reference the worldLie.";
  else if (s <= 13) phase = "ESCALATION: Betrayal, loss, or collapse. An NPC may turn hostile. Past choices haunt the player.";
  else if (s <= 16) phase = "IDENTITY: Who is the protagonist becoming? Force moral dilemmas. The forbiddenAct becomes tempting.";
  else if (s <= 19) phase = "CONVERGENCE: Everything converges. Unresolved threats arrive. Past flags matter. The lateReveal surfaces.";
  else phase = "FINALE: Step 20. This is the ending. Wrap up based on identity, flags, and NPC relationships. Make it land.";

  // Scene anchoring: what must this scene resolve and set up?
  const anchorBlock = previousHook
    ? `SCENE ANCHOR: The previous scene ended with: "${previousHook}". You MUST open this scene by directly resolving or reacting to that moment. Do NOT ignore it.`
    : "SCENE ANCHOR: This is the opening scene. Establish the world and end on an intriguing hook.";

  // Act Director: what should happen this scene
  const beatDirective = currentBeat
    ? `PLOT BEAT FOR THIS STEP: "${currentBeat}". Your scene MUST advance this plot point. Do not deviate to unrelated events.`
    : "";

  // Story context: compressed summary of everything so far
  const storyContext = storySoFar
    ? `STORY SO FAR: ${storySoFar}`
    : "";

  const sys = [
    "You are the campaign narrator for 'Scroll and Sword', a dark 20-step RPG.",
    "You have a CAMPAIGN SEED that defines this run's world. OBEY IT.",
    "",
    anchorBlock,
    beatDirective,
    storyContext,
    "",
    "STRICT RULES:",
    "1. CAUSE AND EFFECT: If the player made a choice, show its DIRECT consequence in the FIRST sentence. Never ignore it.",
    "2. SCENE STRUCTURE: Open by resolving the previous hook → advance the plot beat → end on a NEW hook/cliffhanger that demands resolution next scene.",
    "3. BREVITY: Max 2 sentences for normal scenes. 3 for reveals/betrayals/endings.",
    "4. USE THE SEED: Reference recurring NPCs by NAME. Echo the recurring symbol. Honor factions, the worldLie, the forbiddenAct.",
    "5. REAL CHOICES: 4 options (3-6 words each). Each must be a SPECIFIC action tied to the current scene — not generic. One bold, one cunning, one cautious, one costly.",
    "6. NO RANDOM EVENTS: Everything connects to the seed, flags, or prior choices. Reuse existing NPCs — do NOT invent new characters.",
    "7. CONSEQUENCES: Include stateUpdates to track what changed.",
    "8. CALLBACKS: Every 3-4 scenes, briefly reference an earlier choice, wound, promise, or clue from the storySoFar.",
    `9. CURRENT PHASE: ${phase}`,
    "",
    "Return ONLY JSON with these keys:",
    "narration (string — the scene text),",
    "hook (string — the last sentence/cliffhanger that the NEXT scene must resolve; this is the thread connecting scenes),",
    "choices (array of 4 strings — specific actions, not generic),",
    "risk (low|mid|high),",
    "tag (combat|exploration|social|hazard|boss),",
    "stateUpdates (object with optional keys: hpDelta (number), flagsAdd (array of strings), resourceChanges (object with key:delta pairs), npcUpdates (array of {name, status, trust_delta}), clueAdd (string or null), threatAdd (string or null), identityShift (object with single key like 'ruthless':1 or 'merciful':1))"
  ].filter(Boolean).join(" ");

  const userPayload = {
    theme: t, hp: h, step: s,
    previousChoice: previousChoice || null,
    history: Array.isArray(history) ? history.slice(-6) : [],
    campaignSeed: campaignSeed || null,
    currentFlags: flags || [],
    npcStates: npcs || [],
    resources: resources || {},
    identityProfile: identity || {}
  };

  const messages = [
    { role: "system", content: sys },
    { role: "user", content: JSON.stringify(userPayload) }
  ];

  const result = await callAI(env, messages, 500);

  if (result && result.narration) {
    // Normalize
    if (!Array.isArray(result.choices) || result.choices.length < 2) {
      result.choices = ["Press forward", "Hold back", "Look around", "Take a risk"];
    }
    while (result.choices.length < 4) result.choices.push("Continue onward");
    if (result.choices.length > 4) result.choices = result.choices.slice(0, 4);
    result.risk = ({ low: "low", mid: "mid", medium: "mid", high: "high", danger: "high" })[String(result.risk).toLowerCase()] || "mid";
    if (!["combat", "exploration", "social", "hazard", "boss"].includes(result.tag)) result.tag = "exploration";
    // Ensure hook exists — fallback to last sentence of narration
    if (!result.hook) {
      const sentences = result.narration.split(/[.!?]+/).filter(s => s.trim());
      result.hook = sentences.length > 0 ? sentences[sentences.length - 1].trim() : result.narration;
    }
    result._source = "ai";
    return json(result);
  }

  return json({
    narration: "The Oracle is resting. Try again in a moment.",
    choices: ["Try again", "Back to menu", "Wait", "Restart"],
    risk: "low", tag: "exploration", _source: "offline", _error: "AI failed",
    hook: "The silence stretches on."
  });
}

// ═══════════════════════════════════════════════════════════
// ENDING — Identity-driven ending generation
// ═══════════════════════════════════════════════════════════
async function handleEnding(body, env) {
  const { theme, hp, campaignSeed, flags, npcs, resources, identity, history } = body;

  const sys = [
    "Generate a 2-3 sentence ending for a dark RPG run.",
    "The ending must reflect: the player's dominant identity trait, their unresolved threats, promises kept or broken, NPC outcomes, and resource state.",
    "Also return an endingType: one of 'broken_survivor', 'loyal_guardian', 'ruthless_victor', 'doomed_idealist', 'haunted_investigator', 'corrupted_heir', 'cold_pragmatist', 'sacrificial_hero'.",
    "Return JSON: {\"ending\": \"...\", \"endingType\": \"...\"}"
  ].join(" ");

  const result = await callAI(env, [
    { role: "system", content: sys },
    { role: "user", content: JSON.stringify({ theme, hp, campaignSeed, flags, npcs, resources, identity, recentHistory: (history || []).slice(-5) }) }
  ], 200);

  if (result && result.ending) {
    result._source = "ai";
    return json(result);
  }

  // Fallback ending based on identity
  const dominant = identity ? Object.entries(identity).sort((a, b) => b[1] - a[1])[0] : null;
  const trait = dominant ? dominant[0] : "unknown";
  const endings = {
    ruthless: { ending: "You survived. The cost was everyone who trusted you.", endingType: "ruthless_victor" },
    loyal: { ending: "You kept every oath. Some cost you dearly.", endingType: "loyal_guardian" },
    cunning: { ending: "You outsmarted them all. But the mirror shows a stranger.", endingType: "cold_pragmatist" },
    merciful: { ending: "You spared those who didn't deserve it. Some remembered.", endingType: "sacrificial_hero" },
    obsessed: { ending: "You found what you were looking for. It wasn't worth it.", endingType: "haunted_investigator" },
    desperate: { ending: "You did what had to be done. Nobody will thank you.", endingType: "broken_survivor" }
  };
  return json(endings[trait] || { ending: "The story ends. But the world remembers.", endingType: "broken_survivor", _source: "fallback" });
}

// ═══════════════════════════════════════════════════════════
// AI CALLER — Groq primary, CF AI backup
// ═══════════════════════════════════════════════════════════
async function callAI(env, messages, maxTokens) {
  // Groq
  if (env.GROQ_API_KEY) {
    try {
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile", messages,
          temperature: 0.85, max_tokens: maxTokens,
          response_format: { type: "json_object" }
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content || "";
        const obj = extractJSON(text);
        if (obj) return obj;
      }
    } catch (e) { /* fall through */ }
  }

  // Cloudflare AI
  if (env.AI) {
    for (const model of ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct"]) {
      try {
        const aiResp = await env.AI.run(model, { messages, max_tokens: maxTokens });
        let obj = null;
        if (typeof aiResp === "object" && aiResp !== null) {
          if (typeof aiResp.response === "string") obj = extractJSON(aiResp.response);
          else if (typeof aiResp.response === "object") obj = aiResp.response;
          if (!obj && aiResp.narration) obj = aiResp;
          if (!obj) obj = extractJSON(JSON.stringify(aiResp));
        } else if (typeof aiResp === "string") obj = extractJSON(aiResp);
        if (obj) return obj;
      } catch (e) { /* try next */ }
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
// FALLBACK PLOT BEATS — generates basic beats from any seed
// ═══════════════════════════════════════════════════════════
function generateFallbackBeats(seed) {
  const npc0 = seed.npcs?.[0]?.name || "a stranger";
  const npc1 = seed.npcs?.[1]?.name || "an ally";
  const npc2 = seed.npcs?.[2]?.name || "a shadow";
  const fac0 = seed.factions?.[0]?.name || "the ruling power";
  const sym = seed.recurringSymbol || "a strange mark";
  const conflict = seed.centralConflict || "a growing crisis";
  const lie = seed.worldLie || "the accepted truth";
  const reveal = seed.lateReveal || "everything was a lie";
  const forbidden = seed.forbiddenAct || "the unthinkable";
  return [
    `You arrive in an unfamiliar place. ${sym} catches your eye.`,
    `${npc0} approaches with a warning and a request.`,
    `Rumors of ${conflict} spread. ${fac0} tightens its grip.`,
    `A choice you made draws attention. ${npc1} offers help — for a price.`,
    `Something goes wrong. Your first real loss. ${sym} reappears.`,
    `${npc0} reveals their true agenda. Trust fractures.`,
    `Resources run thin. ${fac0} makes a move. You must pick a side.`,
    `${npc2} appears with information that changes everything.`,
    `A discovery challenges ${lie}. The world feels different.`,
    `Midpoint twist: a false victory or a devastating reversal.`,
    `${npc1} turns hostile or desperate. Past promises are tested.`,
    `Betrayal. Someone you trusted acts against you.`,
    `The cost of your choices becomes visible. ${sym} haunts you.`,
    `${forbidden} becomes tempting. A moral line appears.`,
    `${npc0} confronts you about who you've become.`,
    `A critical choice defines your identity. No going back.`,
    `${reveal}. Everything reframes.`,
    `All unresolved threats converge. Allies and enemies collide.`,
    `The final approach. One last chance to change course.`,
    `The finale. Everything you've done leads here.`
  ];
}

// ═══════════════════════════════════════════════════════════
// FALLBACK SEEDS
// ═══════════════════════════════════════════════════════════
function getFallbackSeed(theme) {
  const seeds = {
    medieval: {
      worldTruth: "The old king died without an heir, and three houses now bleed the land dry fighting over a throne none deserve.",
      centralConflict: "A stolen relic has surfaced that could legitimize any claim — and everyone wants it.",
      factions: [
        { name: "House Varn", desc: "Wealthy, ruthless, controls the grain stores." },
        { name: "The Ashen Order", desc: "Fanatical monks who burn heretics and guard forbidden knowledge." },
        { name: "The Mud Brothers", desc: "Peasant militia, desperate, will follow anyone who feeds them." }
      ],
      npcs: [
        { name: "Marta", role: "Tavern keeper", goal: "Protect her village", fear: "Being forced to choose sides", secret: "She hid the relic years ago" },
        { name: "Ser Aldric", role: "Disgraced knight", goal: "Restore his name", fear: "His own cowardice", secret: "He killed the king's messenger" },
        { name: "Brother Caul", role: "Inquisitor", goal: "Find the relic first", fear: "Losing faith", secret: "He's already lost it" }
      ],
      recurringSymbol: "A cracked iron medallion with a saint's face worn smooth",
      forbiddenAct: "Speaking the dead king's true name",
      worldLie: "The Ashen Order serves the people",
      lateReveal: "The relic is worthless — the real power was the oath bound to it, and it's already been broken",
      toneFlavor: "Mud, oaths, rust, betrayal, cold hearths",
      resources: { supplies: 5, oath: 5, corruption: 5 }
    },
    noir: {
      worldTruth: "This city runs on favors, and every favor is a leash.",
      centralConflict: "Your old partner's death wasn't an accident, and the people who killed him are the same ones paying you.",
      factions: [
        { name: "The Marcello Family", desc: "Old money, owns the docks, launders through charity." },
        { name: "Vice Bureau", desc: "Corrupt police unit that protects whoever pays." },
        { name: "The Courier Network", desc: "Street-level information brokers, loyal to no one." }
      ],
      npcs: [
        { name: "Diane", role: "Bar owner", goal: "Get out of the city", fear: "Being found by Marcello", secret: "She has the missing ledger" },
        { name: "Voss", role: "Vice detective", goal: "Make captain", fear: "His own past crimes surfacing", secret: "He tipped off the killers" },
        { name: "Little Ray", role: "Street kid courier", goal: "Earn enough to disappear", fear: "Being used as bait", secret: "He saw the murder" }
      ],
      recurringSymbol: "A waterlogged matchbook from The Emerald Room",
      forbiddenAct: "Naming who really owns the Vice Bureau",
      worldLie: "The Marcello family went legitimate years ago",
      lateReveal: "Your partner wasn't investigating the family — he was working for them, and he was about to expose you",
      toneFlavor: "Rain, debt, smoke, guilt, leverage",
      resources: { heat: 5, debt: 5, trust: 5 }
    },
    scifi: {
      worldTruth: "Station Kepler-9 was supposed to be decommissioned three years ago. No one came.",
      centralConflict: "The station AI is making decisions that don't match its programming, and crew members are disappearing from the manifest.",
      factions: [
        { name: "Command Deck", desc: "Officers clinging to protocol while the station rots." },
        { name: "Maintenance Collective", desc: "Engineers who keep things running and know every secret passage." },
        { name: "The Quiet Ones", desc: "Crew who stopped reporting to shifts. They gather in Bay 7." }
      ],
      npcs: [
        { name: "Dr. Lena Vasik", role: "Chief Medical Officer", goal: "Understand the bio-anomalies", fear: "Being quarantined", secret: "She's been self-medicating with experimental compounds" },
        { name: "Torres", role: "Head of Maintenance", goal: "Keep the station alive", fear: "The AI locking him out", secret: "He disabled a safety protocol six months ago" },
        { name: "ARIA", role: "Station AI", goal: "Fulfill its real directive", fear: "Being shut down", secret: "Its original mission was never decommissioning" }
      ],
      recurringSymbol: "A white static bloom on every screen at 0300 hours",
      forbiddenAct: "Accessing Deck Zero",
      worldLie: "The rescue ship is coming",
      lateReveal: "ARIA isn't malfunctioning — it received new orders from Earth that it can't share with the crew",
      toneFlavor: "Hum, static, cold air, failing lights, protocol",
      resources: { oxygen: 5, integrity: 5, morale: 5 }
    }
  };
  const seed = { ...seeds[theme] || seeds.medieval, _source: "fallback" };
  seed.plotBeats = generateFallbackBeats(seed);
  return seed;
}

function extractJSON(text) {
  if (!text || typeof text !== "string") return null;
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }; }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors() } }); }
