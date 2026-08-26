/**
 * storage.js — state schema, localStorage persistence, and pure state
 * query/mutation helpers. No DOM access.
 */

const STORAGE_KEY = "legal_ai_lawyer_validation_v1";
const SCHEMA_VERSION = 1;

const EXPERIENCE_OPTIONS = ["Less than 2 years", "2-5 years", "5-10 years", "10-15 years", "More than 15 years"];
const PRACTICE_AREA_OPTIONS = [
  "Criminal Law",
  "Cyber Law",
  "Evidence Law",
  "Data Protection / Privacy",
  "Technology Law",
  "Civil Litigation",
  "Corporate / Commercial Law",
  "Other",
];

function nowISO() {
  return new Date().toISOString();
}

function createInitialState() {
  return {
    schema_version: SCHEMA_VERSION,
    session: { started_at: null, last_saved_at: null },
    reviewer: {
      entry_completed: false,
      name: "",
      email: "",
      experience: "",
      practice_areas: [],
    },
    scenario_source: {
      loaded: false,
      origin: null,
      scenario_count: 0,
      models_seen: [],
      index_range: [null, null],
    },
    scenarios: [],
    current_scenario_pos: 0,
    progress: {},
    submitted_at: null,
  };
}

function createActReview() {
  return {
    applicability: null,
    sections: {},
    no_answer_assessment: null,
    missing_flag: null,
    irrelevant_flag: null,
    irrelevant_sections_checked: [],
  };
}

function createScenarioProgress(actNames) {
  const act_reviews = {};
  for (const act of actNames) act_reviews[act] = createActReview();
  return {
    completed: false,
    lawyer_validation: {
      act_reviews,
      missing_provisions: [],
      irrelevant_provisions: [],
      overall_correctness: null,
      confidence: null,
      factual_sufficiency: null,
      multiple_interpretations: null,
      ambiguity_comment: "",
      comments: "",
    },
  };
}

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.schema_version !== SCHEMA_VERSION) {
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn("storage.loadState: could not read/parse saved state", e);
    return null;
  }
}

let _saveTimer = null;
function saveState(state) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      state.session.last_saved_at = nowISO();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("storage.saveState: could not persist state (quota or serialization error)", e);
    }
  }, 300);
}

// Immediate, non-debounced save — used right before navigating away or
// right after submit, where a pending debounce could otherwise be lost.
function saveStateNow(state) {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  try {
    state.session.last_saved_at = nowISO();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("storage.saveStateNow: could not persist state", e);
  }
}

function clearState() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn("storage.clearState: could not clear saved state", e);
  }
}

function getScenarioProgress(state, scenarioIndex) {
  return state.progress[String(scenarioIndex)] || null;
}

// Immutable-style patch: patchFn receives the current lawyer_validation
// object for this scenario and mutates it in place (simpler than forcing
// a full clone through every call site); the containing state object
// reference stays the same, only nested content changes.
function patchScenarioProgress(state, scenarioIndex, actNames, patchFn) {
  const key = String(scenarioIndex);
  if (!state.progress[key]) {
    state.progress[key] = createScenarioProgress(actNames);
  }
  patchFn(state.progress[key].lawyer_validation, state.progress[key]);
  state.progress[key].completed = isScenarioComplete(state, scenarioIndex);
  return state.progress[key];
}

function isScenarioComplete(state, scenarioIndex) {
  const scenario = state.scenarios.find((s) => s.scenario_index === scenarioIndex);
  const entry = state.progress[String(scenarioIndex)];
  if (!scenario || !entry) return false;
  const lv = entry.lawyer_validation;

  for (const actName of Object.keys(scenario.answers)) {
    const parsed = scenario._parsed[actName];
    const review = lv.act_reviews[actName];
    if (!review) return false;

    if (parsed.is_no_answer) {
      // No-answer Acts only ever show the "is that assessment correct?"
      // question (see app.js renderNoAnswerBody) — missing_flag/
      // irrelevant_flag have no corresponding UI for these Acts, so they
      // must not be required here.
      if (review.no_answer_assessment === null) return false;
      if (review.no_answer_assessment === "no") {
        const hasDetail = lv.missing_provisions.some((p) => p.act === actName);
        if (!hasDetail) return false;
      }
      continue;
    }

    if (review.applicability === null) return false;
    for (const section of parsed.extracted_sections) {
      if (!review.sections[section]) return false;
    }

    if (review.missing_flag === null) return false;
    if (review.missing_flag === "yes") {
      const hasDetail = lv.missing_provisions.some((p) => p.act === actName);
      if (!hasDetail) return false;
    }

    if (review.irrelevant_flag === null) return false;
    if (review.irrelevant_flag === "yes" && review.irrelevant_sections_checked.length === 0) {
      return false;
    }
  }

  if (lv.overall_correctness === null) return false;
  if (lv.confidence === null) return false;
  if (lv.factual_sufficiency === null) return false;

  return true;
}

function getCompletionSummary(state) {
  const total = state.scenarios.length;
  let completedCount = 0;
  for (const s of state.scenarios) {
    if (isScenarioComplete(state, s.scenario_index)) completedCount++;
  }
  return { completedCount, total };
}

window.LegalStorage = {
  STORAGE_KEY,
  SCHEMA_VERSION,
  EXPERIENCE_OPTIONS,
  PRACTICE_AREA_OPTIONS,
  createInitialState,
  createActReview,
  createScenarioProgress,
  loadState,
  saveState,
  saveStateNow,
  clearState,
  getScenarioProgress,
  patchScenarioProgress,
  isScenarioComplete,
  getCompletionSummary,
};
