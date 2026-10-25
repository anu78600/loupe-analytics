/**
 * Puts a chart theme on the page. One <style id="loupe-chart-theme"> holds
 * themeCss(), and data-chart-theme on <html> names the theme; its value
 * changes with every colour, which is what tells charts to redraw
 * (useChartThemeKey). The CSS is also kept in localStorage, so
 * chartThemeBootScript restores it before the first paint, with no flash
 * of the default colours. The built-in palette removes all three.
 *
 * Called by ChartThemeSync (ui/common/providers) whenever the setting
 * changes, or the chart-colours panel previews a choice on the page
 * (`persist` false: the page shows it, but nothing is stored, so a reload
 * brings back the colours in use); nothing else writes these.
 */
import { themeCss, type ResolvedTheme } from "./themes";

export const CHART_THEME_STORAGE_KEY = "loupe-chart-theme";
const STYLE_ID = "loupe-chart-theme";

export function applyChartTheme(theme: ResolvedTheme, persist = true): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const existing = document.getElementById(STYLE_ID);
  if (theme.builtIn) {
    existing?.remove();
    delete root.dataset.chartTheme;
    if (!persist) return;
    try {
      localStorage.removeItem(CHART_THEME_STORAGE_KEY);
    } catch {
      /* storage can be unavailable (private mode); the theme still applies for this view */
    }
    return;
  }
  const css = themeCss(theme);
  let el = existing instanceof HTMLStyleElement ? existing : null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
  root.dataset.chartTheme = theme.key;
  if (!persist) return;
  try {
    localStorage.setItem(CHART_THEME_STORAGE_KEY, JSON.stringify({ key: theme.key, css }));
  } catch {
    /* as above */
  }
}

/**
 * Inline, render-blocking script that restores the saved chart theme before
 * first paint. It only accepts what applyChartTheme writes: a short key and
 * CSS without url(), @import or expression(), so a tampered entry can't load
 * anything (the CSP would block it as well).
 */
export const chartThemeBootScript = `(function(){try{var s=localStorage.getItem('${CHART_THEME_STORAGE_KEY}');if(!s)return;var o=JSON.parse(s);if(!o||typeof o.css!=='string'||typeof o.key!=='string'||o.key.length>64||/url\\(|@import|expression/i.test(o.css))return;var e=document.createElement('style');e.id='${STYLE_ID}';e.textContent=o.css;document.head.appendChild(e);document.documentElement.dataset.chartTheme=o.key;}catch(e){}})();`;
