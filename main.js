const $ = (id) => document.getElementById(id);
const screens = ["menu", "theme", "scene", "wheel", "end"];

// Native R1 AI Bridge
let oracleResolver = null;
window.onPluginMessage = function (data) {
  console.log("R1 AI Message:", data);
  // data.data is the string returned by the LLM
  if (oracleResolver && data.data) {
    oracleResolver(data.data);
    oracleResolver = null;
  }
};

const state = {
  hp: 10,
  step: 0,
  theme: null,
  seed: Math.floor(Math.random() * 1e9),
  history: [],
  scene: null,
  gold: 0,
  bossesDefeated: 0,
};

let API_URL = localStorage.getItem("sas_api_url") || "https://scroll-and-sword-api.swordandscroll.workers.dev";
let forcedSeed = localStorage.getItem("sas_forced_seed") || "";

function show(screen) {
  state.currentScreen = screen;
  screens.forEach((s) => $(s).classList.remove("active"));
  $(screen).classList.add("active");
  if ($("hp")) $("hp").textContent = state.hp;
  if ($("gold")) $("gold").textContent = state.gold;

  // Hide stats on menu and meta screens
  const statsEl = document.querySelector(".stats");
  if (statsEl) {
    if (["menu", "theme", "end", "saves"].includes(screen)) {
      statsEl.style.display = "none";
    } else {
      statsEl.style.display = "flex";
    }
  }
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
    step: 0,
    theme,
    history: [],
    scene: null,
    seed: forcedSeed ? Number(forcedSeed) : Math.floor(Math.random() * 1e9),
    gold: 0,
    bossesDefeated: 0,
  });
  nextScene();
}

async function nextScene(choiceText = null) {
  state.step += 1;

  const prompt = {
    theme: state.theme,
    hp: state.hp,
    step: state.step,
    previousChoice: choiceText,
    history: state.history.slice(-6),
    isBossStep: state.step > 0 && state.step % 5 === 0,
  };

  const log = (msg) => {
    console.log(msg);
    if ($("debugLog")) $("debugLog").textContent = "Log: " + msg;
  };

  let scene = null;
  let lastErr = "";
  let sceneSource = "fallback";

  // AI-first
  if (API_URL) {
    try {
      show("scene");
      $("narration").innerHTML = '<span class="loading">The Oracle is weaving your fate...</span>';
      $("choices").innerHTML = "";

      // Try Native R1 AI First
      if (typeof PluginMessageHandler !== "undefined") {
        log("Trying Native AI...");
        const simplePrompt = `RPG. Theme: ${state.theme}. Action: ${choiceText}. Step: ${state.step}. RETURN JSON: {"narration":"...","choices":["...","...","...","..."],"risk":"low|mid|high","tag":"..."}`;

        const responseData = await new Promise((resolve) => {
          oracleResolver = resolve;
          const tid = setTimeout(() => {
            log("Native AI TIMEOUT (12s)");
            resolve(null);
          }, 12000);

          try {
            PluginMessageHandler.postMessage(JSON.stringify({
              message: simplePrompt,
              useLLM: true
            }));
          } catch (pe) {
            log("Bridge Error: " + pe.message);
            clearTimeout(tid);
            resolve(null);
          }
        });

        if (responseData) {
          try {
            log("Native Response Rx");
            const j = JSON.parse(responseData);
            if (isValidScene(j)) {
              scene = j;
              sceneSource = "r1-native";
              log("Native AI Success");
            }
          } catch (e) {
            log("Native JSON Error: " + e.message);
          }
        }
      }

      // Fallback to Cloudflare if native fails
      if (!scene) {
        log("Trying Worker Fallback...");
        const r = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(prompt),
        });
        if (r.ok) {
          const j = await r.json();
          if (isValidScene(j)) {
            scene = j;
            sceneSource = "ai-worker";
            log("Worker Success");
          }
        } else {
          log("Worker Failed: HTTP " + r.status);
          const err = await r.json().catch(() => ({}));
          lastErr = err.detail || `HTTP ${r.status}`;
        }
      }
    } catch (e) {
      log("Global AI Error: " + e.message);
      lastErr = e.message;
    }
  }

  // NO FALLBACK - strictly AI or Error
  if (!scene) {
    scene = {
      narration: `⚠️ CONNECTION ERROR: ${lastErr || "Unknown"}. The Oracle is silent.`,
      choices: ["RETRY CONNECTION", "BACK TO MENU", "CHECK STATUS", "FORCE RESET"],
      risk: "high",
      tag: "hazard",
      _source: "error"
    };
  }

  scene._source = sceneSource;
  state.scene = scene;
  state.history.push({ scene: scene.narration, choices: scene.choices, picked: null });
  renderScene();
  save();
  show("scene");
}

function isValidScene(obj) {
  return obj && typeof obj.narration === "string" && Array.isArray(obj.choices) && obj.choices.length === 4;
}

function localScene({ theme, hp, step, isBossStep }) {
  const pools = {
    medieval: ["A torchlit corridor groans beneath your boots.", "A hooded ranger blocks the ruined gate.", "The village bell rings thrice at midnight."],
    noir: ["Rain crawls down neon windows as a saxophone fades.", "A black sedan idles outside the diner.", "A letter arrives with no return address."],
    scifi: ["Warning glyphs pulse in the airlock.", "A drone swarm shadows your route.", "The reactor core hums like thunder."],
  };

  if (isBossStep) {
    return {
      narration: `⚠️ A powerful foe emerges. Your next move decides everything.`,
      choices: ["All-in assault", "Exploit weakness", "Defensive posture", "Risky deception"],
      risk: "high",
      tag: "boss",
    };
  }

  const narr = pools[theme][step % pools[theme].length] + ` You feel ${hp <= 4 ? "wounded" : "ready"}.`;
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
  if ($("aiStatus")) {
    $("aiStatus").textContent = state.scene._source === "ai" ? "AI: CONNECTED" : "AI: FALLBACK";
  }

  const box = $("choices");
  box.innerHTML = "";
  state.scene.choices.forEach((c, i) => {
    const b = document.createElement("button");
    b.textContent = `${i + 1}. ${c}`;
    b.onclick = () => {
      if (state.scene._source === "error" && i === 0) {
        state.step -= 1; // back up step to retry same prompt
        nextScene();
      } else {
        pickChoice(i);
      }
    };
    box.appendChild(b);
  });
}

function pickChoice(i) {
  const choice = state.scene.choices[i];

  // Gold economy based on choice
  const costMatch = choice.match(/(?:pay|spend|cost[s]?)[^\d]*(\d+)[^\d]*(?:gold|coin[s]?)/i) || choice.match(/(\d+)\s*gold/i);
  let choiceCost = 0;
  if (costMatch && (choice.toLowerCase().includes("pay") || choice.toLowerCase().includes("cost") || choice.toLowerCase().includes("buy") || choice.toLowerCase().includes("gold"))) {
    choiceCost = parseInt(costMatch[1], 10);
  }

  if (choiceCost > 0) {
    if (state.gold >= choiceCost) {
      state.gold -= choiceCost;
    } else {
      alert("Not enough gold for this choice!");
      return; // prevent choice
    }
  } else {
    // Earn varying random gold otherwise
    state.gold += Math.floor(seeded(9) * 5);
  }

  state.history[state.history.length - 1].picked = choice;

  // HP logic
  const risk = ((state.step + i + (state.seed % 7)) % 10) + (state.scene.risk === "high" ? 2 : 0);
  let hpLoss = 0;

  const narrLower = state.scene.narration.toLowerCase();
  if (narrLower.includes("attack") || narrLower.includes("harm") || narrLower.includes("strike") || narrLower.includes("wound") || narrLower.includes("blood")) {
    hpLoss += 1;
  }

  if (risk > 8) hpLoss += 3;
  else if (risk > 5) hpLoss += 1;

  if (hpLoss === 0 && risk < 2 && state.hp < 10) state.hp += 1; // minor heal
  else state.hp -= hpLoss;

  if (state.hp <= 0) return endGame(false, `You chose: ${choice}. Fate was cruel.`);
  if (state.step >= 20) return endGame(true, `You survived your perilous journey!`);
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
  const r = 85;
  const cw = 200; // canvas width
  const ch = 200; // canvas height
  const cx = cw / 2; // center X
  const cy = ch / 2; // center Y

  ctx.clearRect(0, 0, cw, ch);
  ctx.save();

  // Outer glowing rim
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.fillStyle = "#2c1e4a";
  ctx.shadowColor = "#6e3f94";
  ctx.shadowBlur = 15;
  ctx.fill();
  ctx.shadowBlur = 0; // reset shadow

  // Draw segments
  for (let i = 0; i < n; i++) {
    const a0 = wheel.angle + (i * 2 * Math.PI) / n;
    const a1 = wheel.angle + ((i + 1) * 2 * Math.PI) / n;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1);
    ctx.closePath();

    // Gradient for segments
    const grad = ctx.createRadialGradient(cx, cy, 20, cx, cy, r);
    if (i % 2 === 0) {
      grad.addColorStop(0, "#4a2f7a");
      grad.addColorStop(1, "#2a1554");
    } else {
      grad.addColorStop(0, "#2f4f7a");
      grad.addColorStop(1, "#182c47");
    }

    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "#1b1d34";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw choice numbers
    ctx.save();
    const midAngle = a0 + (a1 - a0) / 2;
    // position text mostly towards outer edge
    const tx = cx + Math.cos(midAngle) * (r * 0.7);
    const ty = cy + Math.sin(midAngle) * (r * 0.7);
    ctx.translate(tx, ty);
    ctx.rotate(midAngle + Math.PI / 2);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "bold 20px 'VT323', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 4;
    ctx.fillText(`${i + 1}`, 0, 0);
    ctx.restore();
  }

  // Center Hub
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  const hubGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 18);
  hubGrad.addColorStop(0, "#dce7ff");
  hubGrad.addColorStop(1, "#30427a");
  ctx.fillStyle = hubGrad;
  ctx.fill();
  ctx.strokeStyle = "#121323";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.restore();

  // Pointer/Arrow (at the top)
  ctx.save();
  ctx.translate(cx, 10);
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.lineTo(-10, -6);
  ctx.lineTo(10, -6);
  ctx.closePath();
  ctx.fillStyle = "#ffc107";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.strokeStyle = "#b38600";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function animateWheel() {
  if (!wheel.spinning) return;
  wheel.angle += wheel.velocity;
  wheel.velocity *= 0.985;
  drawWheel();
  if (Math.abs(wheel.velocity) < 0.002) {
    wheel.spinning = false;
    wheel.velocity = 0; // stop completely
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
  // Only capture wheel events for the Wheel of Fate canvas
  if ($("wheel")?.classList.contains("active")) {
    e.preventDefault();
    wheel.velocity += (e.deltaY > 0 ? 0.05 : -0.05);
    drawWheel();
  }
}, { passive: false });

// Polyfill Rabbit R1 Scroll Wheel (mapped to SDK commands)
window.addEventListener("scrollUp", (e) => {
  if (state.currentScreen === "wheel") {
    wheel.velocity -= 0.35; // Significant push
    if (!wheel.spinning) {
      wheel.spinning = true;
      animateWheel();
    }
  } else {
    window.scrollBy(0, -60);
  }
});

window.addEventListener("scrollDown", (e) => {
  if (state.currentScreen === "wheel") {
    wheel.velocity += 0.35; // Significant push
    if (!wheel.spinning) {
      wheel.spinning = true;
      animateWheel();
    }
  } else {
    window.scrollBy(0, 60);
  }
});

// Menu bindings

let saveScreenMode = "load"; // "save" or "load"

document.querySelector('[data-action="new"]')?.addEventListener("click", () => show("theme"));
document.querySelector('[data-action="load"]')?.addEventListener("click", () => {
  saveScreenMode = "load";
  renderSaves();
});

document.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener("click", () => newGame(b.dataset.theme)));

$("restartBtn")?.addEventListener("click", () => show("menu"));

// Prompt modal when returning from gameplay
function promptSaveModal() {
  if (state.step > 0 && state.hp > 0) {
    $("saveModal").style.display = "flex";
  } else {
    show("menu");
  }
}

$("backToMenuBtn")?.addEventListener("click", () => promptSaveModal());
$("backToMenuFromWheelBtn")?.addEventListener("click", () => {
  wheel.spinning = false;
  promptSaveModal();
});

// Modal Actions
$("modalSaveBtn")?.addEventListener("click", () => {
  $("saveModal").style.display = "none";
  saveScreenMode = "save";
  renderSaves();
});

$("modalDiscardBtn")?.addEventListener("click", () => {
  $("saveModal").style.display = "none";
  show("menu");
});

$("modalCancelBtn")?.addEventListener("click", () => {
  $("saveModal").style.display = "none";
});

// Generic Saves Screen
function getSlots() {
  try {
    const s = JSON.parse(localStorage.getItem("sas_slots"));
    if (Array.isArray(s) && s.length === 3) return s;
  } catch { }
  return [null, null, null];
}

function saveSlots(slotsData) {
  localStorage.setItem("sas_slots", JSON.stringify(slotsData));
}

function renderSaves() {
  $("savesTitle").textContent = saveScreenMode === "save" ? "Save Game" : "Load Game";
  const container = $("saveSlotsContainer");
  container.innerHTML = "";

  const slots = getSlots();

  slots.forEach((slot, i) => {
    const btn = document.createElement("button");
    btn.className = "slot-btn" + (slot ? "" : " empty");

    if (slot) {
      const title = document.createElement("div");
      title.className = "slot-title";
      title.textContent = `Slot ${i + 1} - ${slot.theme ? slot.theme.toUpperCase() : "Unknown"}`;

      const meta = document.createElement("div");
      meta.className = "slot-meta";
      meta.textContent = `Step ${slot.step} • HP ${slot.hp}`;

      btn.appendChild(title);
      btn.appendChild(meta);
    } else {
      btn.textContent = `Slot ${i + 1} - Empty`;
    }

    btn.onclick = () => handleSlotClick(i, slot);
    container.appendChild(btn);
  });

  $("savesModal").style.display = "flex";
}

function handleSlotClick(idx, slotInfo) {
  const slots = getSlots();
  if (saveScreenMode === "load") {
    if (!slotInfo) return alert("Slot is empty!");
    $("savesModal").style.display = "none";
    Object.assign(state, JSON.parse(JSON.stringify(slotInfo)));
    applyThemeClass();
    renderScene();
    show("scene");
  } else {
    // Save mode
    if (slotInfo && !confirm("Overwrite this save?")) return;
    slots[idx] = JSON.parse(JSON.stringify(state));
    saveSlots(slots);
    alert("Game Saved!");
    $("savesModal").style.display = "none";
    show("menu");
  }
}

$("savesBackBtn")?.addEventListener("click", () => {
  $("savesModal").style.display = "none";
  if (saveScreenMode === "save") {
    // If we were trying to save but backed out, just go to menu
    show("menu");
  }
});

function applyThemeClass() {
  document.body.classList.remove("theme-medieval", "theme-noir", "theme-scifi");
  if (state.theme) document.body.classList.add(`theme-${state.theme}`);
}

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
}

initMenuSettings();
show("menu");
