/**
 * pdf_report.js — renders a lawyer_validation export payload (the exact
 * object exporter.buildExportPayload produces) as a paginated PDF, using
 * jsPDF. Entirely derived from data already held in memory / already
 * fetched from Supabase — never a separately stored PDF file — so this
 * is always regenerable and stays in sync with the canonical JSON.
 */
(function () {
  "use strict";

  const PAGE_W = 210; // A4 mm
  const PAGE_H = 297;
  const MARGIN = 18;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const LINE_H = 5.2;

  // jsPDF's built-in Helvetica/Times/Courier are the standard 14 PDF fonts
  // (WinAnsi/Latin-1 only) and have no glyph for the Indian Rupee sign
  // (U+20B9) — confirmed the same limitation earlier this session with
  // ReportLab's base Helvetica. Substituting a plain-ASCII "Rs." avoids a
  // missing-glyph box without embedding a custom Unicode font just for
  // this one symbol.
  function sanitizeText(text) {
    return String(text == null ? "" : text).replace(/₹/g, "Rs. ");
  }

  const CORRECTNESS_LABELS = { 1: "Completely Incorrect", 2: "Mostly Incorrect", 3: "Partially Correct", 4: "Mostly Correct", 5: "Fully Correct" };
  const CONFIDENCE_LABELS = { 1: "Very Low", 2: "Low", 3: "Moderate", 4: "High", 5: "Very High" };

  function newCursor() {
    return { y: MARGIN };
  }

  function ensureSpace(doc, cursor, needed) {
    if (cursor.y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      cursor.y = MARGIN;
    }
  }

  function writeHeading(doc, cursor, text, size) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(sanitizeText(text), CONTENT_W);
    ensureSpace(doc, cursor, lines.length * (size * 0.5) + 2);
    doc.text(lines, MARGIN, cursor.y);
    cursor.y += lines.length * (size * 0.5) + 2;
  }

  function writeLabelValue(doc, cursor, label, value, opts) {
    opts = opts || {};
    doc.setFontSize(10);
    const labelText = sanitizeText(label) + ": ";
    doc.setFont("helvetica", "bold");
    const labelW = doc.getTextWidth(labelText);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    const valueLines = doc.splitTextToSize(sanitizeText(value == null || value === "" ? "-" : value), CONTENT_W - labelW);
    ensureSpace(doc, cursor, valueLines.length * LINE_H + 1);
    doc.setFont("helvetica", "bold");
    doc.text(labelText, MARGIN, cursor.y);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.text(valueLines, MARGIN + labelW, cursor.y);
    cursor.y += valueLines.length * LINE_H + 1;
  }

  function writeParagraph(doc, cursor, text, opts) {
    opts = opts || {};
    doc.setFont("helvetica", opts.italic ? "italic" : "normal");
    doc.setFontSize(opts.size || 10);
    const lines = doc.splitTextToSize(sanitizeText(text), CONTENT_W - (opts.indent || 0));
    for (const line of lines) {
      ensureSpace(doc, cursor, LINE_H);
      doc.text(line, MARGIN + (opts.indent || 0), cursor.y);
      cursor.y += LINE_H;
    }
  }

  function writeRule(doc, cursor) {
    ensureSpace(doc, cursor, 4);
    doc.setDrawColor(200, 200, 200);
    doc.line(MARGIN, cursor.y, PAGE_W - MARGIN, cursor.y);
    cursor.y += 4;
  }

  function writeChips(doc, cursor, items, indent) {
    if (!items || items.length === 0) {
      writeParagraph(doc, cursor, "(none)", { italic: true, indent });
      return;
    }
    writeParagraph(doc, cursor, items.join("   |   "), { indent });
  }

  function buildSubmissionPdf(payload) {
    const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    const cursor = newCursor();

    writeHeading(doc, cursor, "NyaySahayak — Lawyer Validation Report", 16);
    writeParagraph(doc, cursor, payload.study.name + " (v" + payload.study.version + ")", { italic: true });
    cursor.y += 2;

    writeLabelValue(doc, cursor, "Reviewer", payload.reviewer.name);
    writeLabelValue(doc, cursor, "Email", payload.reviewer.email);
    writeLabelValue(doc, cursor, "Experience", payload.reviewer.experience);
    writeLabelValue(doc, cursor, "Practice Areas", (payload.reviewer.practice_areas || []).join(", "));
    writeLabelValue(doc, cursor, "Started", payload.session.started_at);
    writeLabelValue(doc, cursor, "Submitted", payload.session.submitted_at);
    writeLabelValue(doc, cursor, "Duration", Math.round((payload.session.duration_seconds || 0) / 60) + " min");
    cursor.y += 2;
    writeRule(doc, cursor);

    for (const resp of payload.responses) {
      cursor.y += 2;
      ensureSpace(doc, cursor, 14);
      writeHeading(doc, cursor, "Scenario " + resp.scenario_index, 13);
      writeParagraph(doc, cursor, resp.question, { size: 10 });
      cursor.y += 1;

      for (const actName of Object.keys(resp.system_answers)) {
        const sysAct = resp.system_answers[actName];
        const review = resp.lawyer_validation.act_reviews[actName] || {};
        ensureSpace(doc, cursor, 10);
        writeHeading(doc, cursor, actName, 11);

        writeChips(doc, cursor, sysAct.extracted_sections, 2);

        if (review.no_answer_assessment !== undefined) {
          writeLabelValue(doc, cursor, "  System found no applicable provision — lawyer assessment", review.no_answer_assessment);
        } else {
          writeLabelValue(doc, cursor, "  Act applicability (lawyer)", review.applicability);
          const sections = review.sections || {};
          const sectionKeys = Object.keys(sections);
          if (sectionKeys.length > 0) {
            const sectionSummary = sectionKeys.map((s) => s + ": " + sections[s]).join("   |   ");
            writeParagraph(doc, cursor, sectionSummary, { indent: 2 });
          }
        }
        cursor.y += 1;
      }

      const lv = resp.lawyer_validation;
      if (lv.missing_provisions && lv.missing_provisions.length > 0) {
        writeLabelValue(
          doc,
          cursor,
          "Missing provisions flagged",
          lv.missing_provisions.map((p) => p.act + " — " + p.section).join("; ")
        );
      }
      if (lv.irrelevant_provisions && lv.irrelevant_provisions.length > 0) {
        writeLabelValue(
          doc,
          cursor,
          "Irrelevant provisions flagged",
          lv.irrelevant_provisions.map((p) => p.act + " — " + p.section).join("; ")
        );
      }
      writeLabelValue(doc, cursor, "Overall correctness", CORRECTNESS_LABELS[lv.overall_correctness] || "-");
      writeLabelValue(doc, cursor, "Confidence", CONFIDENCE_LABELS[lv.confidence] || "-");
      writeLabelValue(doc, cursor, "Factual sufficiency", lv.factual_sufficiency);
      writeLabelValue(doc, cursor, "Multiple interpretations possible", lv.multiple_interpretations);
      if (lv.ambiguity_comment) writeLabelValue(doc, cursor, "Ambiguity note", lv.ambiguity_comment);
      if (lv.comments) writeLabelValue(doc, cursor, "Comments", lv.comments);

      cursor.y += 2;
      writeRule(doc, cursor);
    }

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(140, 140, 140);
      doc.text("NyaySahayak Expert Validation — Page " + i + " of " + pageCount, MARGIN, PAGE_H - 10);
      doc.setTextColor(0, 0, 0);
    }

    return doc;
  }

  function downloadSubmissionPdf(payload, filename) {
    const doc = buildSubmissionPdf(payload);
    doc.save(filename);
  }

  window.LegalPdfReport = { buildSubmissionPdf, downloadSubmissionPdf };
})();
