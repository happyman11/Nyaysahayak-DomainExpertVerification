/**
 * supabase_client.js — thin shared wrapper around the Supabase JS SDK.
 * Used by exporter.js (submit), importer.js (load live scenario data),
 * app.js (cross-device resume), and admin.js (auth + dashboard queries).
 *
 * Entirely optional: every function here is a no-op / returns null when
 * window.REMOTE_SUBMIT_CONFIG is absent or {enabled: false} (the default,
 * gitignored js/remote_config.js is what turns this on — see
 * js/remote_config.example.js).
 */
(function () {
  "use strict";

  let _client = null;

  function isConfigured() {
    const c = window.REMOTE_SUBMIT_CONFIG;
    return !!(c && c.enabled === true && c.supabaseUrl && c.supabaseAnonKey);
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (_client) return _client;
    if (!window.supabase || !window.supabase.createClient) {
      console.warn("supabase_client: window.supabase SDK not loaded (js/vendor/supabase.min.js missing?)");
      return null;
    }
    const c = window.REMOTE_SUBMIT_CONFIG;
    _client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
    return _client;
  }

  function tableName(key, fallback) {
    const c = window.REMOTE_SUBMIT_CONFIG || {};
    return c[key] || fallback;
  }

  // ---- lawyer_validations (final, admin-read-only submissions) ----------
  async function insertSubmission(payload) {
    const client = getClient();
    if (!client) return { ok: true, skipped: true };
    const { error } = await client.from(tableName("submissionsTable", "lawyer_validations")).insert({ payload });
    if (error) return { ok: false, error: error.message };
    return { ok: true, skipped: false };
  }

  async function listSubmissions() {
    const client = getClient();
    if (!client) return { ok: false, error: "Remote storage is not configured." };
    const { data, error } = await client
      .from(tableName("submissionsTable", "lawyer_validations"))
      .select("id, payload, created_at")
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, rows: data || [] };
  }

  // ---- scenarios (live scenario data, readable by everyone, writable
  //      only by an authenticated admin per RLS) --------------------------
  async function fetchLiveScenarios() {
    const client = getClient();
    if (!client) return { ok: false, error: "Remote storage is not configured." };
    const { data, error } = await client
      .from(tableName("scenariosTable", "scenarios"))
      .select("scenario_index, data")
      .order("scenario_index", { ascending: true });
    if (error) return { ok: false, error: error.message };
    return { ok: true, scenarios: (data || []).map((row) => row.data) };
  }

  async function publishScenarios(scenarios) {
    const client = getClient();
    if (!client) return { ok: false, error: "Remote storage is not configured." };
    const table = tableName("scenariosTable", "scenarios");
    const del = await client.from(table).delete().gte("scenario_index", 0);
    if (del.error) return { ok: false, error: "Could not clear existing scenarios: " + del.error.message };
    const rows = scenarios.map((s) => ({ scenario_index: s.scenario_index, data: s }));
    const ins = await client.from(table).insert(rows);
    if (ins.error) return { ok: false, error: "Could not publish new scenarios: " + ins.error.message };
    return { ok: true };
  }

  // ---- review_sessions (in-progress autosave, keyed by reviewer email,
  //      for cross-device resume) -----------------------------------------
  async function saveSessionRemote(email, state) {
    const client = getClient();
    if (!client || !email) return { ok: true, skipped: true };
    const { error } = await client
      .from(tableName("sessionsTable", "review_sessions"))
      .upsert({ email: email.trim().toLowerCase(), state, updated_at: new Date().toISOString() }, { onConflict: "email" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function loadSessionRemote(email) {
    const client = getClient();
    if (!client || !email) return { ok: false, error: "Remote storage is not configured." };
    const { data, error } = await client
      .from(tableName("sessionsTable", "review_sessions"))
      .select("state, updated_at")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: true, found: false };
    return { ok: true, found: true, state: data.state, updatedAt: data.updated_at };
  }

  async function deleteSessionRemote(email) {
    const client = getClient();
    if (!client || !email) return { ok: true, skipped: true };
    const { error } = await client
      .from(tableName("sessionsTable", "review_sessions"))
      .delete()
      .eq("email", email.trim().toLowerCase());
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  // ---- admin auth ---------------------------------------------------------
  async function adminSignIn(email, password) {
    const client = getClient();
    if (!client) return { ok: false, error: "Remote storage is not configured." };
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    return { ok: true, session: data.session };
  }

  async function adminSignOut() {
    const client = getClient();
    if (!client) return { ok: true };
    await client.auth.signOut();
    return { ok: true };
  }

  async function getAdminSession() {
    const client = getClient();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session || null;
  }

  window.LegalSupabase = {
    isConfigured,
    getClient,
    insertSubmission,
    listSubmissions,
    fetchLiveScenarios,
    publishScenarios,
    saveSessionRemote,
    loadSessionRemote,
    deleteSessionRemote,
    adminSignIn,
    adminSignOut,
    getAdminSession,
  };
})();
