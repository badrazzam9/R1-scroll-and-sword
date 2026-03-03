import { NARRATIVE_EXAMPLES } from './examples.js';

const themeLexicon = {
  medieval: {
    places: ['abbey gate', 'crypt stair', 'thornkeep market', 'watchtower bridge'],
    threats: ['grave wardens', 'oathbreakers', 'ash hounds', 'banner thieves'],
    objectives: ['secure the relic', 'cross the gatehouse', 'break the siege line', 'reach the bell chamber'],
  },
  noir: {
    places: ['back-alley diner', 'metro service tunnel', 'arcade rooftop', 'rain-lashed loading dock'],
    threats: ['syndicate tails', 'dirty inspectors', 'wiretap crews', 'paid enforcers'],
    objectives: ['recover the ledger', 'keep your witness alive', 'cut the wiretap', 'extract before sirens arrive'],
  },
  scifi: {
    places: ['relay corridor', 'bio-dome lock', 'salvage ring spine', 'frigate reactor trench'],
    threats: ['drone lancers', 'rogue synths', 'memory leeches', 'pirate boarders'],
    objectives: ['stabilize the relay', 'seal the breach', 'extract the core key', 'reach the jump cradle'],
  },
};

function pickFrom(list, seed = 0) {
  if (!Array.isArray(list) || list.length === 0) return '';
  const idx = Math.abs(seed) % list.length;
  return list[idx];
}

function tokenize(...parts) {
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function overlapScore(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const b = new Set(bTokens);
  return aTokens.reduce((acc, token) => acc + (b.has(token) ? 1 : 0), 0);
}

function getRelevantExamples(input, k = 3) {
  const queryTokens = tokenize(
    input.theme,
    input.storyContext?.objective,
    input.storyContext?.threat,
    input.storyContext?.location,
    input.previousChoice,
  );

  const scored = NARRATIVE_EXAMPLES.map((ex) => {
    const exTokens = tokenize(ex.theme, ex.input.objective, ex.input.threat, ex.input.location, ex.input.previousChoice);
    let score = overlapScore(queryTokens, exTokens);
    if (ex.theme === input.theme) score += 3;
    score += Math.max(0, 2 - Math.abs((ex.input.act || 1) - (input.act || 1)));
    return { ex, score };
  }).sort((a, b) => b.score - a.score);

  return scored.slice(0, k).map(({ ex }) => ex);
}

function fallbackScene(input) {
  const theme = themeLexicon[input.theme] || themeLexicon.scifi;
  const place = input.storyContext?.location || pickFrom(theme.places, input.step || 0);
  const threat = input.storyContext?.threat || pickFrom(theme.threats, (input.step || 0) + 1);
  const objective = input.storyContext?.objective || pickFrom(theme.objectives, (input.step || 0) + 2);

  return {
    narration: `You push into the ${place} as ${threat} tighten their angle. A wrong move here gets you trapped. Push through and ${objective} before they close the corridor behind you.`,
    choices: ['Advance with cover fire', 'Create a diversion flank', 'Fortify a choke point', 'Fall back then counter'],
    risk: input.isBossStep ? 'high' : 'mid',
    tag: input.isBossStep ? 'boss' : 'hazard',
    storyBeat: {
      objective,
      threat,
      location: place,
      continuity: `Step ${input.step}: pressure rises after your previous decision.`,
    },
  };
}

function contradictsStoryContext(parsed, input) {
  const ctx = input.storyContext || {};
  if (!ctx.objective && !ctx.threat && !ctx.location) return false;

  const narrativeText = `${parsed.narration || ''} ${parsed.storyBeat?.objective || ''} ${parsed.storyBeat?.threat || ''} ${parsed.storyBeat?.location || ''}`.toLowerCase();

  const required = [ctx.objective, ctx.threat, ctx.location].filter(Boolean).map((v) => String(v).toLowerCase());
  const hitCount = required.filter((field) => {
    const tokens = tokenize(field);
    return tokens.some((t) => narrativeText.includes(t));
  }).length;

  return required.length > 0 && hitCount === 0;
}

function looksUsableScene(parsed, input) {
  if (!parsed || typeof parsed !== 'object') return false;
  if (typeof parsed.narration !== 'string' || parsed.narration.trim().length < 70) return false;
  if (!Array.isArray(parsed.choices) || parsed.choices.length < 4) return false;
  const validChoices = parsed.choices.filter((c) => typeof c === 'string' && c.trim().length >= 3);
  if (validChoices.length < 4) return false;

  const text = parsed.narration.toLowerCase();
  const weakPhrases = ['a strange calm', 'fate', 'destiny', 'something stirs', 'danger returns', 'ominous feeling', 'ancient prophecy', 'long-forgotten'];
  if (weakPhrases.some((p) => text.includes(p))) return false;

  const placeSignals = ['gate', 'hall', 'corridor', 'bridge', 'tunnel', 'room', 'street', 'door', 'ladder', 'console'];
  const actionSignals = ['hold', 'cut', 'block', 'rush', 'hit', 'dash', 'stabilize', 'escape', 'seal', 'retreat'];
  if (!placeSignals.some((w) => text.includes(w))) return false;
  if (!actionSignals.some((w) => text.includes(w))) return false;
  if (contradictsStoryContext(parsed, input)) return false;

  return true;
}

function buildFewShotMessages(input) {
  const relevant = getRelevantExamples(input);
  return relevant.flatMap((ex) => [
    {
      role: 'user',
      content: `Theme:${ex.theme} Act:${ex.input.act} Step:${ex.input.step} HP:8 BossStep:false Previous choice:${ex.input.previousChoice} StoryContext:${JSON.stringify({ objective: ex.input.objective, threat: ex.input.threat, location: ex.input.location, continuity: 'Prior turn escalated the mission.' })} History:[]`
    },
    {
      role: 'assistant',
      content: JSON.stringify(ex.output)
    }
  ]);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') return new Response('ok');

    const input = await request.json();
    const examples = buildFewShotMessages(input);

    const sys = `You are the narrative director for Scroll & Sword.
Return STRICT JSON only with schema:
{
  "narration": string,
  "choices": [string, string, string, string],
  "risk": "low"|"mid"|"high",
  "tag": "combat"|"exploration"|"social"|"hazard"|"boss",
  "storyBeat": {
    "objective": string,
    "threat": string,
    "location": string,
    "continuity": string
  }
}
Hard requirements:
- This is a short-session game (few minutes). Keep scenes direct and punchy.
- Keep continuity with StoryContext + Previous choice + recent History.
- No random names, no epic lore, no prophecy language.
- Narration must be simple and fast: 2-3 short sentences, concrete and tactical (place + visible threat + immediate objective), 25-55 words.
- Choices must be distinct tactics, 3-8 words each.
- If BossStep=true => tag="boss" and risk="high".
- storyBeat must evolve objective/threat/location rather than reset them.
- Output JSON only, no extra keys, no markdown.`;

    const user = `Theme:${input.theme}
Act:${input.act}
Step:${input.step}
HP:${input.hp}
BossStep:${Boolean(input.isBossStep)}
Previous choice:${input.previousChoice || 'none'}
StoryContext:${JSON.stringify(input.storyContext || {})}
RefineHint:${input.refineNarration || 'none'}
History:${JSON.stringify(input.history || [])}`;

    const body = {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: sys },
        ...examples,
        { role: 'user', content: user }
      ],
      temperature: 0.45,
      response_format: { type: 'json_object' }
    };

    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await r.json();
      let parsed;
      try {
        parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
      } catch {
        parsed = {};
      }

      if (!looksUsableScene(parsed, input)) {
        console.log('scene_rejected', JSON.stringify({ step: input.step, theme: input.theme, reason: 'quality_or_continuity' }));
        parsed = fallbackScene(input);
        parsed._source = 'offline';
      } else {
        parsed._source = 'ai';
      }

      return Response.json(parsed, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    } catch (e) {
      const fb = fallbackScene(input);
      fb._error = String(e?.message || e);
      fb._source = 'offline';
      return Response.json(fb, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }
  }
};
