export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('ok');
    const input = await request.json();

    const sys = `You generate concise RPG scene JSON only. Return strictly: {"narration":string,"choices":[string,string,string,string]}. Keep choices grounded in current scene.`;
    const user = `Theme:${input.theme} Act:${input.act} Step:${input.step} HP:${input.hp} Previous choice:${input.previousChoice || 'none'} History:${JSON.stringify(input.history || [])}`;

    const body = {
      model: env.MODEL || 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ],
      temperature: 0.9,
      response_format: { type: 'json_object' }
    };

    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://badrazzam9.github.io',
        'X-Title': 'Scroll and Sword'
      },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    let parsed;
    try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}'); }
    catch { parsed = {}; }

    if (!parsed.narration || !Array.isArray(parsed.choices) || parsed.choices.length < 4) {
      parsed = {
        narration: 'A strange calm settles before danger returns.',
        choices: ['Scout ahead', 'Charge forward', 'Hide and observe', 'Negotiate']
      };
    }

    return Response.json(parsed, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      }
    });
  }
};