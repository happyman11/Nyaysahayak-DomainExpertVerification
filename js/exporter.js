/**
 * exporter.js — assembles and delivers the final lawyer-validation JSON.
 * `buildExportPayload` follows the user's exact schema (spec section 29).
 */

const STUDY_NAME = "Indian Legal AI Expert Validation";
const STUDY_VERSION = "1.0";

function cleanActReview(review, isNoAnswer) {
  const out = { applicability: review.applicability, sections: Object.assign({}, review.sections) };
  if (isNoAnswer) {
    out.no_answer_assessment = review.no_answer_assessment;
  }
  return out;
}

/**
 * Pure function: reads state.reviewer/scenarios/progress/session and
 * produces the exact verbatim export schema the researcher specified.
 * Internal-only UI-state fields (missing_flag, irrelevant_flag,
 * irrelevant_sections_checked) are intentionally NOT included — only the
 * resulting missing_provisions/irrelevant_provisions arrays are, matching
 * the schema's literal shape.
 */
function buildExportPayload(state) {
  const startedAt = state.session.started_at;
  const submittedAt = state.submitted_at || new Date().toISOString();
  const durationSeconds = startedAt
    ? Math.max(0, Math.round((new Date(submittedAt).getTime() - new Date(startedAt).getTime()) / 1000))
    : 0;

  const responses = state.scenarios.map((scenario) => {
    const entry = state.progress[String(scenario.scenario_index)];
    const lv = entry ? entry.lawyer_validation : null;

    const system_answers = {};
    for (const actName of Object.keys(scenario.answers)) {
      const parsed = scenario._parsed[actName];
      system_answers[actName] = {
        extracted_sections: parsed.extracted_sections,
        raw_answer: scenario.answers[actName],
      };
    }

    const act_reviews = {};
    for (const actName of Object.keys(scenario.answers)) {
      const parsed = scenario._parsed[actName];
      const review = lv && lv.act_reviews[actName] ? lv.act_reviews[actName] : window.LegalStorage.createActReview();
      act_reviews[actName] = cleanActReview(review, parsed.is_no_answer);
    }

    return {
      scenario_index: scenario.scenario_index,
      question: scenario.question,
      source_model: scenario.model || null,
      source_generated_at: scenario.generated_at || null,
      system_answers,
      system_synthesis: scenario.synthesis || "",
      lawyer_validation: {
        act_reviews,
        missing_provisions: lv ? lv.missing_provisions : [],
        irrelevant_provisions: lv ? lv.irrelevant_provisions : [],
        overall_correctness: lv ? lv.overall_correctness : null,
        confidence: lv ? lv.confidence : null,
        factual_sufficiency: lv ? lv.factual_sufficiency : null,
        multiple_interpretations: lv ? lv.multiple_interpretations : null,
        ambiguity_comment: lv ? lv.ambiguity_comment : "",
        comments: lv ? lv.comments : "",
      },
    };
  });

  return {
    study: { name: STUDY_NAME, version: STUDY_VERSION },
    reviewer: {
      name: state.reviewer.name,
      email: state.reviewer.email,
      experience: state.reviewer.experience,
      practice_areas: state.reviewer.practice_areas,
    },
    session: {
      started_at: startedAt,
      submitted_at: submittedAt,
      duration_seconds: durationSeconds,
    },
    responses,
  };
}

function slugify(name) {
  return (name || "reviewer")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "reviewer";
}

function formatTimestampForFilename(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${y}-${m}-${d}_${hh}-${mm}`;
}

function buildFilename(reviewerName, timestamp) {
  const ts = formatTimestampForFilename(timestamp || new Date());
  return `lawyer_validation_${slugify(reviewerName)}_${ts}.json`;
}

function downloadJSON(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CSV_COLUMNS = [
  "reviewer_name",
  "reviewer_email",
  "reviewer_experience",
  "scenario_index",
  "question",
  "act_name",
  "source_model",
  "extracted_sections",
  "act_applicability",
  "section_verdicts",
  "no_answer_assessment",
  "missing_provisions_for_act",
  "irrelevant_provisions_for_act",
  "overall_correctness",
  "confidence",
  "factual_sufficiency",
  "multiple_interpretations",
  "ambiguity_comment",
  "comments",
  "submitted_at",
];

function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * Flattens one or more export payloads (as produced by buildExportPayload)
 * into one CSV row per (submission x scenario x act) — the granularity
 * the original data-quality goals need directly: Act-level and
 * section-level accuracy/agreement can be computed straight from this
 * without re-parsing nested JSON, e.g. with pandas.read_csv.
 */
function buildSubmissionsCsv(payloads) {
  const rows = [CSV_COLUMNS.join(",")];

  for (const payload of payloads) {
    for (const resp of payload.responses) {
      for (const actName of Object.keys(resp.system_answers)) {
        const sysAct = resp.system_answers[actName];
        const review = (resp.lawyer_validation.act_reviews || {})[actName] || {};
        const lv = resp.lawyer_validation;

        const sectionVerdicts = Object.entries(review.sections || {})
          .map(([section, verdict]) => `${section}: ${verdict}`)
          .join("; ");
        const missingForAct = (lv.missing_provisions || [])
          .filter((p) => p.act === actName)
          .map((p) => p.section)
          .join("; ");
        const irrelevantForAct = (lv.irrelevant_provisions || [])
          .filter((p) => p.act === actName)
          .map((p) => p.section)
          .join("; ");

        const row = [
          payload.reviewer.name,
          payload.reviewer.email,
          payload.reviewer.experience,
          resp.scenario_index,
          resp.question,
          actName,
          resp.source_model,
          (sysAct.extracted_sections || []).join("; "),
          review.applicability,
          sectionVerdicts,
          review.no_answer_assessment,
          missingForAct,
          irrelevantForAct,
          lv.overall_correctness,
          lv.confidence,
          lv.factual_sufficiency,
          lv.multiple_interpretations,
          lv.ambiguity_comment,
          lv.comments,
          payload.session.submitted_at,
        ];
        rows.push(row.map(csvEscape).join(","));
      }
    }
  }

  return rows.join("\r\n");
}

function downloadCsv(payloads, filename) {
  // Prefix a UTF-8 BOM so Excel opens the file with correct encoding
  // (important here since scenario text routinely contains ₹ and other
  // non-ASCII characters).
  const blob = new Blob(["﻿" + buildSubmissionsCsv(payloads)], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename);
}

/**
 * No-ops immediately unless window.REMOTE_SUBMIT_CONFIG.enabled === true
 * (populated only by the gitignored js/remote_config.js, never committed
 * with real credentials). Uses only a client-safe Supabase anon key.
 */
async function submitToRemoteDatabase(payload) {
  if (!window.LegalSupabase || !window.LegalSupabase.isConfigured()) {
    return { ok: true, skipped: true };
  }
  return window.LegalSupabase.insertSubmission(payload);
}

window.LegalExporter = {
  STUDY_NAME,
  STUDY_VERSION,
  buildExportPayload,
  buildFilename,
  downloadJSON,
  downloadBlob,
  buildSubmissionsCsv,
  downloadCsv,
  submitToRemoteDatabase,
};
