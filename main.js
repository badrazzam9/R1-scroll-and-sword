const $ = (id) => document.getElementById(id);
const screens = ["menu", "theme", "scene", "wheel", "end"];

const API_URL = "https://scroll-and-sword-api.swordandscroll.workers.dev";

// ═══ State ═══
const DEFAULT_STATE = {
  hp: 10, step: 0, theme: null, history: [], scene: null,
  bossesDefeated: 0, campaignSeed: null,
  flags: [], npcs: [], resources: {},
  promises: [], threats: [], clues: [],
  identity: {}, endingTags: [],
  plotBeats: [], storySoFar: "", previousHook: null
};
const state = { ...DEFAULT_STATE };

function show(screen) {
  state.currentScreen = screen;
  screens.forEach((s) => $(s).classList.remove("active"));
  $(screen).classList.add("active");
  if ($("hp")) $("hp").textContent = state.hp;
  if ($("stepBadge")) $("stepBadge").textContent = `${state.step}/20`;
  updateResources();

  const statsEl = document.querySelector(".stats");
  if (statsEl) {
    statsEl.style.display = ["menu", "theme", "end", "saves"].includes(screen) ? "none" : "flex";
  }
  const resEl = $("resources");
  if (resEl) {
    resEl.style.display = ["menu", "theme", "end", "saves"].includes(screen) ? "none" : "flex";
  }
}

function updateResources() {
  const el = $("resources");
  if (!el || !state.resources) return;
  const keys = Object.keys(state.resources);
  if (!keys.length) { el.innerHTML = ""; return; }
  const icons = {
    supplies: "🍞", oath: "⚔️", corruption: "💀",
    heat: "🔥", debt: "💰", trust: "🤝",
    oxygen: "💨", integrity: "🛡️", morale: "😐"
  };
  el.innerHTML = keys.map(k => {
    const v = state.resources[k];
    const icon = icons[k] || "•";
    const cls = v <= 2 ? "res-crit" : v <= 4 ? "res-warn" : "";
    return `<span class="res-item ${cls}">${icon} ${v}</span>`;
  }).join("");
}

// ═══ Save/Load with Migration ═══
function save() { localStorage.setItem("sas_save", JSON.stringify(state)); }
function load() {
  const raw = localStorage.getItem("sas_save");
  if (!raw) return false;
  const saved = JSON.parse(raw);
  // Migrate old saves
  Object.assign(state, {
    ...DEFAULT_STATE,
    ...saved,
    flags: saved.flags || [],
    npcs: saved.npcs || [],
    resources: saved.resources || {},
    promises: saved.promises || [],
    threats: saved.threats || [],
    clues: saved.clues || [],
    identity: saved.identity || {},
    endingTags: saved.endingTags || [],
    campaignSeed: saved.campaignSeed || null
  });
  return true;
}

// ═══ New Game ═══
async function newGame(theme) {
  Object.assign(state, { ...DEFAULT_STATE, theme });
  applyThemeClass();
  show("scene");
  $("narration").innerHTML = '<span class="loading">Forging your world...</span>';
  $("choices").innerHTML = "";
  if ($("aiStatus")) { $("aiStatus").textContent = "AI: Connecting..."; $("aiStatus").style.color = "#ffd86b"; }

  // Generate campaign seed
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate_seed", theme })
    });
    if (r.ok) {
      const seed = await r.json();
      if (seed && seed.worldTruth) {
        state.campaignSeed = seed;
        state.resources = seed.resources || getDefaultResources(theme);
        // Store plot outline for Act Director
        if (Array.isArray(seed.plotBeats)) {
          state.plotBeats = seed.plotBeats;
        }
        // Initialize NPC tracking from seed
        if (seed.npcs) {
          state.npcs = seed.npcs.map(n => ({ ...n, trust: 5, status: "active", lastSeen: 0 }));
        }
      }
    }
  } catch (e) {
    console.log("Seed generation failed, using defaults:", e);
  }

  // Fill defaults if seed failed
  if (!state.campaignSeed) {
    state.resources = getDefaultResources(theme);
  }

  nextScene();
}

function getDefaultResources(theme) {
  return theme === "medieval" ? { supplies: 5, oath: 5, corruption: 5 } :
    theme === "noir" ? { heat: 5, debt: 5, trust: 5 } :
      { oxygen: 5, integrity: 5, morale: 5 };
}

// ═══ Scene Generation ═══
async function nextScene(choiceText = null) {
  state.step += 1;
  show("scene");
  $("narration").innerHTML = '<span class="loading">The Oracle is weaving your fate...</span>';
  $("choices").innerHTML = "";
  if ($("aiStatus")) { $("aiStatus").textContent = "AI: Connecting..."; $("aiStatus").style.color = "#ffd86b"; }

  // Get the current beat from the plot outline (0-indexed, step is 1-indexed)
  const currentBeat = state.plotBeats && state.plotBeats[state.step - 1] || null;

  const prompt = {
    action: "narrate", theme: state.theme, hp: state.hp, step: state.step,
    previousChoice: choiceText,
    history: state.history.slice(-6),
    campaignSeed: state.campaignSeed,
    flags: state.flags,
    npcs: state.npcs,
    resources: state.resources,
    identity: state.identity,
    storySoFar: state.storySoFar || "",
    previousHook: state.previousHook || null,
    currentBeat: currentBeat
  };

  let scene = null;
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prompt)
    });
    if (r.ok) {
      const j = await r.json();
      if (j && j.narration && Array.isArray(j.choices) && j.choices.length >= 2) {
        scene = j;
        // Apply state updates from AI
        applyStateUpdates(j.stateUpdates);
      }
    }
  } catch (e) {
    console.log("AI error:", e);
  }

  if (!scene) {
    scene = {
      narration: "⚠️ The Oracle is silent. Try again.",
      choices: ["RETRY", "BACK TO MENU", "WAIT", "RESTART"],
      risk: "low", tag: "hazard", _source: "error"
    };
  }

  state.scene = scene;
  state.history.push({ scene: scene.narration, picked: null });

  // Update running summary (compressed story-so-far)
  const choiceSummary = choiceText ? ` Chose: ${choiceText}.` : "";
  const sceneSummary = scene.narration.length > 80 ? scene.narration.substring(0, 80) + "..." : scene.narration;
  const newEntry = `[${state.step}]${choiceSummary} ${sceneSummary}`;
  state.storySoFar = state.storySoFar
    ? (state.storySoFar + " | " + newEntry).slice(-600)
    : newEntry;

  // Track the hook for scene anchoring
  state.previousHook = scene.hook || scene.narration.split(/[.!?]+/).filter(s => s.trim()).pop() || scene.narration;

  renderScene();
  save();
}

// ═══ Apply AI State Updates ═══
function applyStateUpdates(updates) {
  if (!updates || typeof updates !== "object") return;

  // HP delta
  if (typeof updates.hpDelta === "number") {
    state.hp = Math.max(0, Math.min(10, state.hp + updates.hpDelta));
  }

  // Flags
  if (Array.isArray(updates.flagsAdd)) {
    updates.flagsAdd.forEach(f => { if (!state.flags.includes(f)) state.flags.push(f); });
  }

  // Resources
  if (updates.resourceChanges && typeof updates.resourceChanges === "object") {
    for (const [key, delta] of Object.entries(updates.resourceChanges)) {
      if (key in state.resources && typeof delta === "number") {
        state.resources[key] = Math.max(0, Math.min(10, state.resources[key] + delta));
      }
    }
  }

  // NPC updates
  if (Array.isArray(updates.npcUpdates)) {
    updates.npcUpdates.forEach(u => {
      const npc = state.npcs.find(n => n.name === u.name);
      if (npc) {
        if (u.status) npc.status = u.status;
        if (typeof u.trust_delta === "number") npc.trust = Math.max(0, Math.min(10, (npc.trust || 5) + u.trust_delta));
        npc.lastSeen = state.step;
      }
    });
  }

  // Clues
  if (updates.clueAdd && typeof updates.clueAdd === "string") {
    state.clues.push(updates.clueAdd);
  }

  // Threats
  if (updates.threatAdd && typeof updates.threatAdd === "string") {
    state.threats.push(updates.threatAdd);
  }

  // Identity shift
  if (updates.identityShift && typeof updates.identityShift === "object") {
    for (const [trait, delta] of Object.entries(updates.identityShift)) {
      state.identity[trait] = (state.identity[trait] || 0) + (typeof delta === "number" ? delta : 1);
    }
  }
}

// ═══ Render ═══
function renderScene() {
  window.scrollTo(0, 0);
  if ($("narration")) $("narration").textContent = state.scene.narration;
  if ($("sceneMeta")) {
    const tag = (state.scene.tag || "exploration").toUpperCase();
    const risk = (state.scene.risk || "mid").toUpperCase();
    $("sceneMeta").innerHTML = `<span class="badge">${tag}</span><span class="badge">RISK ${risk}</span>`;
  }
  if ($("aiStatus")) {
    const src = state.scene._source || "unknown";
    $("aiStatus").textContent = src === "ai" ? "AI: Online" : "AI: Offline";
    $("aiStatus").style.color = src === "ai" ? "#7ef07e" : "#ff6b6b";
  }
  updateResources();

  const box = $("choices");
  box.innerHTML = "";
  state.scene.choices.forEach((c, i) => {
    const b = document.createElement("button");
    b.textContent = c;
    b.onclick = () => {
      if (state.scene._source === "error" && i === 0) {
        state.step -= 1;
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
  state.history[state.history.length - 1].picked = choice;

  // Simple HP risk (AI also sends hpDelta, this is a light backup)
  const risk = state.scene.risk || "mid";
  if (risk === "high" && Math.random() < 0.4) state.hp -= 1;
  else if (risk === "mid" && Math.random() < 0.15) state.hp -= 1;
  if (state.hp < 10 && risk === "low" && Math.random() < 0.3) state.hp += 1;

  state.hp = Math.max(0, Math.min(10, state.hp));

  if (state.hp <= 0) return endGame(false);
  if (state.step >= 20) return endGame(true);
  nextScene(choice);
}

// ═══ Ending ═══
async function endGame(survived) {
  show("end");
  $("endTitle").textContent = survived ? "🏆 Journey's End" : "☠️ You Fell";
  $("endText").textContent = "The Oracle is weighing your story...";

  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "generate_ending", theme: state.theme, hp: state.hp,
        campaignSeed: state.campaignSeed, flags: state.flags,
        npcs: state.npcs, resources: state.resources,
        identity: state.identity, history: state.history
      })
    });
    if (r.ok) {
      const j = await r.json();
      if (j.ending) {
        $("endText").textContent = j.ending;
        if (j.endingType) {
          $("endTitle").textContent = survived
            ? `🏆 ${formatEndingType(j.endingType)}`
            : `☠️ ${formatEndingType(j.endingType)}`;
        }
      }
    }
  } catch (e) {
    // Fallback
    const dominant = Object.entries(state.identity).sort((a, b) => b[1] - a[1])[0];
    $("endText").textContent = survived
      ? `You survived. ${dominant ? "Your " + dominant[0] + " nature defined you." : "The world will remember."}`
      : "The world moves on without you.";
  }

  localStorage.removeItem("sas_save");
}

function formatEndingType(type) {
  return type.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// ═══ Wheel of Fate ═══
const wheel = { angle: 0, velocity: 0, spinning: false };
const ctx = $("wheelCanvas")?.getContext("2d");

function drawWheel() {
  if (!ctx) return;
  const choices = state.scene?.choices || [];
  const n = Math.max(choices.length, 1);
  const r = 85, cw = 200, ch = 200, cx = cw / 2, cy = ch / 2;
  ctx.clearRect(0, 0, cw, ch);
  ctx.save();

  ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.fillStyle = "#2c1e4a"; ctx.shadowColor = "#6e3f94"; ctx.shadowBlur = 15;
  ctx.fill(); ctx.shadowBlur = 0;

  for (let i = 0; i < n; i++) {
    const a0 = wheel.angle + (i * 2 * Math.PI) / n;
    const a1 = wheel.angle + ((i + 1) * 2 * Math.PI) / n;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
    const grad = ctx.createRadialGradient(cx, cy, 20, cx, cy, r);
    grad.addColorStop(0, i % 2 === 0 ? "#4a2f7a" : "#2f4f7a");
    grad.addColorStop(1, i % 2 === 0 ? "#2a1554" : "#182c47");
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = "#1b1d34"; ctx.lineWidth = 2; ctx.stroke();

    ctx.save();
    const mid = a0 + (a1 - a0) / 2;
    ctx.translate(cx + Math.cos(mid) * r * 0.7, cy + Math.sin(mid) * r * 0.7);
    ctx.rotate(mid + Math.PI / 2);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "bold 20px Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = "#000"; ctx.shadowBlur = 4;
    ctx.fillText(`${i + 1}`, 0, 0);
    ctx.restore();
  }

  ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  const hub = ctx.createRadialGradient(cx, cy, 2, cx, cy, 18);
  hub.addColorStop(0, "#dce7ff"); hub.addColorStop(1, "#30427a");
  ctx.fillStyle = hub; ctx.fill();
  ctx.strokeStyle = "#121323"; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();

  ctx.save(); ctx.translate(cx, 10);
  ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(-10, -6); ctx.lineTo(10, -6); ctx.closePath();
  ctx.fillStyle = "#ffc107"; ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 5;
  ctx.fill(); ctx.strokeStyle = "#b38600"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
}

function animateWheel() {
  if (!wheel.spinning) return;
  wheel.angle += wheel.velocity;
  wheel.velocity *= 0.985;
  drawWheel();
  if (Math.abs(wheel.velocity) < 0.002) {
    wheel.spinning = false; wheel.velocity = 0;
    const n = state.scene.choices.length;
    const norm = ((Math.PI * 1.5 - wheel.angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    pickChoice(Math.floor((norm / (Math.PI * 2)) * n) % n);
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
  if ($("wheel")?.classList.contains("active")) {
    e.preventDefault();
    wheel.velocity += (e.deltaY > 0 ? 0.05 : -0.05);
    drawWheel();
  }
}, { passive: false });

window.addEventListener("scrollUp", () => {
  if (state.currentScreen === "wheel") {
    wheel.velocity -= 0.35;
    if (!wheel.spinning) { wheel.spinning = true; animateWheel(); }
  } else { window.scrollBy(0, -60); }
});
window.addEventListener("scrollDown", () => {
  if (state.currentScreen === "wheel") {
    wheel.velocity += 0.35;
    if (!wheel.spinning) { wheel.spinning = true; animateWheel(); }
  } else { window.scrollBy(0, 60); }
});

// ═══ Menu ═══
let saveScreenMode = "load";

document.querySelector('[data-action="new"]')?.addEventListener("click", () => show("theme"));
document.querySelector('[data-action="load"]')?.addEventListener("click", () => { saveScreenMode = "load"; renderSaves(); });
document.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener("click", () => newGame(b.dataset.theme)));
$("restartBtn")?.addEventListener("click", () => show("menu"));

function promptSaveModal() {
  if (state.step > 0 && state.hp > 0) $("saveModal").style.display = "flex";
  else show("menu");
}
$("backToMenuBtn")?.addEventListener("click", () => promptSaveModal());
$("backToMenuFromWheelBtn")?.addEventListener("click", () => { wheel.spinning = false; promptSaveModal(); });
$("modalSaveBtn")?.addEventListener("click", () => { $("saveModal").style.display = "none"; saveScreenMode = "save"; renderSaves(); });
$("modalDiscardBtn")?.addEventListener("click", () => { $("saveModal").style.display = "none"; show("menu"); });
$("modalCancelBtn")?.addEventListener("click", () => { $("saveModal").style.display = "none"; });

// ═══ Save Slots ═══
function getSlots() {
  try { const s = JSON.parse(localStorage.getItem("sas_slots")); if (Array.isArray(s) && s.length === 3) return s; } catch { }
  return [null, null, null];
}
function saveSlots(d) { localStorage.setItem("sas_slots", JSON.stringify(d)); }

function renderSaves() {
  $("savesTitle").textContent = saveScreenMode === "save" ? "Save Game" : "Load Game";
  const container = $("saveSlotsContainer");
  container.innerHTML = "";
  getSlots().forEach((slot, i) => {
    const btn = document.createElement("button");
    btn.className = "slot-btn" + (slot ? "" : " empty");
    if (slot) {
      const title = document.createElement("div");
      title.className = "slot-title";
      title.textContent = `Slot ${i + 1} - ${(slot.theme || "?").toUpperCase()}`;
      const meta = document.createElement("div");
      meta.className = "slot-meta";
      meta.textContent = `Step ${slot.step} • HP ${slot.hp}`;
      btn.appendChild(title); btn.appendChild(meta);
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
    // Migrate loaded save
    Object.assign(state, { ...DEFAULT_STATE, ...JSON.parse(JSON.stringify(slotInfo)) });
    state.flags = state.flags || []; state.npcs = state.npcs || [];
    state.resources = state.resources || {}; state.identity = state.identity || {};
    state.clues = state.clues || []; state.threats = state.threats || [];
    state.promises = state.promises || []; state.endingTags = state.endingTags || [];
    applyThemeClass(); renderScene(); show("scene");
  } else {
    if (slotInfo && !confirm("Overwrite this save?")) return;
    slots[idx] = JSON.parse(JSON.stringify(state));
    saveSlots(slots); alert("Game Saved!");
    $("savesModal").style.display = "none"; show("menu");
  }
}

$("savesBackBtn")?.addEventListener("click", () => {
  $("savesModal").style.display = "none";
  if (saveScreenMode === "save") show("menu");
});

function applyThemeClass() {
  document.body.classList.remove("theme-medieval", "theme-noir", "theme-scifi");
  if (state.theme) document.body.classList.add(`theme-${state.theme}`);
}

show("menu");
