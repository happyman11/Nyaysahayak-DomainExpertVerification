/**
 * parser.js — extracts structured section citations from AI-generated
 * per-Act markdown answers. Pure functions, no DOM, no state. Validated
 * against all 15 real Scenario N/data.json files (60 per-Act answers)
 * before this file was written — see README.md "Parser design notes".
 */

const NO_ANSWER_TRIGGERS = [
  "unable to answer",
  "outside my knowledge base",
  "not applicable",
  "none applicable",
  "no applicable sections",
];
const NO_ANSWER_MAX_LEN = 200;

/**
 * A short answer is treated as a full-Act refusal if it contains any
 * trigger phrase. The length gate is required: "not applicable" and
 * "no applicable sections" are real substrings of legitimate long
 * analysis prose (e.g. "...but Section 43 is not applicable here since
 * ..."), confirmed against the real corpus. Gating the broad triggers to
 * short answers only (<=200 chars, generous margin over the confirmed
 * 71-char literal refusal string) makes them safe: they can only flip a
 * whole short answer, never a clause inside a long substantive one.
 */
function isNoAnswer(text) {
  const t = (text || "").trim();
  if (t.length === 0) return true;
  if (t.length > NO_ANSWER_MAX_LEN) return false;
  const lower = t.toLowerCase();
  return NO_ANSWER_TRIGGERS.some((trigger) => lower.includes(trigger));
}

// Matches a numbered heading in any of the 3 real styles found in the
// corpus: "1. **Title**", "### 1. **Title**", and "### **1. Title**"
// (qwen3:30b sometimes wraps the number itself inside the bold markers).
// Also matches an unnumbered hash heading ("### **Summary**") as a second
// alternative, so a trailing unnumbered section still closes a preceding
// block's boundary correctly. Anchored on either a leading "#" or a
// leading digit+"." so it never matches ordinary prose lines.
const HEADING_RE =
  /^[ \t]*(?:#{1,3}[ \t]*)?\*{0,2}[ \t]*(\d{1,2})[.)][ \t]*\*{0,2}[ \t]*(.+?)[ \t]*\*{0,2}[ \t]*:?[ \t]*$|^[ \t]*#{1,3}[ \t]*\*{0,2}[ \t]*(.+?)[ \t]*\*{0,2}[ \t]*:?[ \t]*$/gm;

const FIRST_HEADING_SYNONYM_RE = /^(Applicable Sections|Applicable Provisions|Relevant Sections)\b/i;

function findHeadings(text) {
  const heads = [];
  HEADING_RE.lastIndex = 0;
  let m;
  while ((m = HEADING_RE.exec(text)) !== null) {
    const title = (m[2] !== undefined ? m[2] : m[3]).trim();
    heads.push({ start: m.index, end: m.index + m[0].length, title });
    if (m[0].length === 0) HEADING_RE.lastIndex++; // guard against zero-width matches
  }
  return heads;
}

/**
 * Bounds the search text to the "Applicable Sections" block (from just
 * after that heading to just before the next heading), or falls back to
 * the entire answer text if no such heading is found.
 */
function boundApplicableSectionsText(answerText) {
  const heads = findHeadings(answerText);
  const idx = heads.findIndex((h) => FIRST_HEADING_SYNONYM_RE.test(h.title));
  if (idx === -1) {
    return { text: answerText, source: "full_answer_fallback" };
  }
  const start = heads[idx].end;
  const end = idx + 1 < heads.length ? heads[idx + 1].start : answerText.length;
  return { text: answerText.slice(start, end), source: "applicable_sections_block" };
}

// The negative lookbehinds exclude "sub-section(s)"/"sub section(s)" from
// anchoring a fresh citation — confirmed against the real corpus (e.g.
// "Section 375: ... (specifically sub-sections 1 and 2)"), where this
// cross-reference back to the subclauses of the section just named must
// not be misread as two new bare citations "Section 1"/"Section 2".
// "subsections" with no separator never matches \bSections?\b in the
// first place, since there's no word-boundary between "sub" and
// "sections" there.
const KEYWORD_RE = /\b(?<!sub-)(?<!sub )Sections?\b[ \t]*:?[ \t]*/gi;
const NUMBER_TOKEN_RE = /^\d{1,4}[A-Za-z]{0,2}/;
// Subclause content is restricted to short digit/letter tokens — this is
// what rejects descriptive parentheticals like "(read with IT Rules 2004)".
const SUBCLAUSE_TOKEN_RE = /^\(\s*([0-9]{1,3}|[A-Za-z]{1,3})\s*\)/;
const JOIN_TOKEN_RE = /^[ \t]*(?:,[ \t]*(?:and[ \t]+)?|and[ \t]+|\/|&)[ \t]*/i;

/**
 * Tokenizes every "Section N(...)..." citation in `text`. Handles sibling
 * lists ("Sections 66C/66D", "Sections 376 and 377") and compound trailing
 * clauses that share a parent ("Section 28(1)(i) and (ii)",
 * "Section 10(2) and (3)") by replacing the trailing K levels of the
 * previous node with the new bare subclause levels found after the join.
 * A join is only ever consumed if what follows it is a full citation or a
 * bare subclause run — otherwise the loop stops without consuming it,
 * which is what prevents "Section 66C and the Cyber Cell..." from
 * over-consuming into prose.
 */
function tokenizeCitations(text) {
  const nodes = [];
  KEYWORD_RE.lastIndex = 0;
  let km;
  while ((km = KEYWORD_RE.exec(text)) !== null) {
    let pos = km.index + km[0].length;
    const m = NUMBER_TOKEN_RE.exec(text.slice(pos));
    if (!m) continue;
    const base = m[0];
    pos += m[0].length;
    const levels = [];
    let sc;
    while ((sc = SUBCLAUSE_TOKEN_RE.exec(text.slice(pos))) !== null) {
      levels.push(sc[1]);
      pos += sc[0].length;
    }
    nodes.push({ base, levels });

    // Trailing-join loop: consume as many sibling/compound continuations
    // as actually follow, then stop.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const jm = JOIN_TOKEN_RE.exec(text.slice(pos));
      if (!jm) break;
      const after = text.slice(pos + jm[0].length);
      const nm = NUMBER_TOKEN_RE.exec(after);
      if (nm) {
        const base2 = nm[0];
        let p3 = pos + jm[0].length + nm[0].length;
        const levels2 = [];
        let sc2;
        while ((sc2 = SUBCLAUSE_TOKEN_RE.exec(text.slice(p3))) !== null) {
          levels2.push(sc2[1]);
          p3 += sc2[0].length;
        }
        nodes.push({ base: base2, levels: levels2 });
        pos = p3;
        continue;
      }
      const bareLevels = [];
      let probe = after;
      let consumed = 0;
      let sc3;
      while ((sc3 = SUBCLAUSE_TOKEN_RE.exec(probe)) !== null) {
        bareLevels.push(sc3[1]);
        consumed += sc3[0].length;
        probe = probe.slice(sc3[0].length);
      }
      if (bareLevels.length > 0) {
        const prev = nodes[nodes.length - 1];
        const k = bareLevels.length;
        const newLevels = prev.levels.slice(0, Math.max(0, prev.levels.length - k)).concat(bareLevels);
        nodes.push({ base: prev.base, levels: newLevels });
        pos = pos + jm[0].length + consumed;
        continue;
      }
      break;
    }
  }
  return nodes;
}

// Uppercases only the base's trailing letter suffix ("66c" -> "66C").
// Clause-level labels inside parens are left exactly as captured — roman
// numerals/letters are conventionally lowercase in Indian legal drafting.
function renderNode(node) {
  const base = node.base.replace(/[a-z]+$/i, (m) => m.toUpperCase());
  if (node.levels.length === 0) return `Section ${base}`;
  return `Section ${base}` + node.levels.map((l) => `(${l})`).join("");
}

const TRAILING_CROSS_STATUTE_RE = /^[ \t]*(IPC|Cr\.?P\.?C\.?|CPC)\b/i;

/**
 * Extracts a deduped, order-preserving list of "Section N..." citation
 * strings from a single Act's raw markdown answer.
 */
function extractSections(answerText) {
  const { text, source } = boundApplicableSectionsText(answerText || "");
  let nodes = tokenizeCitations(text);

  if (source === "full_answer_fallback") {
    // Documented residual risk of the unbounded fallback path: cross-
    // statute references narratively mentioned in prose (e.g. "Section 402
    // IPC"). Cheap mitigation — drop a citation immediately followed by a
    // cross-statute abbreviation.
    nodes = nodes.filter((node) => !isFollowedByCrossStatute(text, node));
  }

  const seen = new Set();
  const sections = [];
  for (const node of nodes) {
    const r = renderNode(node);
    if (!seen.has(r)) {
      seen.add(r);
      sections.push(r);
    }
  }

  return { sections, source };
}

// Finds where this node's citation actually occurs in `text` (by matching
// "Section(s) <base>..." with the same anchor used during tokenization)
// and checks whether a cross-statute abbreviation immediately follows it.
function isFollowedByCrossStatute(text, node) {
  const escapedBase = node.base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("\\bSections?\\b[ \\t]*:?[ \\t]*" + escapedBase, "i");
  const m = pattern.exec(text);
  if (!m) return false;
  const after = text.slice(m.index + m[0].length);
  return TRAILING_CROSS_STATUTE_RE.test(after);
}

/**
 * Composes isNoAnswer + extractSections into the single entry point
 * app.js/importer.js call once per Act, per scenario, at load time.
 */
function parseActAnswer(answerText) {
  if (isNoAnswer(answerText)) {
    return { isNoAnswer: true, extractedSections: [], extractionSource: null };
  }
  const { sections, source } = extractSections(answerText);
  return { isNoAnswer: false, extractedSections: sections, extractionSource: source };
}

// Exposed as a plain global (no build step / bundler in this project).
window.LegalParser = { isNoAnswer, extractSections, parseActAnswer };
