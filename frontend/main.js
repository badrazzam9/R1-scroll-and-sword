const $ = (id) => document.getElementById(id);
const screens = ["menu", "theme", "scene", "wheel", "end"];
const TOTAL_STEPS = 8;
const ACT_LENGTH = 3;
const TOTAL_BOSS_STEPS = Math.floor(TOTAL_STEPS / ACT_LENGTH);

const state = {
  hp: 10,
  act: 1,
  step: 0,
  theme: null,
  seed: Math.floor(Math.random() * 1e9),
  history: [],
  scene: null,
  gold: 0,
  inventory: [],
  bossesDefeated: 0,
  storyContext: null,
};

let API_URL = localStorage.getItem("sas_api_url") || "";
let forcedSeed = localStorage.getItem("sas_forced_seed") || "";

const themeTables = {
  medieval: {
    tones: ["ash-swept", "ironbound", "oathscarred", "moonlit"],
    locales: ["ruined abbey", "wolf road", "thornkeep market", "crypt of bells"],
    foes: ["bandit lord", "grave warden", "witch knight", "hollow beast"],
    hooks: ["a relic hums in your satchel", "a broken banner marks your path", "a debt is called in blood"],
    bosses: ["Duke of Cinders", "Bell-Knight of the Crypt", "Thornkeep Usurper"],
  },
  noir: {
    tones: ["rain-soaked", "smoky", "neon-bitten", "whisper-thin"],
    locales: ["back-alley diner", "flickering arcade", "old metro platform", "rooftop jazz bar"],
    foes: ["fixer", "crooked inspector", "phantom courier", "wiretap ghost"],
    hooks: ["an envelope arrives unsigned", "your alibi just vanished", "the city remembers your name"],
    bosses: ["The Night Commissioner", "Neon Syndicate King", "Phantom Judge"],
  },
  scifi: {
    tones: ["ion-lit", "void-cold", "chrome-silent", "signal-fractured"],
    locales: ["orbital salvage ring", "bio-dome corridor", "quantum relay hub", "derelict war frigate"],
    foes: ["rogue synth", "pirate captain", "memory leech", "drone swarm"],
    hooks: ["your suit flags unknown life", "a distress ping mirrors your voice", "reactor time is collapsing"],
    bosses: ["Admiral Null", "The Coremind", "Abyssal Dreadnaught"],
  },
};

const lootPool = ["Iron Charm", "Medkit", "Lucky Coin", "Nano Patch", "Smoke Capsule", "Rune Shard"];

function initialStoryContext(theme) {
  return {
    objective: `Survive this short run in the ${theme} realm`,
    threat: "an unknown force closing in",
    location: "the frontier",
    continuity: "You just began your run.",
  };
}

function show(screen) {
  screens.forEach((s) => $(s).classList.remove("active"));
  $(screen).classList.add("active");
  $("hp").textContent = state.hp;
  $("act").textContent = state.act;
  $("gold").textContent = state.gold;
}

function applyThemeClass() {
  document.body.classList.remove("theme-medieval", "theme-noir", "theme-scifi");
  if (state.theme) document.body.classList.add(`theme-${state.theme}`);
}

function save() { localStorage.setItem("sas_save", JSON.stringify(state)); }
function load() {
  const raw = localStorage.getItem("sas_save");
  if (!raw) return false;
  Object.assign(state, JSON.parse(raw));
  applyThemeClass();
  return true;
}

function seeded(n = 1) {
  const x = Math.sin((state.seed + state.step * 7919 + n * 104729) * 0.000001) * 10000;
  return x - Math.floor(x);
}

function newGame(theme) {
  Object.assign(state, {
    hp: 10,
    act: 1,
    step: 0,
    theme,
    history: [],
    scene: null,
    seed: forcedSeed ? Number(forcedSeed) : Math.floor(Math.random() * 1e9),
    gold: 0,
    inventory: [],
    bossesDefeated: 0,
    storyContext: initialStoryContext(theme),
  });
  applyThemeClass();
  nextScene();
}

async function nextScene(choiceText = null) {
  state.step += 1;
  state.act = Math.min(3, Math.ceil(state.step / ACT_LENGTH));

  // Boss chapter scene every ACT_LENGTH steps
  const isBossStep = state.step % ACT_LENGTH === 0;

  const prompt = {
    theme: state.theme,
    hp: state.hp,
    act: state.act,
    step: state.step,
    previousChoice: choiceText,
    history: state.history.slice(-6),
    isBossStep,
    storyContext: state.storyContext,
  };

  const fallbackScene = localScene(prompt);

  let scene;
  try {
    scene = API_URL ? await fetchScene(prompt) : fallbackScene;
  } catch {
    scene = fallbackScene;
  }

  scene = normalizeScene(prompt, scene, fallbackScene);

  if (API_URL && isNarrationVague(scene.narration)) {
    try {
      const retryPrompt = {
        ...prompt,
        refineNarration: "Previous narration was too vague. Use concrete location, visible threat, and immediate objective.",
      };
      const retried = await fetchScene(retryPrompt);
      const refined = normalizeScene(prompt, retried, fallbackScene);
      scene = isNarrationVague(refined.narration) ? fallbackScene : refined;
    } catch {
      scene = fallbackScene;
    }
  }

  state.storyContext = nextStoryContext(state.storyContext, scene, state.theme);
  state.scene = scene;
  state.history.push({ narration: scene.narration, choices: scene.choices, risk: scene.risk, tag: scene.tag, picked: null });
  renderScene();
  save();
  show("scene");
}

function isNarrationVague(narration = "") {
  const lower = narration.toLowerCase();
  const bannedPhrases = [
    "a strange calm",
    "fate",
    "destiny",
    "something stirs",
    "danger returns",
    "an ominous feeling",
  ];
  if (narration.length < 90) return true;
  if (bannedPhrases.some((phrase) => lower.includes(phrase))) return true;

  const concreteSignals = ["bridge", "hall", "gate", "road", "vault", "platform", "alley", "market", "corridor", "ship"];
  const actionSignals = ["block", "track", "cut", "breach", "hold", "chase", "ambush", "defend", "secure", "extract"];

  return !concreteSignals.some((w) => lower.includes(w)) || !actionSignals.some((w) => lower.includes(w));
}

function cleanStoryField(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nextStoryContext(current, scene, theme) {
  const base = current && typeof current === "object" ? current : initialStoryContext(theme || "unknown");
  const beat = scene.storyBeat && typeof scene.storyBeat === "object" ? scene.storyBeat : {};

  return {
    objective: cleanStoryField(beat.objective, base.objective),
    threat: cleanStoryField(beat.threat, base.threat),
    location: cleanStoryField(beat.location, base.location),
    continuity: cleanStoryField(beat.continuity, `Step ${state.step}: ${scene.narration.slice(0, 120)}`),
  };
}

function normalizeScene(prompt, scene, fallbackScene) {
  if (!scene || typeof scene !== "object") return fallbackScene;

  const cleanNarration = typeof scene.narration === "string" ? scene.narration.trim() : "";
  const cleanChoices = Array.isArray(scene.choices)
    ? scene.choices
        .filter((c) => typeof c === "string")
        .map((c) => c.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];

  if (!cleanNarration || cleanChoices.length < 4) return fallbackScene;

  const validRisks = new Set(["low", "mid", "high"]);
  const validTags = new Set(["combat", "exploration", "social", "hazard", "boss"]);

  const risk = validRisks.has(scene.risk) ? scene.risk : fallbackScene.risk;
  const tag = validTags.has(scene.tag) ? scene.tag : fallbackScene.tag;

  const storyBeat = scene.storyBeat && typeof scene.storyBeat === "object"
    ? {
        objective: cleanStoryField(scene.storyBeat.objective, prompt.storyContext?.objective || fallbackScene.storyBeat?.objective || "Survive the current chapter"),
        threat: cleanStoryField(scene.storyBeat.threat, prompt.storyContext?.threat || fallbackScene.storyBeat?.threat || "a lurking enemy"),
        location: cleanStoryField(scene.storyBeat.location, prompt.storyContext?.location || fallbackScene.storyBeat?.location || "unknown ground"),
        continuity: cleanStoryField(scene.storyBeat.continuity, prompt.storyContext?.continuity || "Stay on mission"),
      }
    : fallbackScene.storyBeat;

  if (prompt.isBossStep) {
    return { ...scene, narration: cleanNarration, choices: cleanChoices, risk: "high", tag: "boss", storyBeat };
  }

  return { ...scene, narration: cleanNarration, choices: cleanChoices, risk, tag, storyBeat };
}

async function fetchScene(prompt) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prompt),
  });
  if (!r.ok) throw new Error("AI failed");
  return r.json();
}

function localScene({ theme, hp, act, step, isBossStep }) {
  const t = themeTables[theme];

  if (isBossStep) {
    const boss = t.bosses[Math.min(act - 1, t.bosses.length - 1)];
    return {
      narration: `⚠️ BOSS CHAPTER: ${boss} stands before you. This is a decisive confrontation for Act ${act}.`,
      choices: [
        "All-in assault",
        "Exploit weakness",
        "Defensive strategy",
        "Risky deception",
      ],
      risk: "high",
      tag: "boss",
      storyBeat: {
        objective: `Break ${boss} in this clash`,
        threat: boss,
        location: `Act ${act} stronghold`,
        continuity: `Boss chapter in act ${act}`,
      },
    };
  }

  const tone = t.tones[Math.floor(seeded(1) * t.tones.length)];
  const locale = t.locales[Math.floor(seeded(2) * t.locales.length)];
  const foe = t.foes[Math.floor(seeded(3) * t.foes.length)];
  const hook = t.hooks[Math.floor(seeded(4) * t.hooks.length)];

  const tags = ["combat", "exploration", "social", "hazard"];
  const tag = tags[Math.floor(seeded(5) * tags.length)];

  const riskRoll = seeded(6) + act * 0.12 + (hp <= 4 ? 0.2 : 0);
  const risk = riskRoll < 0.45 ? "low" : riskRoll < 0.95 ? "mid" : "high";

  const narration = `The ${tone} air of the ${locale} closes in. You spot signs of a ${foe}; ${hook}.`;

  const choiceSets = {
    combat: ["Draw steel and strike first", "Set a trap and lure them in", "Feign weakness, then counter", "Break line of sight and reposition"],
    exploration: ["Search for hidden paths", "Track recent footprints", "Inspect the strange markings", "Climb for higher vantage"],
    social: ["Offer a risky bargain", "Bluff with forged confidence", "Appeal to old honour", "Listen before acting"],
    hazard: ["Push through quickly", "Stabilise the environment first", "Use gear to bypass danger", "Retreat and wait for a window"],
  };

  return {
    narration,
    choices: choiceSets[tag],
    risk,
    tag,
    storyBeat: {
      objective: `Survive act ${act} and secure an advantage`,
      threat: foe,
      location: locale,
      continuity: hook,
    },
  };

}

function renderScene() {
  $("narration").textContent = state.scene.narration;
  const risk = state.scene.risk || "mid";
  const tag = state.scene.tag || "exploration";
  $("sceneMeta").innerHTML = `
    <span class="badge">${state.theme.toUpperCase()}</span>
    <span class="badge">${tag.toUpperCase()}</span>
    <span class="badge risk-${risk}">RISK: ${risk.toUpperCase()}</span>
  `;

  $("inventory").innerHTML = state.inventory.length
    ? state.inventory.map((i) => `<span class="inv-item">${i}</span>`).join("")
    : `<span class="inv-item">No items</span>`;

  const box = $("choices");
  box.innerHTML = "";
  state.scene.choices.forEach((c, i) => {
    const b = document.createElement("button");
    b.textContent = `${i + 1}. ${c}`;
    b.onclick = () => pickChoice(i);
    box.appendChild(b);
  });
}

function rollLoot() {
  if (seeded(30) > 0.62 && state.inventory.length < 6) {
    const item = lootPool[Math.floor(seeded(31) * lootPool.length)];
    state.inventory.push(item);
  }
  state.gold += Math.floor(seeded(32) * 7) + 1;
}

function pickChoice(i) {
  const choice = state.scene.choices[i];
  state.history[state.history.length - 1].picked = choice;

  const isBoss = state.scene.tag === "boss";

  const base = seeded(20 + i) + state.act * 0.1;
  const riskMod = state.scene.risk === "high" ? 0.25 : state.scene.risk === "low" ? -0.15 : 0;
  let roll = base + riskMod;

  // pacing balance across acts
  if (!isBoss && state.act === 1) roll -= 0.06;
  if (!isBoss && state.act === 3) roll += 0.05;
  if (isBoss && state.bossesDefeated >= 1) roll -= 0.06;

  // inventory buffs
  if (state.inventory.includes("Lucky Coin")) roll -= 0.08;
  if (state.inventory.includes("Medkit") && state.hp <= 4) {
    state.hp = Math.min(10, state.hp + 2);
    state.inventory = state.inventory.filter((x) => x !== "Medkit");
  }

  if (isBoss) {
    roll += 0.15;
    if (roll > 0.98) state.hp -= 4;
    else if (roll > 0.7) state.hp -= 2;
    else {
      state.bossesDefeated += 1;
      state.gold += 20;
    }
  } else {
    if (roll > 1.0) state.hp -= 3;
    else if (roll > 0.74) state.hp -= 1;
    else if (roll < 0.08 && state.hp < 10) state.hp += 1;
    rollLoot();
  }

  if (navigator.vibrate) navigator.vibrate(state.hp <= 0 ? [120, 60, 120] : [40]);

  if (state.hp <= 0) return endGame(false, `You chose: ${choice}. Fate demanded payment.`);
  if (state.step >= TOTAL_STEPS) {
    const bonus = state.bossesDefeated >= TOTAL_BOSS_STEPS ? "Flawless run bonus unlocked." : "You scraped through by grit.";
    return endGame(true, `You survived a fast ${TOTAL_STEPS}-scene run in the ${state.theme} realm. ${bonus}`);
  }
  nextScene(choice);
}

function endGame(win, text) {
  $("endTitle").textContent = win ? "🏆 You Survived" : "☠️ You Died";
  $("endText").textContent = `${text}  Gold: ${state.gold} • Bosses: ${state.bossesDefeated}/${TOTAL_BOSS_STEPS}`;
  localStorage.removeItem("sas_save");
  show("end");
}

// Wheel of Fate
const wheel = { angle: 0, velocity: 0, spinning: false };
const ctx = $("wheelCanvas").getContext("2d");

function drawWheel() {
  const choices = state.scene?.choices || [];
  const n = Math.max(choices.length, 1);
  const r = 120;
  ctx.clearRect(0, 0, 260, 260);
  for (let i = 0; i < n; i++) {
    const a0 = wheel.angle + (i * 2 * Math.PI) / n;
    const a1 = wheel.angle + ((i + 1) * 2 * Math.PI) / n;
    ctx.beginPath();
    ctx.moveTo(130, 130);
    ctx.arc(130, 130, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? "#4a2f7a" : "#2f4f7a";
    ctx.fill();
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(126, 4, 8, 20);
}

function animateWheel() {
  if (!wheel.spinning) return;
  wheel.angle += wheel.velocity;
  wheel.velocity *= 0.985;
  drawWheel();
  if (wheel.velocity < 0.002) {
    wheel.spinning = false;
    const n = state.scene.choices.length;
    const norm = ((Math.PI * 1.5 - wheel.angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const idx = Math.floor((norm / (Math.PI * 2)) * n) % n;
    pickChoice(idx);
    return;
  }
  requestAnimationFrame(animateWheel);
}

$("wheelBtn").onclick = () => { drawWheel(); show("wheel"); };
$("releaseBtn").onclick = () => {
  if (wheel.spinning) return;
  wheel.spinning = true;
  if (wheel.velocity < 0.03) wheel.velocity = 0.12;
  animateWheel();
};
window.addEventListener("wheel", (e) => {
  if (!$("wheel").classList.contains("active")) return;
  wheel.velocity += Math.max(-0.02, Math.min(0.02, -e.deltaY / 1200));
  drawWheel();
});

// Menu/theme bindings

document.querySelector('[data-action="new"]').onclick = () => show("theme");
document.querySelector('[data-action="resume"]').onclick = () => (load() ? (renderScene(), show("scene")) : show("theme"));

document.querySelectorAll('[data-theme]').forEach((b) => (b.onclick = () => newGame(b.dataset.theme)));

$("restartBtn").onclick = () => show("menu");

// Settings + save tools
function initMenuSettings() {
  const aiToggle = $("aiToggle");
  const apiUrlInput = $("apiUrlInput");
  const seedInput = $("seedInput");

  aiToggle.checked = Boolean(API_URL);
  apiUrlInput.value = API_URL;
  seedInput.value = forcedSeed;

  $("saveSettingsBtn").onclick = () => {
    API_URL = aiToggle.checked ? apiUrlInput.value.trim() : "";
    forcedSeed = seedInput.value.trim();

    if (API_URL) localStorage.setItem("sas_api_url", API_URL);
    else localStorage.removeItem("sas_api_url");

    if (forcedSeed) localStorage.setItem("sas_forced_seed", forcedSeed);
    else localStorage.removeItem("sas_forced_seed");

    alert("Settings saved");
  };

  $("copySaveBtn").onclick = async () => {
    const raw = localStorage.getItem("sas_save");
    if (!raw) return alert("No save yet");
    const code = btoa(unescape(encodeURIComponent(raw)));
    try {
      await navigator.clipboard.writeText(code);
      alert("Save code copied");
    } catch {
      alert(code);
    }
  };

  $("importSaveBtn").onclick = () => {
    const input = $("importSaveInput").value.trim();
    if (!input) return alert("Paste save code first");
    try {
      const json = decodeURIComponent(escape(atob(input)));
      JSON.parse(json); // validate
      localStorage.setItem("sas_save", json);
      alert("Save imported. Tap Resume.");
    } catch {
      alert("Invalid save code");
    }
  };
}

initMenuSettings();
show("menu");
