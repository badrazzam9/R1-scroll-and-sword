# Scroll & Sword

Pixel-style AI-assisted text RPG for Rabbit R1.

## What ships in this scaffold
- Frontend game loop (menu, new/resume, themes)
- Deterministic rules engine (HP, acts, death/win)
- Wheel of Fate mechanic (scroll to spin, release to resolve)
- Local save/resume
- Optional AI scene generation via API endpoint
- Cloudflare Worker template for OpenRouter

## Run frontend locally
Open `frontend/index.html` in a browser.

## Optional AI endpoint
1. Deploy `worker/` with Cloudflare Wrangler
2. Set secret: `OPENROUTER_API_KEY`
3. In browser console on frontend: `localStorage.setItem('sas_api_url','https://<your-worker>.workers.dev')`
4. Refresh

## Controls
- Click/tap choices
- Wheel screen: scroll to add spin, press Release Fate

## Next milestones
- Pixel art sprites per theme
- Sound effects/chiptune
- Inventory + items
- Better balancing
