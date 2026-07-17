# Starting a new Claude Code chat on this project

Copy-paste the prompt in **§ 1** into your first message on a new Claude Code
session. That's it. Everything else in this file is background if you want to
know what the prompt actually does.

---

## 1. The prompt (paste this verbatim)

```
This is the Workout Tracker project (single-file HTML PWA at
workout-tracker-d3b.pages.dev, current version v1.12.10).

Before doing anything, please:

1. Read HANDOFF.md in this directory — it has stack, deploy workflow,
   architecture, pending features, and known limitations.
2. Read the current app: workout-tracker-v1.10.html
   (the filename is stale; content is v1.12.10).
3. Skim these Claude Code memory files if they're loaded:
   ~/.claude/projects/C--Users-p-vorapreechapanich-.../memory/pending.md
   ~/.claude/projects/C--Users-p-vorapreechapanich-.../memory/project.md
   ~/.claude/projects/C--Users-p-vorapreechapanich-.../memory/feedback.md
4. The Cloudflare Worker code lives at worker.js in this folder — it's the
   backup of https://workout-nutrition-proxy.pv-proj.workers.dev (Groq
   Llama 3.3 70B). If we need to modify it, I'll paste changes into the
   Cloudflare dashboard.

Deploy workflow:
- Edit workout-tracker-v1.10.html
- cp to repo/index.html
- git commit + push in repo/ → Cloudflare Pages auto-deploys in ~30s
- Bump the version in <meta name="app-version">, login footer text, and
  settings footer text (three places, use replace_all)

House rules:
- Verify JC exercise slugs (curl the CDN) before adding new exercises.
- Verify Worker/API responses (curl) BEFORE deploying prompt changes.
- Batch related edits in a single response to keep costs down.
- Don't rename the .html file — filename is stale by design.
- Add anchor overrides in worker.js for any new Thai dish we standardise.

Ready? What are we working on?
```

---

## 2. Optional context to add if relevant

If your first task is specifically **nutrition-related**, add:

```
Focus area: nutrition tracker. See §6 of HANDOFF.md for the search+barcode
architecture, and pending.md for what's next (Favorites, Copy meal,
Progress sub-tab, Photo analysis).
```

If your task involves **Thai food accuracy**:

```
Note the ANCHORS table in worker.js — it's server-side overrides applied
after Llama responds. Add anchors there, not in the app HTML, if we want
deterministic macros for a specific dish.
```

If working from a **different machine / OS**:

```
This session is running on <macOS/Linux/Windows>. Adapt path separators
in commands. The working directory is <path>. Git remote points to
https://github.com/polxvii/workout-tracker.
```

---

## 3. What the prompt causes Claude to do

1. Loads full project context in one round-trip (fewer clarifying questions later)
2. Confirms the version-name mismatch upfront (filename says v1.10, content is v1.12.10) — a common source of confusion
3. Locks in the deploy workflow so it doesn't re-derive it every session
4. Sets a "verify before you push" norm (we hit this the hard way in v1.11 when Search-a-licious CORS wasn't checked)
5. Points at the Worker backup file so Claude doesn't try to read the deployed Worker (impossible from outside the CF dashboard)

---

## 4. What NOT to include in a new-chat prompt

**Don't paste API keys or the Groq secret.** The Worker holds them; the app doesn't need them; Claude Code shouldn't either.

**Don't paste the Cloudflare account subdomain** unless the migration is between accounts. It's in HANDOFF.md if needed.

**Don't ask Claude to "read everything" without §1's list** — the HTML file is huge (~500KB, ~11k lines) and reading it top-to-bottom wastes budget. Targeted `Grep` / `Read offset+limit` is cheaper.

---

## 5. Recovering from a lost machine

If moving to a totally new environment:

1. `git clone https://github.com/polxvii/workout-tracker` → live `index.html`
2. Copy `repo/index.html` to `workout-tracker-v1.10.html` in a new working dir
3. Copy `HANDOFF.md`, `NEW_CHAT_INSTRUCTIONS.md`, `worker.js` from wherever your backup is
4. In the new Claude Code session, paste the § 1 prompt

If you also lost the Cloudflare Worker code (dashboard reset):

1. Log into Cloudflare → Workers → create new "Hello World" Worker
2. Paste `worker.js` contents into the editor
3. Add secret `GROQ_API_KEY` (get a fresh one from console.groq.com if needed)
4. Update `NUTRITION_WORKER_URL` constant in the HTML if the new Worker URL differs from `https://workout-nutrition-proxy.pv-proj.workers.dev`

---

## 6. Verifying the migration worked

Before declaring migration complete, confirm:

- [ ] `curl https://workout-tracker-d3b.pages.dev/` returns HTML with `v1.12.10` in the meta tag
- [ ] `curl "https://<worker>/search?q=egg"` returns `{"foods":[...]}` (Worker + Groq alive)
- [ ] Open the PWA on iPhone → Log in → see previous strength/cardio/nutrition entries (Supabase sync working)
- [ ] Nutrition tab → Search → type `pad thai` → results appear within ~2s
- [ ] Nutrition tab → Barcode → camera opens (permission granted) → scan any barcode
- [ ] Settings → Nutrition targets shows the last saved values
