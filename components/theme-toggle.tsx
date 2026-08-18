"use client";

const THEME_STORAGE_KEY = "diffguard-theme";

export function ThemeToggle() {
  function toggleTheme() {
    const root = document.documentElement;
    const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme;
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }

  return (
    <button
      className="themeToggle"
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle light and dark mode"
      title="Toggle light and dark mode"
    >
      <span className="themeToggleIcon" aria-hidden="true">
        <span className="moonIcon">☾</span>
        <span className="sunIcon">☀</span>
      </span>
      <span className="themeToggleLabel" aria-hidden="true">
        <span className="darkLabel">Dark</span>
        <span className="lightLabel">Light</span>
      </span>
    </button>
  );
}
