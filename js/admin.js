/**
 * admin.js — password(Supabase Auth)-gated dashboard: view/download lawyer
 * submissions, publish new live scenario data. Mirrors app.js's one-way
 * calling convention: admin.js -> {supabase_client, importer, exporter,
 * pdf_report}; those modules never touch the DOM.
 */
(function () {
  "use strict";

  const LS = window.LegalSupabase;
  const I = window.LegalImporter;
  const E = window.LegalExporter;

  let pendingScenarioUpload = null;

  document.addEventListener("DOMContentLoaded", boot);

  async function boot() {
    if (!LS || !LS.isConfigured()) {
      showScreen("admin-not-configured");
      return;
    }

    wireLoginForm();
    wireDashboard();

    const session = await LS.getAdminSession();
    if (session) {
      await enterDashboard(session);
    } else {
      showScreen("admin-login");
    }
  }

  function showScreen(name) {
    document.querySelectorAll("[data-screen]").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-screen") === name);
    });
  }

  function wireLoginForm() {
    const form = document.getElementById("admin-login-form");
    const errorEl = document.getElementById("admin-login-error");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.classList.add("hidden");
      const email = document.getElementById("admin-email").value.trim();
      const password = document.getElementById("admin-password").value;
      const btn = document.getElementById("admin-login-btn");
      btn.disabled = true;
      btn.textContent = "Signing in…";
      const result = await LS.adminSignIn(email, password);
      btn.disabled = false;
      btn.textContent = "Sign In";
      if (!result.ok) {
        errorEl.textContent = result.error;
        errorEl.classList.remove("hidden");
        return;
      }
      await enterDashboard(result.session);
    });
  }

  async function enterDashboard(session) {
    document.getElementById("admin-whoami").textContent = session.user.email;
    showScreen("admin-dashboard");
    await Promise.all([loadSubmissions(), loadLiveScenarioStatus()]);
  }

  function wireDashboard() {
    document.getElementById("admin-signout-btn").addEventListener("click", async () => {
      await LS.adminSignOut();
      showScreen("admin-login");
    });

    document.getElementById("admin-refresh-submissions-btn").addEventListener("click", loadSubmissions);
    document.getElementById("admin-download-all-json-btn").addEventListener("click", downloadAllSubmissionsJson);
    document.getElementById("admin-download-all-csv-btn").addEventListener("click", downloadAllSubmissionsCsv);

    wireScenarioDropzone();
    document.getElementById("admin-scenario-publish-btn").addEventListener("click", publishScenarioUpload);
    document.getElementById("admin-download-pdfs-zip-btn").addEventListener("click", downloadAllScenarioPdfsZip);
  }

  // ---------------------------------------------------------------------
  // Bulk PDF download — zips up every scenario's original system-generated
  // PDFs (data/scenario_pdfs/), preserving the same "Scenario N/filename"
  // folder structure as the original V6.5 extraction output.
  // ---------------------------------------------------------------------
  async function downloadAllScenarioPdfsZip() {
    const statusEl = document.getElementById("admin-pdfs-zip-status");
    const btn = document.getElementById("admin-download-pdfs-zip-btn");
    btn.disabled = true;
    statusEl.textContent = "Loading manifest…";

    let manifest;
    try {
      const res = await fetch("data/scenario_pdfs/manifest.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      manifest = await res.json();
    } catch (e) {
      statusEl.textContent = "Could not load data/scenario_pdfs/manifest.json: " + e.message;
      btn.disabled = false;
      return;
    }

    const zip = new window.JSZip();
    const total = manifest.scenario_indexes.length * manifest.files.length;
    let done = 0;
    let missing = 0;

    for (const scenarioIndex of manifest.scenario_indexes) {
      const folder = zip.folder(manifest.zip_folder_prefix + scenarioIndex);
      for (const filename of manifest.files) {
        const url = `data/scenario_pdfs/${manifest.folder_prefix}${scenarioIndex}/${filename}`;
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error("HTTP " + res.status);
          const blob = await res.blob();
          folder.file(filename, blob);
        } catch (e) {
          missing++;
          console.warn("skipping missing PDF:", url, e.message);
        }
        done++;
        statusEl.textContent = `Collecting PDFs… (${done} / ${total})`;
      }
    }

    statusEl.textContent = "Compressing…";
    const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    E.downloadBlob(zipBlob, "scenario_pdfs_" + new Date().toISOString().slice(0, 10) + ".zip");

    statusEl.textContent = `Done — ${done - missing} of ${total} files included` + (missing > 0 ? ` (${missing} missing, skipped).` : ".");
    btn.disabled = false;
  }

  // ---------------------------------------------------------------------
  // Submissions
  // ---------------------------------------------------------------------
  let _submissionsCache = [];

  async function loadSubmissions() {
    const statusEl = document.getElementById("admin-submissions-status");
    statusEl.textContent = "Loading…";
    const result = await LS.listSubmissions();
    if (!result.ok) {
      statusEl.textContent = "Could not load submissions: " + result.error;
      return;
    }
    _submissionsCache = result.rows;
    statusEl.textContent = result.rows.length + " submission" + (result.rows.length === 1 ? "" : "s") + " total.";
    renderSubmissionsTable(result.rows);
  }

  function scenariosRatedCount(payload) {
    const responses = payload.responses || [];
    const rated = responses.filter((r) => r.lawyer_validation && r.lawyer_validation.overall_correctness !== null).length;
    return rated + " / " + responses.length;
  }

  function renderSubmissionsTable(rows) {
    const body = document.getElementById("admin-submissions-body");
    if (rows.length === 0) {
      body.innerHTML = '<tr><td colspan="7" class="muted">No submissions yet.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map((row, i) => {
        const p = row.payload;
        const durationMin = Math.round((p.session.duration_seconds || 0) / 60);
        return `<tr>
          <td>${escapeHtml(p.reviewer.name)}</td>
          <td>${escapeHtml(p.reviewer.email)}</td>
          <td>${escapeHtml(p.reviewer.experience)}</td>
          <td>${escapeHtml(scenariosRatedCount(p))}</td>
          <td>${escapeHtml(formatDate(p.session.submitted_at))}</td>
          <td>${durationMin} min</td>
          <td style="white-space:nowrap;">
            <button type="button" class="btn-text" data-row-action="json" data-row-index="${i}">JSON</button>
            <button type="button" class="btn-text" data-row-action="pdf" data-row-index="${i}">PDF</button>
          </td>
        </tr>`;
      })
      .join("");

    body.querySelectorAll("[data-row-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = _submissionsCache[Number(btn.getAttribute("data-row-index"))];
        const filename = E.buildFilename(row.payload.reviewer.name, new Date(row.payload.session.submitted_at));
        if (btn.getAttribute("data-row-action") === "json") {
          E.downloadJSON(row.payload, filename);
        } else {
          window.LegalPdfReport.downloadSubmissionPdf(row.payload, filename.replace(/\.json$/, ".pdf"));
        }
      });
    });
  }

  function downloadAllSubmissionsJson() {
    if (_submissionsCache.length === 0) {
      showToast("No submissions to download yet.");
      return;
    }
    const merged = _submissionsCache.map((row) => row.payload);
    E.downloadJSON(merged, "all_lawyer_validations_" + new Date().toISOString().slice(0, 10) + ".json");
  }

  function downloadAllSubmissionsCsv() {
    if (_submissionsCache.length === 0) {
      showToast("No submissions to download yet.");
      return;
    }
    const merged = _submissionsCache.map((row) => row.payload);
    E.downloadCsv(merged, "all_lawyer_validations_" + new Date().toISOString().slice(0, 10) + ".csv");
  }

  // ---------------------------------------------------------------------
  // Scenario data
  // ---------------------------------------------------------------------
  async function loadLiveScenarioStatus() {
    const el = document.getElementById("admin-live-status");
    el.textContent = "Loading live scenario status…";
    const result = await LS.fetchLiveScenarios();
    if (!result.ok) {
      el.textContent = "Could not load live scenario status: " + result.error;
      return;
    }
    if (result.scenarios.length === 0) {
      el.textContent = "No scenarios published yet — lawyers currently fall back to the bundled data/sample_results.json (or the manual-import screen if that's also missing).";
      return;
    }
    const summary = I.summarizeScenarios(result.scenarios);
    el.textContent = `Currently live: ${summary.count} scenarios (indexes ${summary.indexRange[0]}–${summary.indexRange[1]}, model${summary.modelsSeen.length === 1 ? "" : "s"}: ${summary.modelsSeen.join(", ") || "unknown"}).`;
  }

  function wireScenarioDropzone() {
    const dropzone = document.getElementById("admin-scenario-dropzone");
    const input = document.getElementById("admin-scenario-file-input");
    const chooseBtn = document.getElementById("admin-scenario-choose-btn");

    chooseBtn.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      if (input.files && input.files.length) handleScenarioFiles(Array.from(input.files));
      input.value = "";
    });
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files.length) handleScenarioFiles(Array.from(e.dataTransfer.files));
    });
  }

  async function handleScenarioFiles(files) {
    const rawInputs = [];
    const readErrors = [];
    for (const file of files) {
      try {
        rawInputs.push({ filename: file.name, parsedJson: await I.readFileAsJSON(file) });
      } catch (e) {
        readErrors.push(e.message);
      }
    }
    const { scenarios, warnings, errors } = I.mergeScenarioSources(rawInputs);
    const allErrors = readErrors.concat(errors);

    const errorsEl = document.getElementById("admin-scenario-errors");
    const warningsEl = document.getElementById("admin-scenario-warnings");
    const summaryEl = document.getElementById("admin-scenario-summary");
    const publishBtn = document.getElementById("admin-scenario-publish-btn");

    errorsEl.classList.toggle("hidden", allErrors.length === 0);
    errorsEl.innerHTML = allErrors.length ? `<ul>${allErrors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>` : "";
    warningsEl.classList.toggle("hidden", warnings.length === 0);
    warningsEl.innerHTML = warnings.length ? `<ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>` : "";

    if (scenarios.length > 0) {
      pendingScenarioUpload = scenarios;
      const summary = I.summarizeScenarios(scenarios);
      summaryEl.classList.remove("hidden");
      summaryEl.innerHTML = `<strong>${summary.count} scenario${summary.count === 1 ? "" : "s"} ready to publish</strong> (indexes ${summary.indexRange[0]}–${summary.indexRange[1]})`;
      publishBtn.classList.remove("hidden");
    } else {
      pendingScenarioUpload = null;
      summaryEl.classList.add("hidden");
      publishBtn.classList.add("hidden");
    }
  }

  async function publishScenarioUpload() {
    if (!pendingScenarioUpload) return;
    const statusEl = document.getElementById("admin-scenario-publish-status");
    const confirmed = window.confirm(
      `Publish ${pendingScenarioUpload.length} scenarios? This REPLACES the entire current live scenario set for every lawyer.`
    );
    if (!confirmed) return;
    statusEl.textContent = "Publishing…";
    const result = await LS.publishScenarios(pendingScenarioUpload.map(stripParsedCache));
    if (!result.ok) {
      statusEl.textContent = "Publish failed: " + result.error;
      return;
    }
    statusEl.textContent = "Published successfully.";
    pendingScenarioUpload = null;
    document.getElementById("admin-scenario-publish-btn").classList.add("hidden");
    document.getElementById("admin-scenario-summary").classList.add("hidden");
    await loadLiveScenarioStatus();
  }

  function stripParsedCache(scenario) {
    const clone = Object.assign({}, scenario);
    delete clone._parsed;
    return clone;
  }

  // ---------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------
  function formatDate(iso) {
    if (!iso) return "-";
    return new Date(iso).toLocaleString();
  }
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  let toastTimer = null;
  function showToast(message) {
    const el = document.getElementById("error-toast");
    el.textContent = message;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 4000);
  }
})();
