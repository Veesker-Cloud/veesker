function loadTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const raw = localStorage.getItem("veesker_theme");
    if (raw === "dark" || raw === "light") return raw;
  } catch { /* restricted environment */ }
  return "light";
}

let _theme = $state<"light" | "dark">(loadTheme());

export const theme = {
  get current() { return _theme; },
  toggle() {
    _theme = _theme === "light" ? "dark" : "light";
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("veesker_theme", _theme);
      }
    } catch { /* restricted environment */ }
  },
  reset() {
    _theme = "light";
    try {
      if (typeof window !== "undefined") localStorage.removeItem("veesker_theme");
    } catch { /* restricted environment */ }
  },
};
