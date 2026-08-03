export function handleHorizontalRovingKeyDown(event) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(event.key)) return;

  const scopedTabs = Array.from(event.currentTarget.querySelectorAll("[role='tab']"));
  const candidates = scopedTabs.length
    ? scopedTabs
    : Array.from(event.currentTarget.querySelectorAll("button, summary, [role='button']"));
  const buttons = candidates.filter((node) => !node.disabled && node.getClientRects().length > 0);
  if (!buttons.length) return;

  const currentIndex = Math.max(0, buttons.indexOf(document.activeElement));
  const nextIndex = (() => {
    if (event.key === "Home") return 0;
    if (event.key === "End") return buttons.length - 1;
    if (event.key === "ArrowLeft") return (currentIndex - 1 + buttons.length) % buttons.length;
    return (currentIndex + 1) % buttons.length;
  })();

  event.preventDefault();
  buttons[nextIndex].focus();
  buttons[nextIndex].click();
}
