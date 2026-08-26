/**
 * theme.js — light/dark toggle, shared by index.html and admin.html.
 * The pre-paint inline <script> in each page's <head> applies the saved
 * theme before first render (to avoid a flash of the wrong theme); this
 * file only wires the toggle button + footer year once the DOM is ready.
 */
(function () {
  "use strict";

  const THEME_STORAGE_KEY = "legal_ai_theme_v1";

  function currentTheme() {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyThemeToggleLabel() {
    const btn = document.getElementById("theme-toggle-btn");
    if (!btn) return;
    const isDark = currentTheme() === "dark";
    btn.querySelector(".theme-toggle-icon").textContent = isDark ? "☀️" : "🌙";
    btn.querySelector(".theme-toggle-label").textContent = isDark ? "Light" : "Dark";
    btn.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  }

  function wireThemeToggle() {
    const btn = document.getElementById("theme-toggle-btn");
    if (!btn) return;
    applyThemeToggleLabel();
    btn.addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch (e) {
        console.warn("theme toggle: could not persist preference", e);
      }
      applyThemeToggleLabel();
    });
  }

  function wireFooterYear() {
    const el = document.getElementById("footer-year");
    if (el) el.textContent = new Date().getFullYear();
  }

  document.addEventListener("DOMContentLoaded", () => {
    wireThemeToggle();
    wireFooterYear();
  });

  window.LegalTheme = { THEME_STORAGE_KEY, currentTheme };
})();
