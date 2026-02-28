const $ = (id) => document.getElementById(id);
const screens = ["menu", "theme", "scene", "wheel", "end"];

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
};

let API_URL = localStorage.getItem("sas_api_url") || "https://scroll-and-sword-api.swordandscroll.workers.dev";
let forcedSeed = localStorage.getItem("sas_forced_seed") || "";

function show(screen) {
  screens.forEach((s) => $(s).classList.remove("active"));
  $(screen).classList.add("active");
  if ($("hp")) $("hp").textContent = state.hp;
  if ($("act")) $("act").textContent = state.act;
  if ($("gold")) $("gold").textContent = state.gold;
}

function save() { localStorage.setItem("sas_save", JSON.stringify(state)); }
function load() {
  const raw = localStorage.getItem("sas_save");
  if (!raw) return false;
  Object.assign(state, JSON.parse(raw));
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
  });
  nextScene();
}

async function nextScene(choiceText = null) {
  state.step += 1;
  state.act = Math.min(3, Math.ceil(state.step / 4));

  const prompt = {
    theme: state.theme,
    hp: state.hp,
    act: state.act,
    step: state.step,
    previousChoice: choiceText,
    history: state.history.slice(-6),
    isBossStep: state.step % 4 === 0,
  };

  let scene = null;

  // AI-first
  if (API_URL) {
    try {
      const r = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prompt),
      });
      if (r.ok) {
        const j = await r.json();
        if (isValidScene(j)) scene = j;
      }
    } catch {}
  }

  // fallback
  if (!scene) scene = localScene(prompt);

  state.scene = scene;
  state.history.push({ scene: scene.narration, choices: scene.choices, picked: null });
  renderScene();
  save();
  show("scene");
}

function isValidScene(obj) {
  return obj && typeof obj.narration === "string" && Array.isArray(obj.choices) && obj.choices.length === 4;
}

function localScene({ theme, hp, act, step, isBossStep }) {
  const pools = {
    medieval: ["A torchlit corridor groans beneath your boots.", "A hooded ranger blocks the ruined gate.", "The village bell rings thrice at midnight."],
    noir: ["Rain crawls down neon windows as a saxophone fades.", "A black sedan idles outside the diner.", "A letter arrives with no return address."],
    scifi: ["Warning glyphs pulse in the airlock.", "A drone swarm shadows your route.", "The reactor core hums like thunder."],
  };

  if (isBossStep) {
    return {
      narration: `⚠️ Boss chapter of Act ${act}. Your next move decides everything.`,
      choices: ["All-in assault", "Exploit weakness", "Defensive posture", "Risky deception"],
      risk: "high",
      tag: "boss",
    };
  }

  const narr = pools[theme][(step + act) % pools[theme].length] + ` You feel ${hp <= 4 ? "wounded" : "ready"}.`;
  return {
    narration: narr,
    choices: ["Investigate carefully", "Confront directly", "Retreat and regroup", "Use an improvised trick"],
    risk: "mid",
    tag: "exploration",
  };
}

function renderScene() {
  if ($("narration")) $("narration").textContent = state.scene.narration;
  if ($("sceneMeta")) {
    const risk = (state.scene.risk || "mid").toUpperCase();
    const tag = (state.scene.tag || "exploration").toUpperCase();
    $("sceneMeta").innerHTML = `<span class="badge">${state.theme.toUpperCase()}</span><span class="badge">${tag}</span><span class="badge">RISK ${risk}</span>`;
  }
  if ($("inventory")) {
    $("inventory").innerHTML = state.inventory.length ? state.inventory.map(i => `<span class="inv-item">${i}</span>`).join("") : `<span class="inv-item">No items</span>`;
  }

  const box = $("choices");
  box.innerHTML = "";
  state.scene.choices.forEach((c, i) => {
    const b = document.createElement("button");
    b.textContent = `${i + 1}. ${c}`;
    b.onclick = () => pickChoice(i);
    box.appendChild(b);
  });
}

function pickChoice(i) {
  const choice = state.scene.choices[i];
  state.history[state.history.length - 1].picked = choice;

  const risk = ((state.step + i + (state.seed % 7)) % 10) + (state.scene.risk === "high" ? 2 : 0);
  if (risk > 8) state.hp -= 3;
  else if (risk > 5) state.hp -= 1;
  else if (risk < 2 && state.hp < 10) state.hp += 1;

  state.gold += 1 + Math.floor(seeded(9) * 4);
  if (seeded(10) > 0.7 && state.inventory.length < 6) {
    const loot = ["Lucky Coin", "Medkit", "Rune Shard", "Smoke Capsule"][Math.floor(seeded(11) * 4)];
    state.inventory.push(loot);
  }

  if (state.hp <= 0) return endGame(false, `You chose: ${choice}. Fate was cruel.`);
  if (state.step >= 12) return endGame(true, `You survived the ${state.theme} saga.`);
  nextScene(choice);
}

function endGame(win, text) {
  $("endTitle").textContent = win ? "🏆 You Survived" : "☠️ You Died";
  $("endText").textContent = `${text} Gold: ${state.gold}.`;
  localStorage.removeItem("sas_save");
  show("end");
}

// Wheel
const wheel = { angle: 0, velocity: 0, spinning: false };
const ctx = $("wheelCanvas")?.getContext("2d");

function drawWheel() {
  if (!ctx) return;
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

$("wheelBtn")?.addEventListener("click", () => { drawWheel(); show("wheel"); });
$("releaseBtn")?.addEventListener("click", () => {
  if (wheel.spinning) return;
  wheel.spinning = true;
  if (wheel.velocity < 0.03) wheel.velocity = 0.12;
  animateWheel();
});
window.addEventListener("wheel", (e) => {
  if (!$("wheel")?.classList.contains("active")) return;
  wheel.velocity += Math.max(-0.02, Math.min(0.02, -e.deltaY / 1200));
  drawWheel();
});

// Menu bindings

document.querySelector('[data-action="new"]')?.addEventListener("click", () => show("theme"));
document.querySelector('[data-action="resume"]')?.addEventListener("click", () => load() ? (renderScene(), show("scene")) : show("theme"));

document.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener("click", () => newGame(b.dataset.theme)));

$("restartBtn")?.addEventListener("click", () => show("menu"));

function initMenuSettings() {
  const seedInput = $("seedInput");
  if (!seedInput) return;

  seedInput.value = forcedSeed;

  $("saveSettingsBtn")?.addEventListener("click", () => {
    // Endpoint is locked globally for all users
    API_URL = "https://scroll-and-sword-api.swordandscroll.workers.dev";
    localStorage.setItem("sas_api_url", API_URL);

    forcedSeed = seedInput.value.trim();
    if (forcedSeed) localStorage.setItem("sas_forced_seed", forcedSeed);
    else localStorage.removeItem("sas_forced_seed");

    alert("Settings saved");
  });

  $("copySaveBtn")?.addEventListener("click", async () => {
    const raw = localStorage.getItem("sas_save");
    if (!raw) return alert("No save yet");
    const code = btoa(unescape(encodeURIComponent(raw)));
    try {
      await navigator.clipboard.writeText(code);
      alert("Save code copied");
    } catch {
      alert(code);
    }
  });

  $("importSaveBtn")?.addEventListener("click", () => {
    const input = $("importSaveInput")?.value.trim();
    if (!input) return alert("Paste save code first");
    try {
      const json = decodeURIComponent(escape(atob(input)));
      JSON.parse(json);
      localStorage.setItem("sas_save", json);
      alert("Save imported. Tap Resume.");
    } catch {
      alert("Invalid save code");
    }
  });
}

initMenuSettings();
show("menu");
