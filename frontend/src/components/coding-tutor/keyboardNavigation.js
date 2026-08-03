export function handleHorizontalRovingKeyDown(event) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(event.key)) return;

  const isCodingSectionNav = event.currentTarget.classList?.contains("coding-section-nav");
  const scopedTabs = Array.from(event.currentTarget.querySelectorAll("[role='tab']"));
  const candidates = scopedTabs.length
    ? scopedTabs
    : isCodingSectionNav
      ? Array.from(event.currentTarget.querySelectorAll("[data-coding-navitem='true']"))
    : Array.from(event.currentTarget.querySelectorAll("button, summary, [role='button']"));
  const buttons = candidates.filter((node) => !node.disabled && node.getClientRects().length > 0);
  if (!buttons.length) return;

  const activeNavItem = isCodingSectionNav
    ? document.activeElement?.closest?.("[data-coding-navitem='true']")
      || document.activeElement?.closest?.(".coding-nav-more")?.querySelector?.("[data-coding-nav-more-button='true']")
    : document.activeElement;
  const activeIndex = buttons.indexOf(activeNavItem);
  const currentIndex = activeIndex >= 0
    ? activeIndex
    : event.key === "ArrowLeft"
      ? buttons.length
      : -1;
  const nextIndex = (() => {
    if (event.key === "Home") return 0;
    if (event.key === "End") return buttons.length - 1;
    if (event.key === "ArrowLeft") return (currentIndex - 1 + buttons.length) % buttons.length;
    return (currentIndex + 1) % buttons.length;
  })();

  event.preventDefault();
  buttons[nextIndex].focus();
  if (!isCodingSectionNav) {
    buttons[nextIndex].click();
  }
}
