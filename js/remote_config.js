/**
 * Real Supabase configuration for this deployment. This file is
 * gitignored (see .gitignore) — it will not be committed, so it's safe to
 * keep real values here. See js/remote_config.example.js for the
 * documented placeholder template.
 */
window.REMOTE_SUBMIT_CONFIG = {
  enabled: true,
  supabaseUrl: "https://yidcyvpbipbqiyrhbmgg.supabase.co",
  supabaseAnonKey: "sb_publishable_8eBas0LgRAEUntpA0lC8-Q_p6uqwISw",

  // Table names — match supabase/schema.sql; only change these if you
  // renamed the tables there too.
  submissionsTable: "lawyer_validations",
  scenariosTable: "scenarios",
  sessionsTable: "review_sessions",
};
