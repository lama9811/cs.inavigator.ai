import React, { useState, useEffect, useRef } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { Toaster, toast } from "sonner";

import NavBar         from "./components/NavBar";
import ChatSidebar    from "./components/ChatSidebar";
import Chatbox        from "./components/Chatbox";
import CurriculumPage from "./components/CurriculumPage";
import MyClassesPage from "./components/MyClassesPage";
import GradeSurgeon from "./components/GradeSurgeon";
import RippleEffect from "./components/RippleEffect";
import PlannerPage from "./components/PlannerPage";
import AdvisingPage from "./components/advising/AdvisingPage";
import ScholarshipsPage from "./components/scholarships/ScholarshipsPage";
import ProfilePage    from "./components/ProfilePage";
import AdminDashboard from "./components/AdminDashboard";
import Forbidden      from "./components/Forbidden";
import LandingPage    from "./components/LandingPage";
import CommandPalette from "./components/CommandPalette";
// WelcomeModal removed

import SignUp from "./SignUp";
import Login  from "./Login";
import ForgotPassword from "./ForgotPassword";
import ResetPassword from "./ResetPassword";

import "./index.css";

import { getApiBase } from "./lib/apiBase";
import { generateChatTitle, shouldAutoRenameSession } from "./lib/chatTitles";
const API_BASE = getApiBase();
const ACTIVE_CHAT_SESSION_KEY = "active_chat_session_id";
// Set at login, consumed by the /chat-history restore effect: a fresh sign-in
// always lands on a blank "New Chat" (the welcome screen) instead of resuming
// the last conversation. sessionStorage (not localStorage) so a plain refresh
// mid-conversation still keeps the user where they were.
const FRESH_LOGIN_SESSION_KEY = "fresh_login_session_id";

function makeBlankSession(id) {
  return { id, title: "New Chat", messages: [], pinned: false, archived: false, mode: "regular" };
}

function getDisplayChatText(text) {
  if (typeof text !== "string") return text;
  const marker = "Student message:";
  if (text.includes("Current coding workspace context:") && text.includes(marker)) {
    return text.slice(text.lastIndexOf(marker) + marker.length).trim();
  }
  return text;
}

function parseJwt(token) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) =>
          "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)
        )
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return {};
  }
}

// True when the token is missing, malformed, or past its `exp` claim. A 30s skew
// buffer avoids logging out a token that's about to expire mid-request.
function isTokenExpired(token) {
  if (!token) return true;
  const payload = parseJwt(token);
  // A token that can't be decoded into a usable payload is not trustworthy →
  // treat it as expired (parseJwt returns {} on any parse failure).
  if (!payload || typeof payload !== "object" || Object.keys(payload).length === 0) return true;
  const { exp } = payload;
  // A decodable token with no exp: defer to the server (it's the authority on
  // validity); only exp-based expiry is decided client-side.
  if (!exp) return false;
  return Date.now() >= (exp * 1000) - 30_000;
}

// Clear all auth/session state from storage. Shared by manual logout and the
// automatic session-expiry paths so they never drift.
function clearAuthStorage() {
  localStorage.removeItem("token");
  localStorage.removeItem("chat_sessions");
  localStorage.removeItem(ACTIVE_CHAT_SESSION_KEY);
  // Reset the remembered Concept Quiz location on logout so the next sign-in
  // doesn't jump back into the previous user's quiz spot.
  localStorage.removeItem("concept_quiz_last_path");
}

// Module-level guard so the expiry toast fires once even if several RequireAuth
// instances (or the fetch interceptor) detect expiry at the same time.
let expiryToastShown = false;
function notifySessionExpiredOnce() {
  if (expiryToastShown) return;
  expiryToastShown = true;
  toast.error("Your session expired — please log in again.", { duration: 2600 });
  // Allow a future expiry (after the user logs back in) to notify again.
  setTimeout(() => { expiryToastShown = false; }, 3000);
}

function RequireAuth({ children, onExpired }) {
  const token = localStorage.getItem("token");
  const expired = isTokenExpired(token);
  // Side effects (toast + storage clear) run in an effect, not during render, so
  // the toast reliably fires and survives the redirect. `token` (not `expired`) in
  // deps: we only care whether there was a real token that just went invalid.
  const hadToken = Boolean(token);
  useEffect(() => {
    if (expired && hadToken) {
      if (onExpired) onExpired({ expired: true });
      else {
        notifySessionExpiredOnce();
        clearAuthStorage();
      }
    }
  }, [expired, hadToken, onExpired]);

  // Gate on a VALID token, not just its presence — an expired token used to leave
  // the user "logged in" on a broken UI where every API call silently 401'd. Pass
  // sessionExpired state so the login page shows its banner too (guaranteed message,
  // independent of the toast's timing).
  if (expired) return <Navigate to="/login" replace state={hadToken ? { sessionExpired: true } : undefined} />;
  return children;
}

function ChatLayout({
  sessions,
  activeId,
  onNew,
  onSelect,
  onDelete,
  onSessionChange,
  onCreateSession,
  pendingChatAction,
  onPendingChatActionHandled,
  onLogout,
  userEmail,
  onPin,
  onArchive,
  onRename,
  darkMode,
  onToggleTheme,
  onCollapseSidebar,
  onSidebarResize,
  initialChatMode,
}) {
  const activeSession = sessions.find((s) => s.id === activeId) || { messages: [] };
  return (
    <div className="app-layout">
      <ChatSidebar
        sessions={sessions}
        activeId={activeId}
        onNew={onNew}
        onSelect={onSelect}
        onDelete={onDelete}
        onLogout={onLogout}
        userEmail={userEmail}
        onPin={onPin}
        onArchive={onArchive}
        onRename={onRename}
        darkMode={darkMode}
        onToggleTheme={onToggleTheme}
        onCollapseSidebar={onCollapseSidebar}
        onSidebarResize={onSidebarResize}
      />
      {/* 🔥 UPDATE: Passing sessionId to Chatbox so it knows where to save */}
      <Chatbox
        key={activeId}
        sessionId={activeId}
        initialMessages={activeSession.messages}
        onSessionChange={onSessionChange}
        onCreateSession={onCreateSession}
        pendingChatAction={pendingChatAction}
        onPendingChatActionHandled={onPendingChatActionHandled}
        initialChatMode={initialChatMode}
      />
    </div>
  );
}

function SidebarLayout({
  sessions,
  activeId,
  onNew,
  onSelect,
  onDelete,
  onLogout,
  userEmail,
  onPin,
  onArchive,
  onRename,
  darkMode,
  onToggleTheme,
  onCollapseSidebar,
  onSidebarResize,
  children
}) {
  return (
    <div className="app-layout">
      <ChatSidebar
        sessions={sessions}
        activeId={activeId}
        onNew={onNew}
        onSelect={onSelect}
        onDelete={onDelete}
        onLogout={onLogout}
        userEmail={userEmail}
        onPin={onPin}
        onArchive={onArchive}
        onRename={onRename}
        darkMode={darkMode}
        onToggleTheme={onToggleTheme}
        onCollapseSidebar={onCollapseSidebar}
        onSidebarResize={onSidebarResize}
      />
      <div className="page-content">
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const navigate = useNavigate();

  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const isAuthenticated = !isTokenExpired(token);
  // Seed role from the existing token synchronously so a returning user's first
  // paint already shows the logged-in navbar. Starting at null made NavBar flash
  // the logged-out links (Try Free / Login / Sign Up) for a frame before the
  // token-sync effect below set the real role. The server profile fetch still
  // refreshes/authoritatively confirms the role right after mount.
  const [role, setRole]   = useState(() => parseJwt(localStorage.getItem("token")).role || null);
  // Start collapsed on small screens so the chat is fully visible; on phones the
  // sidebar opens as an overlay drawer instead of pushing/covering the chat.
  // Also honor the user's saved preference so the collapsed state survives a
  // reload: toggleSidebar/handleSidebarResize persist `sidebar_width` (64 ==
  // collapsed). Without reading it back here, desktop always reopened the sidebar
  // on every reload regardless of how the user left it.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    if (window.innerWidth < 768) return true;
    return Number(localStorage.getItem("sidebar_width")) === 64;
  });
  const [cmdkOpen, setCmdkOpen] = useState(false);
  // Dark mode state
  // Global (app-wide) dark mode has been retired — only the Coding Tutor has a
  // scoped dark theme now (driven by `body.coding-dark`, toggled inside
  // CodingTutor). We keep this state pinned to `false` so the `darkMode` prop
  // threaded through the tree stays valid, but it never turns the whole app dark.
  const darkMode = false;

  // sync token ↔ localStorage & extract role
  useEffect(() => {
    if (token) {
      localStorage.setItem("token", token);
      const { role: r } = parseJwt(token);
      setRole(r || null);

      let cancelled = false;
      fetch(`${API_BASE}/api/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((profile) => {
          if (!cancelled && profile?.role) {
            setRole(profile.role);
          }
        })
        .catch((error) => {
          console.warn("Could not refresh profile role:", error);
        });

      return () => {
        cancelled = true;
      };
    } else {
      localStorage.removeItem("token");
      setRole(null);
    }
  }, [token]);

  // Global 401 interceptor: wrap window.fetch so ANY authenticated call to our API
  // that returns 401 (expired/invalid token) triggers an automatic logout. Without
  // this, an expired token left the user "logged in" while every call — Canvas
  // sync, DegreeWorks, chat — failed silently with no feedback. Installed once;
  // uses a ref so it isn't re-installed on every render. Scoped to our own API and
  // only when a token exists, so third-party 401s and the login page are untouched.
  const logoutRef = useRef(null);
  // Guards against a burst of simultaneous 401s all firing the expiry logout (which
  // would stack toasts / redirects). Only the first one runs the flow.
  const expiredLogoutStartedRef = useRef(false);
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      try {
        if (response.status === 401 && localStorage.getItem("token")) {
          const rawUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
          // Match the configured backend origin and confirm this was an authenticated
          // request. This covers /chat and /chat-history as well as /api/* without
          // treating an unrelated same-origin 401 as an expired session.
          let isOurApi = false;
          try {
            const u = new URL(rawUrl, window.location.origin);
            const apiOrigin = API_BASE ? new URL(API_BASE, window.location.origin).origin : window.location.origin;
            const requestHeaders = new Headers(
              args[1]?.headers || (args[0] instanceof Request ? args[0].headers : undefined)
            );
            const hasBearerToken = /^Bearer\s+\S+/i.test(requestHeaders.get("Authorization") || "");
            isOurApi = u.origin === apiOrigin && hasBearerToken;
          } catch {
            isOurApi = false;
          }
          if (isOurApi && logoutRef.current) logoutRef.current({ expired: true });
        }
      } catch {
        // Never let the interceptor's own error break the caller's response.
      }
      return response;
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  // Retire global dark mode. Always strip the app-wide `body.dark` class and the
  // stale "theme" key on mount, so a value persisted before this change (e.g. a
  // user who toggled dark, then merged a build with no global toggle) can never
  // leave the whole app stuck dark with no way back. Coding Tutor's scoped dark
  // theme (`body.coding-dark` / "codingTheme") is independent and unaffected.
  useEffect(() => {
    document.body.classList.remove("dark");
    localStorage.removeItem("theme");
  }, []);

  // Toggle sidebar CSS class on body
  // IMPORTANT: Also collapse sidebar when not authenticated to prevent overlay on login page
  useEffect(() => {
    const shouldCollapse = sidebarCollapsed || !isAuthenticated;
    document.body.classList.toggle('sidebar-collapsed', shouldCollapse);
  }, [sidebarCollapsed, isAuthenticated]);

  // Cmd+K listener
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdkOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // chat‐session state
  const [sessions, setSessions] = useState(() => {
    // Try to load from local storage first for immediate UI
    const saved = JSON.parse(localStorage.getItem("chat_sessions") || "[]");
    if (!saved.length) {
      const id = Date.now().toString();
      return [{ id, title: "New Chat", messages: [], pinned: false, archived: false, mode: "regular" }];
    }
    return saved.map(s => ({
      ...s,
      pinned: s.pinned || false,
      archived: s.archived || false,
      autoTitle: s.autoTitle ?? shouldAutoRenameSession(s, s.messages || []),
      title: shouldAutoRenameSession(s, s.messages || []) ? generateChatTitle(s.messages || [], s.mode || "regular") : s.title,
      mode: s.mode || (String(s.id).startsWith("coding-") ? "coding_tutor" : "regular")
    }));
  });
  
  const [activeId, setActiveId] = useState(() => {
    const savedActiveId = localStorage.getItem(ACTIVE_CHAT_SESSION_KEY);
    return sessions.some((session) => session.id === savedActiveId)
      ? savedActiveId
      : sessions[0]?.id || "";
  });
  const [pendingChatAction, setPendingChatAction] = useState(null);
  
  useEffect(() => {
    localStorage.setItem("chat_sessions", JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    if (activeId) {
      localStorage.setItem(ACTIVE_CHAT_SESSION_KEY, activeId);
    }
  }, [activeId]);

  // 🔥 NEW: Fetch Chat History from RDS & GROUP BY SESSION ID
  useEffect(() => {
    async function loadHistory() {
      if (!token) return;
      // Non-null only on the load that immediately follows a sign-in. It holds
      // the id of the blank session onLoggedIn already created, so we reuse it
      // rather than creating a second empty chat.
      const freshLoginId = sessionStorage.getItem(FRESH_LOGIN_SESSION_KEY);
      if (freshLoginId) sessionStorage.removeItem(FRESH_LOGIN_SESSION_KEY);
      try {
        const res = await fetch(`${API_BASE}/chat-history`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          
          if (data.history && data.history.length > 0) {
              const grouped = {};
              // Real last-activity time per session (epoch ms of the newest
              // message). The backend streams messages oldest-first, and session
              // ids are NOT always a parseable creation epoch (e.g. "default"),
              // so this is the reliable sort/recency key — not the id.
              const lastActivity = {};

              // Group the flat list of messages by their session_id
              data.history.forEach(item => {
                  const sid = item.session_id || "default";
                  if (!grouped[sid]) grouped[sid] = [];

                  const ts = new Date(item.time).getTime();
                  if (!isNaN(ts)) {
                    lastActivity[sid] = Math.max(lastActivity[sid] || 0, ts);
                  }

                  // Add User Message
                  grouped[sid].push({
                    text: getDisplayChatText(item.user),
                    sender: "user",
                    time: new Date(item.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
                  });

                  // Add Bot Message
                  grouped[sid].push({
                    text: item.bot,
                    sender: "bot",
                    time: new Date(item.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
                  });
              });

              // Convert the groups into your Session Objects
              const dbSessions = Object.keys(grouped).map(sid => ({
                  id: sid,
                  title: generateChatTitle(grouped[sid], String(sid).startsWith("coding-") ? "coding_tutor" : "regular"),
                  messages: grouped[sid],
                  lastActivity: lastActivity[sid] || 0,
                  pinned: false,
                  archived: false,
                  autoTitle: true,
                  mode: String(sid).startsWith("coding-") ? "coding_tutor" : "regular"
              }));

              if (freshLoginId) {
                // Fresh sign-in: keep the whole history in the sidebar, but sit
                // on a blank chat so the user lands on the welcome screen.
                setSessions([
                  makeBlankSession(freshLoginId),
                  ...dbSessions.filter((session) => session.id !== freshLoginId)
                ]);
                setActiveId(freshLoginId);
                return;
              }

              // Update state with database sessions
              setSessions(dbSessions);

              // Keep the user's selected chat after refresh when it still exists;
              // otherwise default to the MOST RECENTLY ACTIVE session (by real
              // message time), not just the last one in array order.
              if (dbSessions.length > 0) {
                const savedActiveId = localStorage.getItem(ACTIVE_CHAT_SESSION_KEY);
                const savedSession = dbSessions.find((session) => session.id === savedActiveId);
                const mostRecent = dbSessions.reduce((a, b) =>
                  (b.lastActivity || 0) > (a.lastActivity || 0) ? b : a
                );
                setActiveId(savedSession?.id || mostRecent.id);
              }
          } else {
              // New account or no history - reset to a fresh session
              // This clears any stale sessions from a previous account
              const freshId = freshLoginId || Date.now().toString();
              setSessions([makeBlankSession(freshId)]);
              setActiveId(freshId);
          }
        }
      } catch (err) {
        console.error("Failed to load persistent chat history:", err);
      }
    }
    loadHistory();
  }, [token]); // Run once when token changes (login)

  // FIXED: session handlers
  const handleNew = (options = {}) => {
    const config = options && !options.preventDefault ? options : {};
    const mode = config.mode || "regular";
    const id = config.id || (mode === "coding_tutor" ? `coding-${Date.now()}` : Date.now().toString());
    const newChat = {
      id,
      title: config.title || "New Chat",
      messages: [],
      pinned: false,
      archived: false,
      autoTitle: config.autoTitle ?? !config.title,
      mode,
    };
    setSessions((prev) => [...prev, newChat]); // Append to end
    setActiveId(id);
    if (config.pendingAction) {
      setPendingChatAction({
        ...config.pendingAction,
        id: config.pendingAction.id || `pending-${id}-${Date.now()}`,
        sessionId: id,
        mode,
      });
    }
    navigate(config.route || (mode === "coding_tutor" ? "/coding" : "/chat"));
    return id;
  };

  const handleSelect = (id) => {
    setActiveId(id);
    localStorage.setItem(ACTIVE_CHAT_SESSION_KEY, id);
    const selected = sessions.find((s) => s.id === id);
    navigate(selected?.mode === "coding_tutor" || String(id).startsWith("coding-") ? "/chat/coding" : "/chat");
  };

  // Header/brand click: land on the MOST RECENT regular chat — the one at the TOP
  // of the sidebar — regardless of whether it has messages yet. Fixes the header
  // dropping the user into a stale/older chat. If there are no regular chats at
  // all, open a fresh one. Coding sessions are excluded (the brand is the CS Nav
  // regular entry point).
  //
  // Recency key: prefer the real last-activity time captured at history load;
  // fall back to the creation epoch embedded in the id for freshly-created
  // client-side sessions that haven't synced from the DB yet. This is the SAME
  // key the sidebar sorts by, so "most recent" == top of the sidebar.
  const sessionRecency = (s) =>
    (s?.lastActivity || 0) || Number(String(s?.id || "").match(/^\d+/)?.[0]) || 0;
  const handleBrandClick = () => {
    const regular = sessions.filter(
      (s) => !s.archived && s.mode !== "coding_tutor" && !String(s.id).startsWith("coding-")
    );
    if (regular.length === 0) {
      handleNew();
      return;
    }
    const mostRecent = regular.reduce((a, b) =>
      sessionRecency(b) > sessionRecency(a) ? b : a
    );
    handleSelect(mostRecent.id);
  };

  const handlePendingChatActionHandled = (id) => {
    setPendingChatAction((current) => current?.id === id ? null : current);
  };
  
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this chat permanently?")) return;
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    if (activeId === id) setActiveId(next[0]?.id || "");
    try {
      await fetch(`${API_BASE}/api/sessions/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
    } catch (err) {
      console.error("Failed to delete session from server:", err);
    }
  };
  
  // 🔥 FIXED: Prevent infinite re-renders by checking if messages actually changed
  const handleUpdateSession = (msgs) => {
    setSessions((prev) => {
      const currentSession = prev.find((s) => s.id === activeId);

      // Only update if messages actually changed
      if (currentSession && JSON.stringify(currentSession.messages) === JSON.stringify(msgs)) {
        return prev; // No change needed, return same reference
      }

      // Only a REAL new message counts as activity. Merely opening a session can
      // re-emit its messages (hydration normalizes user text, so the arrays differ
      // by content but not by count) — that must NOT bump recency, or opening an
      // old chat wrongly makes it "most recent" and the header lands there next
      // time. So bump lastActivity only when the message COUNT grew.
      const prevCount = currentSession?.messages?.length || 0;
      const isNewMessage = msgs.length > prevCount;

      return prev.map((s) =>
        s.id === activeId
          ? {
              ...s,
              messages: msgs,
              // Advance the recency key only on a real new message (see above).
              // Seeded at history-load; kept frozen when just viewing so ranking
              // reflects true last activity, not last-opened.
              lastActivity: isNewMessage ? Date.now() : s.lastActivity,
              title: msgs.length > 0 && shouldAutoRenameSession(s, msgs)
                ? generateChatTitle(msgs, s.mode)
                : s.title,
              autoTitle: shouldAutoRenameSession(s, msgs),
            }
          : s
      );
    });
  };

  // Pin/Unpin handler
  const handlePin = (id) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, pinned: !s.pinned } : s
      )
    );
  };

  // Archive handler
  const handleArchive = (id) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, archived: !s.archived } : s
      )
    );
    if (id === activeId) {
      const remaining = sessions.filter(s => s.id !== id && !s.archived);
      setActiveId(remaining[0]?.id || "");
    }
  };

  // Rename handler
  const handleRename = (id, newTitle) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, title: newTitle, autoTitle: false } : s
      )
    );
  };

  // Sidebar controls
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const nextCollapsed = !prev;
      const savedWidth = Number(localStorage.getItem("sidebar_width"));

      if (nextCollapsed) {
        document.body.classList.add("sidebar-collapsed");
        document.body.classList.remove("sidebar-custom-width");
        document.documentElement.style.setProperty("--sidebar-width", "64px");
        localStorage.setItem("sidebar_width", "64");
      } else if (Number.isFinite(savedWidth) && savedWidth > 72 && savedWidth < 280) {
        document.body.classList.remove("sidebar-collapsed");
        document.documentElement.style.setProperty("--sidebar-width", `${savedWidth}px`);
        document.body.classList.add("sidebar-custom-width");
      } else {
        document.body.classList.remove("sidebar-collapsed");
        document.body.classList.remove("sidebar-custom-width");
        document.documentElement.style.setProperty("--sidebar-width", "280px");
        localStorage.setItem("sidebar_width", "280");
      }

      return nextCollapsed;
    });
  };

  const handleSidebarResize = ({ collapsed, width }) => {
    const savedWidth = Number(width) || 64;
    document.documentElement.style.setProperty("--sidebar-width", `${savedWidth}px`);
    document.body.classList.toggle("sidebar-custom-width", !collapsed && savedWidth < 280);
    localStorage.setItem("sidebar_width", String(savedWidth));
    setSidebarCollapsed(Boolean(collapsed));
  };

  // Theme toggle function.
  // Global dark mode is retired — this is now a no-op kept only so the
  // `onToggleTheme` prop threaded through the tree stays valid. Dark mode lives
  // exclusively inside the Coding Tutor now (its own scoped toggle).
  const toggleTheme = () => {};

  // Clear session state + reset the UI to a fresh chat. Shared by both logout paths.
  const resetToLoggedOut = () => {
    setToken(null);
    clearAuthStorage();
    const freshId = Date.now().toString();
    setSessions([{ id: freshId, title: "New Chat", messages: [], pinned: false, archived: false, mode: "regular" }]);
    setActiveId(freshId);
  };

  // logout — takes an OPTIONS OBJECT ({ expired }), not a positional boolean, so a
  // click handler wiring `onClick={onLogout}` (which passes the event as arg 0)
  // can't be misread as an expired-session logout. `expired` distinguishes an
  // automatic session-expiry logout (toast + notice) from a manual one.
  const handleLogout = (opts) => {
    const expired = opts === true || opts?.expired === true; // tolerate legacy `true`
    if (!expired) {
      resetToLoggedOut();
      navigate("/login", { replace: true });
      return;
    }
    // Expiry path (from the 401 interceptor): dedupe a burst of 401s, show the
    // shared toast, clear, and redirect. The toast lives on the app-root <Toaster>
    // so it survives the navigation and remains visible on the login page.
    if (expiredLogoutStartedRef.current) return;
    expiredLogoutStartedRef.current = true;
    notifySessionExpiredOnce();
    resetToLoggedOut();
    navigate("/login", { replace: true, state: { sessionExpired: true } });
    setTimeout(() => { expiredLogoutStartedRef.current = false; }, 1500);
  };
  // Keep the interceptor's logout ref pointing at the latest handleLogout closure.
  logoutRef.current = handleLogout;

  // Expiration is a moment in time, not a React event. Schedule the shared logout
  // path from the JWT exp claim so an idle page updates immediately without waiting
  // for another render, API request, or full reload.
  useEffect(() => {
    if (!token) return undefined;
    const { exp } = parseJwt(token);
    if (!Number.isFinite(Number(exp))) return undefined;

    let timeoutId;
    const scheduleExpiryCheck = () => {
      const remaining = (Number(exp) * 1000) - 30_000 - Date.now();
      if (remaining <= 0) {
        logoutRef.current?.({ expired: true });
        return;
      }
      timeoutId = window.setTimeout(scheduleExpiryCheck, Math.min(remaining, 2_147_483_647));
    };
    scheduleExpiryCheck();
    return () => window.clearTimeout(timeoutId);
  }, [token]);

  // Extract user email from token
  const userEmail = token ? (parseJwt(token).email || parseJwt(token).sub || "User") : "";

  return (
    <>
      <Toaster position="top-center" richColors />
      {/* WelcomeModal removed */}
      <CommandPalette
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        onNewChat={handleNew}
        onNavigate={navigate}
        role={role}
      />
      <NavBar
        role={role}
        authenticated={isAuthenticated}
        onLogout={handleLogout}
        onToggleSidebar={toggleSidebar}
        onBrandClick={handleBrandClick}
      />

      <Routes>
        {/* public */}
        <Route
          path="/signup"
          element={
            <SignUp onRegistered={() => navigate("/login", { replace: true })} />
          }
        />
        <Route
          path="/login"
          element={
            <Login
              onLoggedIn={(tk) => {
                // Land on a blank chat, not the last conversation. Done here
                // (not just in the /chat-history effect) so the stale session
                // restored from localStorage never flashes on screen first.
                const freshId = Date.now().toString();
                sessionStorage.setItem(FRESH_LOGIN_SESSION_KEY, freshId);
                setSessions((prev) => [makeBlankSession(freshId), ...prev]);
                setActiveId(freshId);
                setToken(tk);
                navigate("/chat", { replace: true });
              }}
            />
          }
        />

        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* public: guest trial chat */}
        <Route
          path="/trychat"
          element={<LandingPage />}
        />

        {/* root redirects to /trychat or /chat based on auth */}
        <Route
          path="/"
          element={<Navigate to={isAuthenticated ? "/chat" : "/trychat"} replace />}
        />

        {/* protected: chat */}
        <Route
          path="/chat"
          element={
            <RequireAuth onExpired={handleLogout}>
              <ChatLayout
                sessions={sessions}
                activeId={activeId}
                onNew={handleNew}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onSessionChange={handleUpdateSession}
                onCreateSession={handleNew}
                pendingChatAction={pendingChatAction}
                onPendingChatActionHandled={handlePendingChatActionHandled}
                onLogout={handleLogout}
                userEmail={userEmail}
                onPin={handlePin}
                onArchive={handleArchive}
                onRename={handleRename}
                darkMode={darkMode}
                onToggleTheme={toggleTheme}
                onCollapseSidebar={toggleSidebar}
                onSidebarResize={handleSidebarResize}
              />
            </RequireAuth>
          }
        />

        <Route
          /* Coding Tutor sections are nested routes under /coding (e.g.
             /coding/practice, /coding/workspace). The "/*" lets every sub-section
             render the same ChatLayout; CodingTutor derives the active section
             from the path while staying mounted (shared state is preserved). */
          path="/coding/*"
          element={
            <RequireAuth onExpired={handleLogout}>
              <ChatLayout
                sessions={sessions}
                activeId={activeId}
                onNew={handleNew}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onSessionChange={handleUpdateSession}
                onCreateSession={handleNew}
                pendingChatAction={pendingChatAction}
                onPendingChatActionHandled={handlePendingChatActionHandled}
                onLogout={handleLogout}
                userEmail={userEmail}
                onPin={handlePin}
                onArchive={handleArchive}
                onRename={handleRename}
                darkMode={darkMode}
                onToggleTheme={toggleTheme}
                onCollapseSidebar={toggleSidebar}
                onSidebarResize={handleSidebarResize}
                initialChatMode="coding_tutor"
              />
            </RequireAuth>
          }
        />
        <Route
          path="/chat/coding"
          element={
            <RequireAuth onExpired={handleLogout}>
              <ChatLayout
                sessions={sessions}
                activeId={activeId}
                onNew={handleNew}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onSessionChange={handleUpdateSession}
                onCreateSession={handleNew}
                pendingChatAction={pendingChatAction}
                onPendingChatActionHandled={handlePendingChatActionHandled}
                onLogout={handleLogout}
                userEmail={userEmail}
                onPin={handlePin}
                onArchive={handleArchive}
                onRename={handleRename}
                darkMode={darkMode}
                onToggleTheme={toggleTheme}
                onCollapseSidebar={toggleSidebar}
                onSidebarResize={handleSidebarResize}
                initialChatMode="coding_tutor"
              />
            </RequireAuth>
          }
        />

        {/* protected: my classes with sidebar */}
        <Route
          path="/my-classes"
          element={
            <RequireAuth onExpired={handleLogout}>
              <SidebarLayout
                sessions={sessions}
                activeId={activeId}
                onNew={handleNew}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onLogout={handleLogout}
                userEmail={userEmail}
                onPin={handlePin}
                onArchive={handleArchive}
                onRename={handleRename}
                darkMode={darkMode}
                onToggleTheme={toggleTheme}
                onCollapseSidebar={toggleSidebar}
                onSidebarResize={handleSidebarResize}
              >
                <MyClassesPage />
              </SidebarLayout>
            </RequireAuth>
          }
        />

        {/* protected: grade surgeon with sidebar */}
        <Route
          path="/grade-analysis"
          element={
            <RequireAuth onExpired={handleLogout}>
              <SidebarLayout
                sessions={sessions}
                activeId={activeId}
                onNew={handleNew}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onLogout={handleLogout}
                userEmail={userEmail}
                onPin={handlePin}
                onArchive={handleArchive}
                onRename={handleRename}
                darkMode={darkMode}
                onToggleTheme={toggleTheme}
                onCollapseSidebar={toggleSidebar}
                onSidebarResize={handleSidebarResize}
              >
                <GradeSurgeon />
              </SidebarLayout>
            </RequireAuth>
          }
        />

        {/* protected: ripple effect with sidebar */}
        <Route
          path="/ripple-effect"
          element={
            <RequireAuth onExpired={handleLogout}>
              <SidebarLayout
                sessions={sessions}
                activeId={activeId}
                onNew={handleNew}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onLogout={handleLogout}
                userEmail={userEmail}
                onPin={handlePin}
                onArchive={handleArchive}
                onRename={handleRename}
                darkMode={darkMode}
                onToggleTheme={toggleTheme}
                onCollapseSidebar={toggleSidebar}
                onSidebarResize={handleSidebarResize}
              >
                <RippleEffect />
              </SidebarLayout>
            </RequireAuth>
          }
        />

        {/* protected: curriculum with sidebar */}
        <Route
          path="/curriculum"
          element={
            <RequireAuth onExpired={handleLogout}>
              <SidebarLayout
                sessions={sessions}
                activeId={activeId}
                onNew={handleNew}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onLogout={handleLogout}
                userEmail={userEmail}
                onPin={handlePin}
                onArchive={handleArchive}
                onRename={handleRename}
                darkMode={darkMode}
                onToggleTheme={toggleTheme}
                onCollapseSidebar={toggleSidebar}
                onSidebarResize={handleSidebarResize}
              >
                <CurriculumPage />
              </SidebarLayout>
            </RequireAuth>
          }
        />

        {/* protected: next-semester planner with sidebar */}
        <Route
          path="/planner"
          element={
            <RequireAuth onExpired={handleLogout}>
              <SidebarLayout
                sessions={sessions}
                activeId={activeId}
                onNew={handleNew}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onLogout={handleLogout}
                userEmail={userEmail}
                onPin={handlePin}
                onArchive={handleArchive}
                onRename={handleRename}
                darkMode={darkMode}
                onToggleTheme={toggleTheme}
                onCollapseSidebar={toggleSidebar}
                onSidebarResize={handleSidebarResize}
              >
                <PlannerPage />
              </SidebarLayout>
            </RequireAuth>
          }
        />

        {/* protected: advising form section with sidebar */}
        <Route
          path="/advising"
          element={
            <RequireAuth onExpired={handleLogout}>
              <SidebarLayout
                sessions={sessions}
                activeId={activeId}
                onNew={handleNew}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onLogout={handleLogout}
                userEmail={userEmail}
                onPin={handlePin}
                onArchive={handleArchive}
                onRename={handleRename}
                darkMode={darkMode}
                onToggleTheme={toggleTheme}
                onCollapseSidebar={toggleSidebar}
                onSidebarResize={handleSidebarResize}
              >
                <AdvisingPage />
              </SidebarLayout>
            </RequireAuth>
          }
        />

        {/* protected: scholarships + internships search with sidebar */}
        <Route
          path="/scholarships"
          element={
            <RequireAuth onExpired={handleLogout}>
              <SidebarLayout
                sessions={sessions}
                activeId={activeId}
                onNew={handleNew}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onLogout={handleLogout}
                userEmail={userEmail}
                onPin={handlePin}
                onArchive={handleArchive}
                onRename={handleRename}
                darkMode={darkMode}
                onToggleTheme={toggleTheme}
                onCollapseSidebar={toggleSidebar}
                onSidebarResize={handleSidebarResize}
              >
                <ScholarshipsPage />
              </SidebarLayout>
            </RequireAuth>
          }
        />

        {/* 🔥 NEW: protected profile page with sidebar */}
        <Route
          path="/profile"
          element={
            <RequireAuth onExpired={handleLogout}>
              <SidebarLayout
                sessions={sessions}
                activeId={activeId}
                onNew={handleNew}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onLogout={handleLogout}
                userEmail={userEmail}
                onPin={handlePin}
                onArchive={handleArchive}
                onRename={handleRename}
                darkMode={darkMode}
                onToggleTheme={toggleTheme}
                onCollapseSidebar={toggleSidebar}
                onSidebarResize={handleSidebarResize}
              >
                <ProfilePage userEmail={userEmail} onLogout={handleLogout} />
              </SidebarLayout>
            </RequireAuth>
          }
        />

        {/* protected: admin */}
        <Route
          path="/admin"
          element={
            <RequireAuth onExpired={handleLogout}>
              {role === "admin" ? <AdminDashboard /> : <Forbidden />}
            </RequireAuth>
          }
        />

        {/* fallback */}
        <Route
          path="*"
          element={<Navigate to={isAuthenticated ? "/chat" : "/trychat"} replace />}
        />
      </Routes>
    </>
  );
}
