function parseJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(window.atob(padded));
  } catch {
    return {};
  }
}

export function currentUserStorageScope() {
  try {
    const token = window.localStorage.getItem("token");
    if (!token) return "anonymous";
    const payload = parseJwtPayload(token);
    const id = payload.user_id || payload.sub || payload.email;
    return id ? `user:${String(id).toLowerCase()}` : "anonymous";
  } catch {
    return "anonymous";
  }
}

export function scopedStorageKey(base, scope = currentUserStorageScope()) {
  return `${base}:${scope}`;
}
