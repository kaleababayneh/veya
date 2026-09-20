/** Shared by the server layout (inline script) and the client theme store; no React in here. */
export const THEME_KEY = "veya-theme";

/** Runs while the HTML is parsed, before first paint: the stored choice, else the system preference. */
export const THEME_BOOT_SCRIPT = `(function(){var t;try{t=localStorage.getItem("${THEME_KEY}")}catch(e){}if(t!=="light"&&t!=="dark"){t=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t})()`;
