/**
 * Optional remote-storage configuration (Supabase).
 *
 * To enable: copy this file to `js/remote_config.js` (which is gitignored
 * — never commit real credentials) and fill in your project's URL and
 * ANON key. Use ONLY the public anon key from Supabase Project Settings ->
 * API. NEVER put a service-role secret here — this file ships to every
 * visitor's browser. Admin access is protected separately by Supabase
 * Auth (see admin.html / README.md "Admin & centralized storage"), not
 * by this file.
 *
 * Leaving `js/remote_config.js` absent, or `enabled: false`, is completely
 * fine — the app works fully offline with localStorage + local JSON/PDF
 * download only, which is the default. With it enabled, three things
 * change: (1) submissions save centrally instead of only downloading
 * locally, (2) scenario data an admin publishes becomes the live source
 * for every lawyer automatically, (3) an in-progress review can resume
 * from a different device via the reviewer's email.
 */
window.REMOTE_SUBMIT_CONFIG = {
  enabled: false,
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-PUBLIC-ANON-KEY",

  // Table names — match supabase/schema.sql; only change these if you
  // renamed the tables there too.
  submissionsTable: "lawyer_validations",
  scenariosTable: "scenarios",
  sessionsTable: "review_sessions",
};
