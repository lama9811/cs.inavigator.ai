const CHAT_HISTORY_NAV_LOCK_KEY = "csnav.chatHistoryNavigationLock";
const CHAT_HISTORY_NAV_LOCK_MS = 2500;

function now() {
  return Date.now();
}

function readLock() {
  try {
    const raw = sessionStorage.getItem(CHAT_HISTORY_NAV_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.startedAt || now() - parsed.startedAt > CHAT_HISTORY_NAV_LOCK_MS) {
      sessionStorage.removeItem(CHAT_HISTORY_NAV_LOCK_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function startChatHistoryNavigationLock(targetRoute) {
  try {
    sessionStorage.setItem(
      CHAT_HISTORY_NAV_LOCK_KEY,
      JSON.stringify({ targetRoute, startedAt: now() })
    );
    window.setTimeout(() => {
      const current = readLock();
      if (current?.targetRoute === targetRoute) {
        sessionStorage.removeItem(CHAT_HISTORY_NAV_LOCK_KEY);
      }
    }, CHAT_HISTORY_NAV_LOCK_MS);
  } catch {
    // Storage can be blocked; navigation still works without the guard.
  }
}

export function isChatHistoryNavigationLocked() {
  return Boolean(readLock());
}
