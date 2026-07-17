# Workout Tracker — Project Handoff

> Single-file HTML PWA for tracking strength + cardio workouts + nutrition.
> Deployed to Cloudflare Pages, source on GitHub, data on Supabase.
> **Current version: v1.12.10** (as of 2026-06-29)

---

## 1. What this is

A mobile-first single-page app (one big `workout-tracker-v1.10.html`) where the user logs strength sets/reps/weight, cardio sessions, and nutrition intake, then views history + progress. Target device: iPhone in "Add to Home Screen" PWA mode.

### Three top-level features

| Tab | What it does |
|---|---|
| 💪 Strength | Log exercises (~270 bundled + custom); History & Progress views; PR tracking; muscle-map heat visualisation on History |
| 🏃 Cardio | Log sessions (29 activities); OCR Garmin screenshots via Tesseract.js; HR zones; pace/distance charts |
| 🍎 Nutrition (v1.10+) | Log food entries via Manual / Search / Barcode; daily macro targets w/ calculator; daily summary + history |

Plus 📚 Library (browse all exercises + stretching guide) and ⚙️ Settings.

---

## 2. Stack

- **Frontend**: One HTML file, plain JS, custom CSS. No framework, no build step.
- **Auth + DB**: Supabase
  - URL: `https://ctnnuakqubvljowwizzb.supabase.co`
  - Publishable key: `sb_publishable_iFnuDCy0fkPR4neO2L_Tgw_T6oX5pk9` (hardcoded, RLS-protected)
  - Single `workouts` table with typed rows
- **Hosting**: Cloudflare Pages, auto-deploys on push to `main`
  - Live: https://workout-tracker-d3b.pages.dev
  - Backup on GitHub Pages: https://polxvii.github.io/workout-tracker/
- **Repo**: https://github.com/polxvii/workout-tracker
- **OCR**: Tesseract.js from jsDelivr CDN (lazy-loaded)
- **Exercise GIFs**: JahelCuadrado ExerciseGymGifsDB v1.1.0 via jsDelivr, proxied+resized by wsrv.nl to ~75KB WebP
- **Barcode scanning**: native `window.BarcodeDetector` + ZXing-js fallback (lazy-loaded from CDN)
- **AI food search + macro estimation**: Cloudflare Worker → Groq Llama 3.3 70B
  - Worker URL: `https://workout-nutrition-proxy.pv-proj.workers.dev`
  - Endpoints: `GET /search?q=...`, `POST /photo` (returns 503; not yet wired)
  - Free tier only — no billing

---

## 3. Data model (Supabase `workouts` table)

Single table, discriminated by `type`:

| Column | Meaning |
|---|---|
| `id` | text PK — e.g. `L1730...` / `C1730...` / `N1730...` / `custom-<slug>-<ts>` / `nutrition_targets_<user_id>` |
| `user_id` | uuid — RLS restricts to `auth.uid()` |
| `type` | `'strength'` \| `'cardio'` \| `'custom_exercise'` \| `'custom_activity'` \| `'nutrition'` \| `'nutrition_targets'` |
| `date` | text `YYYY-MM-DD` (sentinel `'1970-01-01'` for singleton meta rows) |
| `data` | jsonb — full log payload; shape varies by `type` |
| `updated_at` | timestamptz |

No schema changes since v1.08 — nutrition rows reused the existing table.

---

## 4. Deploy workflow

```
1. Edit workout-tracker-v1.10.html
2. Bump version in 3 places (meta tag + login footer + settings footer)
   Use replace_all for consistency
3. cp workout-tracker-v1.10.html repo/index.html
4. cd repo && git add index.html && git commit -m "..." && git push
5. Cloudflare auto-deploys within ~30-60 seconds
```

**File naming quirk**: The working file is named `workout-tracker-v1.10.html` but the *content* meta tag says v1.12.10. We stopped bumping the filename after v1.10; the content version is authoritative.

---

## 5. Local paths (Windows / current machine)

```
C:\Users\p.vorapreechapanich\OneDrive - Accenture\Documents\Claude\workout-tracker\
├── workout-tracker-v1.10.html    ← the app (current: ~500KB)
├── repo\                          ← cloned github.com/polxvii/workout-tracker
│   ├── index.html                 ← identical copy pushed on each deploy
│   └── .git\
├── worker.js                      ← Cloudflare Worker backup (see §7)
├── HANDOFF.md                     ← this file
├── NEW_CHAT_INSTRUCTIONS.md       ← how to bootstrap a new Claude Code session
├── MIGRATION_SPEC.md              ← historical (older dataset migration; can ignore)
├── exercises-jc.json              ← historical
├── exercises-free.json            ← historical
├── new-exercises.js               ← historical
└── failed-slugs.txt               ← historical
```

Claude Code memory files at `~/.claude/projects/C--Users-p-vorapreechapanich-.../memory/`:
- `MEMORY.md` — index (auto-loaded by Claude Code)
- `project.md` — current project state
- `pending.md` — pending features + parked state
- `user.md`, `feedback.md`

---

## 6. Nutrition Tracker architecture (added v1.10 → v1.12.10)

### Entry methods (4 tiles on Nutrition Log)

1. **✍️ Manual** — food name, meal (auto-picked by time), kcal + C/P/F, notes
2. **📷 Photo** — 503 placeholder; needs vision model wired (see pending)
3. **🔎 Search** — Cloudflare Worker → hybrid Groq AI + Open Food Facts DB, with anchor overrides for known Thai dishes
4. **📦 Barcode** — camera scans → `BarcodeDetector` or ZXing → OFF `/api/v2/product/{code}.json` direct call (CORS open there). "Not found" hands off to AI search by name.

### Targets calculator (in Settings)

Mifflin-St Jeor BMR × activity multiplier × weight-rate goal adjustment (7,700 kcal per kg of body fat). Macro splits use protein-first math + preset ratios (Balanced 40/30/30, High-Protein 40/40/20, Low-Carb 25/35/40, Keto 5/25/70). Two-way binding between grams and % fields.

### Search hybrid — how it works

1. App sends `q=` to Worker `/search`
2. Worker fires OFF + Groq in parallel with `Promise.allSettled`
3. Worker applies anchor-table override for known Thai dishes so Llama's macros are corrected
4. Merged results: OFF first (badge "DB"), then AI (badge "AI"), up to 10
5. App renders with source badge + client-side drink detection for ml display

### OFF Search-a-licious limitations (know before debugging)

- Main OFF search index tokenises **English fields only** — pure Thai queries return `hits: []`. User must type English brand names for OFF matches.
- OFF `/api/v2/product/{barcode}` has open CORS (`*`) — app hits it directly.
- OFF `/api/v2/search` and `/cgi/search.pl` both timed out (10s+). We use Search-a-licious via the Worker instead.

### Worker prompt anchors (in worker.js)

Deterministic per-100g macro overrides for common Thai dishes applied *after* Llama responds, so hallucination is neutralised for known foods. Non-anchored dishes use Llama's estimate as-is (typically ±20% — starting point, user edits).

---

## 7. Cloudflare Worker

**Lives ONLY in the Cloudflare dashboard.** File `worker.js` in this folder is a backup snapshot.

### Setup (for a fresh Cloudflare account)

1. Groq: https://console.groq.com/keys (free, no card) → create API key `gsk_...`
2. Cloudflare: dash.cloudflare.com → Workers → "Start with Hello World!"
3. Name it `workout-nutrition-proxy` (update `ALLOW_ORIGIN` in code if app URL differs)
4. "Edit code" → paste contents of `./worker.js` → Save and deploy
5. Worker Settings → Variables and Secrets → add secret `GROQ_API_KEY` = your Groq key
6. Note the Worker URL. If it changes, update `NUTRITION_WORKER_URL` constant in the HTML file.

### Verify Worker works

```
curl "https://<your-worker>.workers.dev/search?q=egg"
# Should return { "foods": [...] } in ~1-2s
```

---

## 8. Version history — session log

| Version | What shipped |
|---|---|
| v1.02 (baseline) | Initial handoff state before this project's Claude sessions |
| v1.03 | Exercise dataset rebuilt (JahelCuadrado GIFs, semantic IDs) |
| v1.04–v1.06 | Cardio activities, image loading refactor |
| v1.07–v1.08 | JC GIF cards, landmine exercises, PR badges, multi-select filters, Library rename, custom exercises, rest timer |
| v1.09 | JC slug fixes, PR polish, HR zones |
| **v1.10** | Nutrition tracker foundation: 🍎 tab, Manual entry, Targets calculator, Supabase sync |
| **v1.11** | AI food search via Groq Worker; OFF hybrid; source filter pills |
| **v1.12** | Barcode scanner (BarcodeDetector + ZXing + manual entry); OFF direct lookup |
| **v1.12.1–v1.12.10** | Barcode UX polish; ml for drinks; quantity-aware serving; Yesterday pill everywhere; new Matrix cable exercises |

---

## 9. Pending / roadmap

Highlights (full list in `memory/pending.md`):

- **v1.13**: Copy meal entry, Favorites (⭐ save + 5th quick-add tile)
- **v1.14**: Nutrition Progress sub-tab (trend chart, streak, adherence %)
- **v1.15**: Photo analysis — needs Gemini billing OR vision-capable Groq model
- **v1.15+**: Barcode-not-found → photo of nutrition label fallback
- **v1.16+**: Macro consistency warning (4C + 4P + 9F ≈ kcal)

---

## 10. Known limitations (intentional, not bugs)

- **iOS Safari camera permission** — cannot be persistently granted from JS. User sets once in iOS Settings → Safari → Camera.
- **OFF Thai coverage** — many Thai products missing; user can contribute via the OFF mobile app.
- **OFF Thai search** — no Thai tokenisation. English names required for OFF matches.
- **Llama macros ±20%** — physics limit of LLM food estimation. Anchor overrides fix common Thai dishes; user can edit any entry after saving.
- **PWA cache** — iOS caches aggressively. Force refresh: pull down in-app, or long-press icon → Remove → re-add.

---

## 11. Emergency recovery

If the app breaks in production:
1. `git log --oneline` in `repo/` — find last-known-good commit
2. `git revert <bad-commit>` then push → Cloudflare redeploys
3. If Worker is the issue, redeploy `worker.js` from this folder into Cloudflare dashboard

If your local files are lost:
1. `git clone https://github.com/polxvii/workout-tracker` — grabs the deployed HTML
2. Copy `repo/index.html` → `workout-tracker-v1.10.html` to continue work
3. Restore Worker from `worker.js` in this folder (if lost) — see §7

---

## Contact / accounts

- GitHub: `polxvii`
- Cloudflare account subdomain: `pv-proj.workers.dev`
- Supabase project: `ctnnuakqubvljowwizzb` (workouts table + RLS)
- Groq: personal free-tier account
