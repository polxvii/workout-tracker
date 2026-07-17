// ============================================================================
// workout-nutrition-proxy — Cloudflare Worker
// ============================================================================
// This is a BACKUP of the Worker code deployed at:
//   https://workout-nutrition-proxy.pv-proj.workers.dev
//
// Cloudflare Workers only store code in the dashboard, not in git. Keep this
// file in sync with the deployed version. If the Worker ever gets wiped or
// migrated, paste this whole file into the Cloudflare Worker editor.
//
// Deploy steps:
//   1. dash.cloudflare.com → Workers & Pages → create "Hello World" Worker
//   2. Name: workout-nutrition-proxy (or whatever — update ALLOW_ORIGIN if you
//      change the app's URL)
//   3. Edit code → paste this entire file → Save and deploy
//   4. Settings → Variables and Secrets → add SECRET (not variable):
//        GROQ_API_KEY = gsk_...   (from console.groq.com/keys)
//   5. Deploy
//
// Verify with:
//   curl "https://<worker-url>/search?q=egg"
//   → should return { "foods": [...] } in ~1-2s
//
// Endpoints:
//   GET  /search?q=<food>   → hybrid OFF + Groq AI food search
//   POST /                  → photo analysis (currently returns 503; not wired)
// ============================================================================

const ALLOW_ORIGIN = 'https://workout-tracker-d3b.pages.dev';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';

// Deterministic per-100g macro overrides for known Thai dishes.
// Applied AFTER Llama responds so hallucinated macros get corrected to
// realistic values. If a food's `name` OR the raw query matches a regex,
// the AI's per_100g is replaced with these anchor values.
const ANCHORS = [
  { match: /(ข้าวกระเพรา|ข้าวกะเพรา|pad krapao with rice|krapao with rice|rice.*basil|basil.*rice)/i,
    per_100g: { kcal: 165, protein: 9, carbs: 22, fat: 5 } },
  { match: /(กระเพรา|กะเพรา|pad krapao|krapao|stir.?fried basil)/i,
    per_100g: { kcal: 195, protein: 17, carbs: 4, fat: 12 } },
  { match: /(ข้าวผัด|fried rice)/i,
    per_100g: { kcal: 170, protein: 6, carbs: 26, fat: 5 } },
  { match: /(ผัดไทย|pad thai)/i,
    per_100g: { kcal: 195, protein: 8, carbs: 28, fat: 6 } },
  { match: /(ข้าวมันไก่|khao man gai|hainanese chicken rice)/i,
    per_100g: { kcal: 200, protein: 12, carbs: 25, fat: 7 } },
  { match: /(ส้มตำ|som ?tam|papaya salad)/i,
    per_100g: { kcal: 50, protein: 1.5, carbs: 11, fat: 0.5 } },
  { match: /(ต้มยำ|tom ?yum)/i,
    per_100g: { kcal: 55, protein: 5, carbs: 5, fat: 2 } },
  { match: /(ข้าวซอย|khao ?soi)/i,
    per_100g: { kcal: 180, protein: 9, carbs: 18, fat: 9 } },
  { match: /(ก๋วยเตี๋ยว|noodle soup|kuay teow)/i,
    per_100g: { kcal: 80, protein: 4, carbs: 12, fat: 2 } },
  { match: /(ข้าวเหนียว|sticky rice)/i,
    per_100g: { kcal: 145, protein: 3, carbs: 32, fat: 0.3 } },
  { match: /^(egg|eggs|ไข่)$/i,
    per_100g: { kcal: 155, protein: 12.6, carbs: 0.7, fat: 10.6 } },
];
function findAnchor(text) {
  if (!text) return null;
  for (const a of ANCHORS) if (a.match.test(text)) return a.per_100g;
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(true) });
    try {
      if (url.pathname === '/search') return await handleSearch(url, env);
      return await handlePhoto(request, env);
    } catch (e) {
      return jsonError(500, e.message || String(e));
    }
  },
};

// ---------- Hybrid search: OFF (real DB) + Groq (AI estimate), merged ----------
async function handleSearch(url, env) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q || q.length < 2) return jsonError(400, 'Query too short');

  const [offRes, groqRes] = await Promise.allSettled([
    fetchOff(q),
    fetchGroq(q, env),
  ]);

  const offFoods  = offRes.status  === 'fulfilled' ? offRes.value  : [];
  const groqFoods = groqRes.status === 'fulfilled' ? groqRes.value : [];

  // Apply anchor overrides to Groq results (deterministic for known dishes)
  const queryAnchor = findAnchor(q);
  for (const f of groqFoods) {
    const a = findAnchor(f.name) || queryAnchor;
    if (a) f.per_100g = a;
  }

  // Merge: OFF (real products) first, then Groq (AI estimates). Limit total 10.
  const foods = [...offFoods, ...groqFoods].slice(0, 10);
  return new Response(JSON.stringify({ foods }), { headers: corsHeaders(false, 'application/json') });
}

async function fetchOff(q) {
  const fields = 'product_name,product_name_en,product_name_th,brands,quantity,nutriments,image_thumb_url';
  const url = 'https://search.openfoodfacts.org/search?q=' + encodeURIComponent(q)
            + '&page_size=8&fields=' + fields;
  const c = new AbortController();
  const tid = setTimeout(() => c.abort(), 5000);
  try {
    const res = await fetch(url, { signal: c.signal });
    if (!res.ok) return [];
    const data = await res.json();
    const hits = data.hits || [];
    return hits.map(p => {
      const n = p.nutriments || {};
      const kcal = num(n['energy-kcal_100g'], num(n['energy-kcal'], 0));
      const protein = num(n['proteins_100g'], 0);
      const carbs   = num(n['carbohydrates_100g'], 0);
      const fat     = num(n['fat_100g'], 0);
      const brand   = Array.isArray(p.brands) ? p.brands[0] : (p.brands || '').split(',')[0].trim();
      const name    = p.product_name_en || p.product_name_th || p.product_name || 'Unnamed';
      return {
        name: name + (brand ? ' (' + brand + ')' : ''),
        default_serving: { unit: 'serving', grams: 100 },
        alt_servings: [],
        per_100g: { kcal: Math.round(kcal), protein, carbs, fat },
        source: 'OFF',
        image: p.image_thumb_url || '',
        quantity: p.quantity || '',
      };
    }).filter(f =>
      f.per_100g.kcal > 0 || f.per_100g.protein > 0 || f.per_100g.carbs > 0 || f.per_100g.fat > 0
    );
  } catch { return []; }
  finally { clearTimeout(tid); }
}
function num(v, fb) { return typeof v === 'number' && isFinite(v) ? v : fb; }

async function fetchGroq(q, env) {
  const system = `You suggest food matches for a nutrition tracker. Return ONLY valid JSON.`;
  const user = `Query: "${q}" (Thai or English).
Return up to 4 likely food matches as JSON:
{ "foods": [ { "name": "English name (Thai in parens if Thai dish)",
  "default_serving": { "unit": "plate|piece|cup|slice|bowl|serving|tbsp|can|bottle|glass", "grams": number },
  "alt_servings": [ { "unit": "string", "grams": number } ],
  "per_100g": { "kcal": number, "protein": number, "carbs": number, "fat": number } } ] }
- Realistic portions (Pad Krapao plate ~350g, Som Tam ~150g, bowl noodle soup ~500g, beer can 330ml, milk glass 250ml)
- For beverages prefer unit "can", "bottle", or "glass" with grams = liquid volume in ml (ml ≈ g)
- per_100g, not per_serving
- ONLY JSON.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.GROQ_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '{"foods":[]}';
  let parsed; try { parsed = JSON.parse(text); } catch { return []; }
  return (parsed.foods || []).map(f => ({ ...f, source: 'AI' }));
}

// ---------- Photo — placeholder; not yet wired to a vision model ----------
async function handlePhoto(request, env) {
  return jsonError(503, 'Photo analysis not yet wired (vision model TBD for Groq)');
}

function corsHeaders(isPreflight, contentType) {
  const h = {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (isPreflight) h['Access-Control-Max-Age'] = '86400';
  if (contentType) h['Content-Type'] = contentType;
  return h;
}
function jsonError(status, error, detail) {
  return new Response(JSON.stringify({ error, detail }), {
    status, headers: corsHeaders(false, 'application/json'),
  });
}
