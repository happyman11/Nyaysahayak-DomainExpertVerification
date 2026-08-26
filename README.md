# NyaySahayak: Justice through Assistance — Answer Verifier

A static, no-build, GitHub-Pages-hosted app that lets Indian lawyers
independently review and annotate the Act/Section recommendations produced
by the NyaySahayak legal-AI system, scenario by scenario, and export a
structured JSON/CSV/PDF suitable for research analysis (inter-rater
agreement, precision, section-level exact match, etc.).

No backend is required for the default flow — everything runs in the
browser, progress autosaves to `localStorage`, and the final evaluation
downloads as JSON + PDF. Centralized storage, a password-protected admin
dashboard, live scenario publishing, and cross-device resume are all
available too, powered by an optional free Supabase project — see
"Admin & centralized storage" below.

## Project structure

```
legal-ai-lawyer-validation/
  index.html              # lawyer-facing app
  admin.html              # admin dashboard (Supabase Auth gated)
  css/style.css           # shared design tokens, light/dark theme
  js/
    parser.js             # extractSections() — Act/Section citation parser
    storage.js             # localStorage state schema + autosave
    importer.js            # JSON ingestion, validation, merge, dedupe
    exporter.js             # JSON/CSV export payload + downloads
    pdf_report.js            # client-side PDF report (jsPDF)
    supabase_client.js        # thin wrapper: submissions, scenarios, sessions, auth
    theme.js                   # light/dark toggle (shared by both pages)
    app.js                      # lawyer-facing orchestrator
    admin.js                     # admin dashboard orchestrator
    remote_config.example.js      # copy to remote_config.js (gitignored) to enable Supabase
    vendor/                        # marked, DOMPurify, jsPDF, supabase-js (vendored, offline-friendly)
  data/sample_results.json  # bundled scenario data (fallback below Supabase)
  supabase/schema.sql       # tables + RLS policies — run once in Supabase SQL Editor
  assets/                    # NyaySahayak logo
```

## Running locally

```bash
cd legal-ai-lawyer-validation
python3 -m http.server 8000
```

Then open:

```
http://localhost:8000
```

(A plain `file://` open won't work — the bundled-data `fetch()` call needs
an HTTP server, even a local one.)

## Researcher mode

```
http://localhost:8000/?researcher=true
```

Researcher mode shows an "Import AI Results" screen for drag-and-drop
loading of one or more `data.json` files (single object, array, or
multiple files are all supported — see "Input JSON format" below). It
also shows the model name for the current scenario during review, which is
hidden from lawyers in normal mode to avoid biasing their assessment.

From researcher mode you can:
- **Start Review with These Scenarios** — begin a real review session
  using the files you just loaded (useful for testing before publishing).
- **Download Merged JSON** — download the merged, validated, sorted
  scenario array. Save this as `data/sample_results.json` and commit it;
  every lawyer's session then loads it automatically with zero file
  handling on their end (see "Default data loading" below).

## GitHub Pages deployment

1. Populate `data/sample_results.json` with your real scenario data (via
   the researcher-mode "Download Merged JSON" flow above, or by hand).
2. Commit and push this folder to a GitHub repository.
3. In the repo's Settings → Pages, set the source to the branch/folder
   containing `index.html` (e.g. `main` / `/` or `main` / `/docs`).
4. Visit the published URL. No build step, no server-side code, and no
   `js/remote_config.js` are required for the default flow.

## Default data loading

On load, the app first tries the live Supabase `scenarios` table (only if
remote storage is configured — see "Admin & centralized storage" below),
then falls back to `fetch('data/sample_results.json')`. If either
succeeds, scenarios load silently and the lawyer sees no file-handling UI
at all. If both are missing/invalid, a minimal "Load Review Session"
drag-and-drop screen appears instead, so the app never dead-ends even
without `?researcher=true`.

## Input JSON format

Each scenario matches the AI system's real output shape:

```json
{
  "scenario_index": 1,
  "question": "Yesterday I received a WhatsApp message saying my bank KYC would expire...",
  "model": "qwen3:30b",
  "generated_at": "2026-08-25T23:45:15",
  "answers": {
    "Information Technology (IT) Act, 2000": "### 1. Applicable Sections...\n- Section 66C...",
    "Bharatiya Nyaya Sanhita (BNS), 2023": "### 1. Applicable Sections...",
    "Bharatiya Sakshya Adhiniyam (BSA), 2023": "### 1. Applicable Sections...",
    "Digital Personal Data Protection Act (DPDP), 2023": "I am unable to answer this question as it is outside my knowledge base."
  },
  "synthesis": "### Information Technology (IT) Act, 2000 ... combined final response ..."
}
```

`scenario_index`, `question`, and `answers` are required; `synthesis`,
`model`, and `generated_at` are optional. Multiple scenarios can be
supplied either as a single JSON array, or as separate files (one
scenario object per file) — both are merged and sorted by
`scenario_index` automatically. Duplicate `scenario_index` values are
detected and warned about (the first-loaded copy is kept).

`js/parser.js`'s `extractSections(answerText)` automatically extracts
candidate `Section N(...)` citations from each Act's markdown answer,
prioritizing an "Applicable Sections" / "Applicable Provisions" /
"Relevant Sections" heading block when present and falling back to the
full answer text otherwise (`extraction_source` records which path was
used, for later auditing). The original `raw_answer` is always preserved
alongside the extracted list — nothing from the model's output is ever
discarded.

## Export format

On submission, the app builds and downloads
`lawyer_validation_<name>_<timestamp>.json`:

```json
{
  "study": { "name": "Indian Legal AI Expert Validation", "version": "1.0" },
  "reviewer": { "name": "...", "email": "...", "experience": "...", "practice_areas": ["..."] },
  "session": { "started_at": "...", "submitted_at": "...", "duration_seconds": 0 },
  "responses": [
    {
      "scenario_index": 1,
      "question": "...",
      "source_model": "qwen3:30b",
      "source_generated_at": "...",
      "system_answers": {
        "Information Technology (IT) Act, 2000": {
          "extracted_sections": ["Section 66C", "Section 66D"],
          "raw_answer": "full original generated answer"
        }
      },
      "system_synthesis": "...",
      "lawyer_validation": {
        "act_reviews": {
          "Information Technology (IT) Act, 2000": {
            "applicability": "applicable",
            "sections": { "Section 66C": "applicable", "Section 66D": "not_applicable" }
          }
        },
        "missing_provisions": [{ "act": "BNS, 2023", "section": "Section XXX" }],
        "irrelevant_provisions": [{ "act": "Information Technology (IT) Act, 2000", "section": "Section 43" }],
        "overall_correctness": 4,
        "confidence": 5,
        "factual_sufficiency": "yes",
        "multiple_interpretations": "no",
        "ambiguity_comment": "",
        "comments": ""
      }
    }
  ]
}
```

This is designed to load directly with `import json` / `pandas` for
downstream analysis (Act-level precision/agreement, section-level exact
and partial match, false positives, missing sections, confidence,
factual sufficiency, ambiguity, and inter-rater agreement across multiple
lawyers reviewing the same scenarios). The same data is also available as
a **PDF report** (`js/pdf_report.js`, one PDF per submission, generated
entirely client-side with jsPDF — never a separately stored file, always
regenerated fresh from the JSON so it can never drift out of sync) and as
a flat **CSV** (`js/exporter.js`'s `buildSubmissionsCsv` — see "CSV
export shape" below), for whichever tool you're doing analysis in.

## Admin & centralized storage (Supabase)

By default, submitting a review just downloads JSON + PDF to the lawyer's
own device — nothing is sent anywhere, and there's no way to see who's
reviewed what without asking each lawyer for their file. Configuring a
free Supabase project unlocks four things at once, all optional and all
off until you turn them on:

1. **Centralized submissions** — each submission saves to a database
   table instead of only downloading locally. Once this is on, the
   reviewing lawyer does **not** get a local copy at all (no auto-download,
   no "Download Again" button) — only an admin can retrieve it via
   `admin.html`. If the remote save ever fails (network issue,
   misconfiguration), the app automatically falls back to local
   download so a completed review is never silently lost.
2. **Live scenario publishing** — an admin uploads `data.json` file(s)
   through `admin.html` and publishes them; every lawyer's session then
   loads that live data automatically, with no GitHub commit needed.
3. **Cross-device resume** — a lawyer who started a review on one
   device/browser can pick up where they left off on another, by email.
4. **Admin dashboard** — `admin.html`, gated by real Supabase Auth
   (email+password, not a client-side password check — see the security
   note below), lists every submission with a completion summary and
   per-row JSON/PDF download, plus bulk "Download All" as JSON or CSV.

### Setup

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase Dashboard, open **SQL Editor → New query**, paste the
   entire contents of `supabase/schema.sql` from this repo, and run it.
   This creates three tables (`lawyer_validations`, `scenarios`,
   `review_sessions`) with Row Level Security policies already wired up —
   read the comments at the top of that file for exactly what each policy
   allows and why.
3. Create your admin account: **Authentication → Users → Add user**,
   enter your email and a password directly (this is the only account
   that can sign into `admin.html`). Then, in **Authentication →
   Providers → Email**, turn **off** "Allow new users to sign up" so
   nobody else can self-register an account.
4. Get your credentials from **Settings → API**: the "Project URL" and
   the `anon` `public` key (**not** the `service_role` key — that one
   must never appear in this app, since it ships to every visitor's
   browser).
5. In this project, copy `js/remote_config.example.js` to
   `js/remote_config.js` (already gitignored — never commit real
   credentials), set `enabled: true`, and paste in the URL + anon key.
6. Redeploy (or just refresh locally). Open `admin.html`, sign in with
   the account from step 3, and use the "Scenario Data" panel to publish
   your real scenarios — every lawyer's session will pick them up
   automatically from then on.

### Using `admin.html`

- **Submissions** — table of every completed review (reviewer, experience,
  scenarios rated, submitted-at, duration), with **JSON** / **PDF**
  buttons per row, plus **Download All (JSON)** and **Download All
  (CSV)** for bulk analysis.
- **Scenario Data** — shows the currently-live scenario count, and a
  drag-and-drop zone (same validation/merge/duplicate-detection as
  researcher mode) to load new `data.json` file(s). **Publish as Live
  Scenario Data** replaces the entire live set — you'll be asked to
  confirm, since it affects every lawyer immediately.
- **Sign Out** ends the Supabase Auth session.

### CSV export shape

One row per **(submission × scenario × Act)** — the granularity the
original data-quality goals need directly, without re-parsing nested
JSON:

```
reviewer_name, reviewer_email, reviewer_experience, scenario_index,
question, act_name, source_model, extracted_sections, act_applicability,
section_verdicts, no_answer_assessment, missing_provisions_for_act,
irrelevant_provisions_for_act, overall_correctness, confidence,
factual_sufficiency, multiple_interpretations, ambiguity_comment,
comments, submitted_at
```

Load it with `pandas.read_csv(...)` directly for Act-level and
section-level accuracy/agreement analysis.

### Security notes

- The admin panel is protected by **real Supabase Auth**, not a
  client-side password check — a password hardcoded in this site's JS
  would be readable by anyone via browser dev tools, so it would only
  ever be a light deterrent, not real security. Auth sign-in happens
  server-side against Supabase; only an account you create by hand can
  ever get in.
- `lawyer_validations` (final submissions) is **admin-read-only** —
  anyone can submit (insert), nobody but an authenticated admin can list
  or read them back, enforced by the RLS policies in
  `supabase/schema.sql`, not just by the UI.
- `scenarios` (live scenario data) is publicly readable (it's the same
  content every lawyer reviews, not sensitive) but only an authenticated
  admin can write to it.
- `review_sessions` (in-progress autosave, for cross-device resume) is
  intentionally more permissive — since lawyers aren't authenticated,
  anyone who knows a participant's email could look up their in-progress
  (not yet submitted) draft. This is a deliberate trade-off documented in
  `supabase/schema.sql`, appropriate for a small known/invited
  participant pool; it does not expose final submissions. If you need
  stronger isolation, don't use the broad policy there as-is.
- Never put a `service_role` key in `js/remote_config.js` or anywhere
  else in this app's client-side code.

## Anti-bias design

- The model name is never shown during normal review, only in researcher
  mode — it's stored in the export but must not influence the lawyer.
- AI-extracted section chips always render in a neutral grey/blue and are
  never colored as if pre-validated or "correct".
- The full AI reasoning ("View System Explanation") and the combined
  synthesis panel both start collapsed, and the synthesis panel is placed
  after the Act/Section questions to reduce anchoring bias.
- No choice button is ever pre-selected.

## Security

AI-generated markdown (per-Act answers and the synthesis) is rendered via
`marked.js` and sanitized with `DOMPurify` before insertion into the page.
Imported JSON is validated (required fields checked) and never executed —
only its string/object values are read.
