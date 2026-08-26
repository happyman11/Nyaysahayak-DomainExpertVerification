/**
 * importer.js — JSON ingestion, validation, and merging of scenario data.
 * No DOM access; returns data + error/warning descriptors for app.js to
 * render.
 */

const REQUIRED_ACT_KEYS = [
  "Information Technology (IT) Act, 2000",
  "Bharatiya Nyaya Sanhita (BNS), 2023",
  "Bharatiya Sakshya Adhiniyam (BSA), 2023",
  "Digital Personal Data Protection Act (DPDP), 2023",
];

function validateScenarioObject(obj, filename) {
  const errors = [];
  if (!obj || typeof obj !== "object") {
    return { valid: false, errors: [`${filename}: not a JSON object`] };
  }
  if (typeof obj.scenario_index !== "number") {
    errors.push(`${filename}: missing or non-numeric "scenario_index"`);
  }
  if (typeof obj.question !== "string" || obj.question.trim() === "") {
    errors.push(`${filename}: missing or empty "question"`);
  }
  if (!obj.answers || typeof obj.answers !== "object") {
    errors.push(`${filename}: missing "answers" object`);
  } else {
    for (const key of REQUIRED_ACT_KEYS) {
      if (typeof obj.answers[key] !== "string") {
        errors.push(`${filename}: "answers" is missing the "${key}" key`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Attaches parser.js output to a validated scenario, once, at import time.
 */
function attachParsedData(scenario) {
  const _parsed = {};
  for (const actName of REQUIRED_ACT_KEYS) {
    const answerText = scenario.answers[actName];
    const parsed = window.LegalParser.parseActAnswer(answerText);
    _parsed[actName] = {
      is_no_answer: parsed.isNoAnswer,
      extracted_sections: parsed.extractedSections,
      extraction_source: parsed.extractionSource,
    };
  }
  return Object.assign({}, scenario, { _parsed });
}

/**
 * Accepts an array of { filename, parsedJson } where parsedJson may be a
 * single scenario object OR an array of scenario objects (handles the
 * "single file / array file / multiple files" input shapes uniformly).
 * Duplicate scenario_index -> warning, first occurrence wins (never
 * silently overwrites an already-imported scenario on re-import).
 */
function mergeScenarioSources(rawInputs) {
  const errors = [];
  const warnings = [];
  const byIndex = new Map();
  const order = [];

  for (const { filename, parsedJson } of rawInputs) {
    const candidates = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
    candidates.forEach((candidate, i) => {
      const label = Array.isArray(parsedJson) ? `${filename}[${i}]` : filename;
      const { valid, errors: objErrors } = validateScenarioObject(candidate, label);
      if (!valid) {
        errors.push(...objErrors);
        return;
      }
      const idx = candidate.scenario_index;
      if (byIndex.has(idx)) {
        warnings.push(
          `Duplicate scenario_index ${idx} found in ${label} — keeping the first-loaded copy, this one was ignored.`
        );
        return;
      }
      byIndex.set(idx, attachParsedData(candidate));
      order.push(idx);
    });
  }

  order.sort((a, b) => a - b);
  const scenarios = order.map((idx) => byIndex.get(idx));

  return { scenarios, warnings, errors };
}

function summarizeScenarios(scenarios) {
  const modelsSeen = Array.from(new Set(scenarios.map((s) => s.model).filter(Boolean)));
  const indexes = scenarios.map((s) => s.scenario_index);
  const indexRange = indexes.length ? [Math.min(...indexes), Math.max(...indexes)] : [null, null];
  return { count: scenarios.length, modelsSeen, indexRange };
}

/**
 * Fetches the bundled sample data (data/sample_results.json). Returns
 * null on 404/parse failure rather than throwing, so the caller can fall
 * back to the manual-import screen without a try/catch of its own.
 */
async function loadBundledSampleData() {
  try {
    const res = await fetch("data/sample_results.json", { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const candidates = Array.isArray(json) ? json : [json];
    if (candidates.length === 0) return null;
    const { scenarios, errors } = mergeScenarioSources([{ filename: "sample_results.json", parsedJson: json }]);
    if (errors.length > 0 || scenarios.length === 0) return null;
    return scenarios;
  } catch (e) {
    console.warn("importer.loadBundledSampleData: fetch/parse failed", e);
    return null;
  }
}

/**
 * Fetches scenario data an admin has published to the Supabase `scenarios`
 * table (see js/admin.js). Returns null (not throw) if remote storage
 * isn't configured, the table is empty, or the fetch fails, so callers
 * can fall through to loadBundledSampleData() the same way.
 */
async function loadScenariosFromSupabase() {
  if (!window.LegalSupabase || !window.LegalSupabase.isConfigured()) return null;
  try {
    const result = await window.LegalSupabase.fetchLiveScenarios();
    if (!result.ok || result.scenarios.length === 0) return null;
    const { scenarios, errors } = mergeScenarioSources([{ filename: "supabase:scenarios", parsedJson: result.scenarios }]);
    if (errors.length > 0 || scenarios.length === 0) return null;
    return scenarios;
  } catch (e) {
    console.warn("importer.loadScenariosFromSupabase: fetch failed", e);
    return null;
  }
}

function readFileAsJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (e) {
        reject(new Error(`${file.name}: not valid JSON (${e.message})`));
      }
    };
    reader.onerror = () => reject(new Error(`${file.name}: could not be read`));
    reader.readAsText(file);
  });
}

window.LegalImporter = {
  REQUIRED_ACT_KEYS,
  validateScenarioObject,
  mergeScenarioSources,
  summarizeScenarios,
  loadBundledSampleData,
  loadScenariosFromSupabase,
  readFileAsJSON,
};
