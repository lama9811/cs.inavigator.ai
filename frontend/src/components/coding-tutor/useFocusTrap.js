import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export default function useFocusTrap(active, { onEscape, lockScroll = true } = {}) {
  const containerRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = "hidden";

    const focusables = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((node) => node instanceof HTMLElement && node.getClientRects().length > 0);
    const initialFocus =
      container.querySelector("[data-autofocus]") ||
      focusables[0] ||
      container;
    window.requestAnimationFrame(() => initialFocus?.focus?.());

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const currentFocusables = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((node) => node instanceof HTMLElement && node.getClientRects().length > 0);
      if (!currentFocusables.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (lockScroll) document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [active, lockScroll]);

  return containerRef;
}
