/**
 * Copy text from inside a Sitecore frame.
 *
 * Sitecore loads the app in `<iframe sandbox="allow-scripts allow-same-origin allow-forms">`
 * with no `allow` attribute, so the async Clipboard API is refused by permissions policy there.
 * The older `execCommand("copy")` on a selected textarea still works from a click, so it is the
 * fallback. Returns whether the text was copied.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused in the frame: fall back below.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.width = "1px";
  area.style.height = "1px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  const previous = document.activeElement as HTMLElement | null;
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  previous?.focus?.();
  return copied;
}
