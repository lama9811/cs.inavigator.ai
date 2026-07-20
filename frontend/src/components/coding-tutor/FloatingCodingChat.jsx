import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BsArrowUpCircleFill } from "react-icons/bs";
import { FaCommentDots, FaCompress, FaExpand, FaExternalLinkAlt, FaMicrophone, FaPaperclip, FaSyncAlt, FaTimes, FaWindowMinimize } from "react-icons/fa";
import TutorStatusCard from "./TutorStatusCard";
import WorkspaceCodeContext from "./WorkspaceCodeContext";
import "./FloatingCodingChat.css";

const REMARK_PLUGINS = [remarkGfm];

// Memoized so a message's markdown (and any YouTube iframe in it) does not
// re-render on every keystroke the user types in the floating chat input.
const FloatingMessageMarkdown = memo(function FloatingMessageMarkdown({ text, components }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
      {text}
    </ReactMarkdown>
  );
});

// Two optional one-tap accelerators at the top of the chat. Debug sends its
// request immediately; Rewrite first lets the student pick a target language
// (so they can convert), then sends. They are shortcuts, not a required step —
// the student can always just type a question instead.
const REWRITE_LANGUAGES = ["Same language", "Python", "JavaScript", "Java", "C++"];
const DEFAULT_THINKING_STEPS = ["Reading workspace", "Checking code/context", "Preparing tutor guidance"];

function getFloatingDimensions(isOpen, isMaximized) {
  if (typeof window === "undefined") return { width: 460, height: 650 };
  if (isMaximized) {
    return {
      width: Math.min(920, window.innerWidth - 48),
      height: Math.min(760, window.innerHeight - 48),
    };
  }
  if (isOpen) {
    const mobile = window.innerWidth <= 760;
    return {
      width: Math.min(460, window.innerWidth - (mobile ? 24 : 40)),
      height: Math.min(650, window.innerHeight - (mobile ? 24 : 44)),
    };
  }
  return { width: 176, height: 56 };
}

function getDefaultPosition(isOpen, isMaximized) {
  if (typeof window === "undefined") return { x: null, y: null };
  const { width, height } = getFloatingDimensions(isOpen, isMaximized);
  return {
    x: Math.max(16, window.innerWidth - width - 24),
    y: Math.max(16, window.innerHeight - height - 24),
  };
}

function clampPosition(position, isOpen, isMaximized) {
  if (typeof window === "undefined") return position;
  const { width, height } = getFloatingDimensions(isOpen, isMaximized);
  return {
    x: Math.min(Math.max(16, position.x), Math.max(16, window.innerWidth - width - 16)),
    y: Math.min(Math.max(16, position.y), Math.max(16, window.innerHeight - height - 16)),
  };
}

// ── Snap-to-corner (Grammarly-style) ───────────────────────────────────────
// The widget drags freely, but on release it settles onto the nearest of four
// fixed corners. We persist the CORNER NAME, not raw x/y, so the resting spot
// survives a window resize (raw coordinates could land off-screen after one).
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];
const SNAP_MARGIN = 24;

// The top-left pixel position for a given corner at the current size.
function cornerToPosition(corner, isOpen, isMaximized) {
  if (typeof window === "undefined") return getDefaultPosition(isOpen, isMaximized);
  const { width, height } = getFloatingDimensions(isOpen, isMaximized);
  const right = Math.max(16, window.innerWidth - width - SNAP_MARGIN);
  const bottom = Math.max(16, window.innerHeight - height - SNAP_MARGIN);
  const left = SNAP_MARGIN;
  const top = SNAP_MARGIN;
  switch (corner) {
    case "top-left": return { x: left, y: top };
    case "top-right": return { x: right, y: top };
    case "bottom-left": return { x: left, y: bottom };
    default: return { x: right, y: bottom }; // bottom-right
  }
}

// Which corner is the dragged widget's CENTER closest to. Comparing centers (not
// the top-left origin) makes the snap feel right regardless of the widget's size.
function nearestCorner(position, isOpen, isMaximized) {
  if (typeof window === "undefined") return "bottom-right";
  const { width, height } = getFloatingDimensions(isOpen, isMaximized);
  const cx = position.x + width / 2;
  const cy = position.y + height / 2;
  const horiz = cx < window.innerWidth / 2 ? "left" : "right";
  const vert = cy < window.innerHeight / 2 ? "top" : "bottom";
  return `${vert}-${horiz}`;
}

const CORNER_KEY = "coding_floating_chat_corner";

function readSavedCorner() {
  try {
    const raw = localStorage.getItem(CORNER_KEY);
    return CORNERS.includes(raw) ? raw : null;
  } catch {
    return null;
  }
}


function FloatingChatButton({ onOpen, onDragStart, shouldSuppressOpen }) {
  return (
    <button
      type="button"
      className="floating-chat-button"
      onPointerDown={onDragStart}
      onClick={() => {
        if (shouldSuppressOpen?.()) return;
        onOpen();
      }}
      aria-label="Open coding tutor chat"
      title="Open or drag the Coding Tutor"
    >
      <FaCommentDots aria-hidden="true" />
      <span>Coding Tutor</span>
    </button>
  );
}

function FloatingThinkingSteps({ steps = DEFAULT_THINKING_STEPS }) {
  return (
    <div className="floating-thinking-steps" aria-label="Coding tutor is working">
      {steps.map((step, index) => (
        <div key={step} className={`floating-thinking-step ${index < steps.length - 1 ? "complete" : "active"}`}>
          <span className="floating-thinking-check" aria-hidden="true">
            {index < steps.length - 1 ? "✓" : ""}
          </span>
          <span>{step}</span>
        </div>
      ))}
    </div>
  );
}

function FloatingChatWindow({
  messages,
  input,
  isLoading,
  pendingFile,
  accept,
  inputRef,
  fileInputRef,
  context,
  codeRenderer,
  markdownComponents,
  getFileIcon,
  hasCode,
  suggestedCodeBlock,
  isMaximized,
  thinkingMessages = DEFAULT_THINKING_STEPS,
  onInputChange,
  onFileChange,
  onClearFile,
  onVoiceInput,
  isListening,
  isSpeaking,
  isVoiceMode,
  onSend,
  onQuickAction,
  onApplyAICode,
  onUndoAICode,
  canUndoAICode,
  onMinimize,
  onMaximizeToggle,
  onOpenFullChat,
  onClose,
  onResetPosition,
  onDragStart,
  onMoveToCorner,
}) {
  const activeProblem = context?.activeProblem || null;
  const selectedLanguage = context?.selectedLanguage || "Python";
  const attempts = context?.attempts ?? 0;
  const tutorMode = context?.tutorMode || "Guided Tutor";
  const topic = activeProblem?.title ? `Helping with: ${activeProblem.title}` : "Personal Code Help";
  const defaultMessageLimit = isMaximized ? 24 : 10;
  const [messageLimit, setMessageLimit] = useState(defaultMessageLimit);
  const visibleMessages = messages.slice(-messageLimit);
  const hiddenMessageCount = Math.max(0, messages.length - visibleMessages.length);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const windowRef = useRef(null);
  const messagesRef = useRef(null);
  const keepPinnedToLatestRef = useRef(true);
  // Stable components object so message markdown / iframes don't remount on keystrokes.
  const mdComponents = useMemo(
    () => markdownComponents || { code: codeRenderer },
    [markdownComponents, codeRenderer]
  );
  const showThinking = isLoading && !visibleMessages.some(msg => msg.isStreaming && msg.text);
  const messageSessionId = messages[0]?.widgetSessionId || "";

  useEffect(() => {
    setMessageLimit(defaultMessageLimit);
    keepPinnedToLatestRef.current = true;
  }, [defaultMessageLimit, messageSessionId]);

  useEffect(() => {
    if (!keepPinnedToLatestRef.current || !messagesRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, showThinking]);

  useEffect(() => {
    windowRef.current?.focus();
  }, []);

  const handleWindowKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onMinimize();
    }
  };

  const handleHeaderKeyDown = (event) => {
    if (event.target !== event.currentTarget || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    onMoveToCorner?.(event.key);
  };

  return (
    <section
      ref={windowRef}
      className={`floating-chat-window ${isMaximized ? "maximized" : ""}`}
      aria-label="Coding tutor floating chat"
      tabIndex={-1}
      onKeyDown={handleWindowKeyDown}
    >
      <header
        className="floating-chat-header"
        onPointerDown={onDragStart}
        onKeyDown={handleHeaderKeyDown}
        tabIndex={0}
        aria-label="Move coding tutor window between corners with the arrow keys."
      >
        <div className="floating-chat-heading">
          <span className="coding-kicker">Coding Tutor Chat</span>
          <strong>{topic}</strong>
          <span className="floating-response-mode">Mode: {tutorMode}</span>
        </div>
        <div className="floating-chat-window-controls">
          <button type="button" className="floating-chat-control" onClick={onResetPosition} aria-label="Reset chat position" title="Reset position">
            <FaSyncAlt aria-hidden="true" />
          </button>
          <button type="button" className="floating-chat-control" onClick={onMinimize} aria-label="Minimize coding tutor chat" title="Minimize">
            <FaWindowMinimize aria-hidden="true" />
          </button>
          <button type="button" className="floating-chat-control" onClick={onMaximizeToggle} aria-label={isMaximized ? "Restore coding tutor chat" : "Maximize coding tutor chat"} title={isMaximized ? "Restore" : "Maximize"}>
            {isMaximized ? <FaCompress aria-hidden="true" /> : <FaExpand aria-hidden="true" />}
          </button>
          {onOpenFullChat && (
            <button type="button" className="floating-chat-control" onClick={onOpenFullChat} aria-label="Open full coding chat" title="Open full chat">
              <FaExternalLinkAlt aria-hidden="true" />
            </button>
          )}
          <button type="button" className="floating-chat-control danger" onClick={onClose} aria-label="Close coding tutor session" title="Close session">
            <FaTimes aria-hidden="true" />
          </button>
        </div>
      </header>

      <TutorStatusCard
        activeProblem={activeProblem}
        selectedLanguage={selectedLanguage}
        attempts={attempts}
        tutorMode={tutorMode}
      />

      <WorkspaceCodeContext
        code={context?.code || ""}
        activeProblem={activeProblem}
      />

      {/* Two optional shortcuts at the top. Debug sends immediately; Rewrite opens
          a language choice first so the student can convert before sending. You
          can always just type a question instead. */}
      <div className="floating-focus-chips" aria-label="Quick actions">
        <button
          type="button"
          className="floating-focus-chip"
          onClick={() => onQuickAction("Debug")}
          disabled={isLoading}
          title="Find the likely bug and how to check it."
        >
          Debug
        </button>
        <button
          type="button"
          className={`floating-focus-chip ${rewriteOpen ? "active" : ""}`}
          onClick={() => setRewriteOpen(v => !v)}
          disabled={isLoading}
          aria-expanded={rewriteOpen}
          title="Rewrite your code — pick a target language."
        >
          Rewrite…
        </button>
        {rewriteOpen && (
          <span className="floating-rewrite-langs">
            {REWRITE_LANGUAGES.map(lang => (
              <button
                key={lang}
                type="button"
                className="floating-rewrite-lang"
                onClick={() => { setRewriteOpen(false); onQuickAction("Rewrite", lang); }}
                disabled={isLoading}
              >
                {lang}
              </button>
            ))}
          </span>
        )}
      </div>

      {(suggestedCodeBlock && onApplyAICode) || (canUndoAICode && onUndoAICode) ? (
        <div className="floating-code-actions">
          {suggestedCodeBlock && onApplyAICode && (
            <button
              type="button"
              className="floating-apply-code-btn"
              onClick={onApplyAICode}
            >
              Review and apply tutor code
            </button>
          )}
          {canUndoAICode && onUndoAICode && (
            <button
              type="button"
              className="floating-undo-code-btn"
              onClick={onUndoAICode}
            >
              Undo AI change
            </button>
          )}
        </div>
      ) : null}

      <div
        ref={messagesRef}
        className="floating-chat-messages"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={isLoading}
        onScroll={(event) => {
          const element = event.currentTarget;
          keepPinnedToLatestRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 72;
        }}
      >
        {hiddenMessageCount > 0 && (
          <button
            type="button"
            className="floating-show-earlier"
            onClick={() => setMessageLimit(limit => limit + 20)}
          >
            Show {Math.min(20, hiddenMessageCount)} earlier messages
          </button>
        )}
        {visibleMessages.length ? visibleMessages.map((msg) => (
          <div key={msg.id || `${msg.time || "message"}-${msg.sender}`} className={`floating-chat-message ${msg.sender}`}>
            {msg.isStreaming && !msg.text ? (
              <FloatingThinkingSteps steps={thinkingMessages} />
            ) : (
              <FloatingMessageMarkdown text={msg.text || ""} components={mdComponents} />
            )}
          </div>
        )) : showThinking ? (
          <FloatingThinkingSteps steps={thinkingMessages} />
        ) : (
          <div className="floating-chat-empty">
            <strong>Ask me anything about your code.</strong>
            <p>
              {hasCode
                ? "I can see your current workspace code — just describe what you're stuck on, or tap a shortcut below."
                : "Describe what you're working on or paste a snippet. Load a problem in the workspace and I'll use that code automatically."}
            </p>
          </div>
        )}
      </div>

      <form className="floating-chat-form" onSubmit={onSend}>
        {hasCode && (
          <span className="floating-code-indicator" title="Your current workspace code is sent with each message">
            Using your current code
          </span>
        )}
        {pendingFile && (
          <div className="floating-attachment-preview">
            {getFileIcon?.(pendingFile.name)}
            <span>{pendingFile.name}</span>
            <button type="button" onClick={onClearFile} aria-label="Remove attachment">
              <FaTimes aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="floating-chat-input-row">
          <button
            type="button"
            className="floating-chat-icon-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Attach code or notes"
            aria-label="Attach code or notes"
            disabled={isLoading}
          >
            <FaPaperclip aria-hidden="true" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: "none" }}
            accept={accept}
            onChange={onFileChange}
          />
          <button
            type="button"
            className={`floating-chat-icon-btn floating-chat-voice-btn ${isListening ? "listening" : ""}`}
            onClick={onVoiceInput}
            title="Voice input"
            aria-label="Start voice input"
            disabled={isLoading || isSpeaking || isVoiceMode || !onVoiceInput}
          >
            <FaMicrophone aria-hidden="true" />
          </button>
          <textarea
            ref={inputRef}
            rows={isMaximized ? 4 : 2}
            value={input}
            onChange={onInputChange}
            onKeyDown={(event) => {
              // Enter sends; Ctrl/Cmd+Enter and Shift+Enter insert a newline (for
              // pasting multi-line code). requestSubmit() runs the form's onSubmit
              // (onSend) and respects the submit button's disabled state.
              // isComposing guard: don't send when Enter is confirming an IME
              // composition (Chinese/Japanese/Korean input), or it would submit
              // half-typed text.
              if (
                event.key === "Enter" &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Paste code, an error, or ask for a review..."
            disabled={isLoading}
          />
          <button
            type="submit"
            className="floating-chat-send"
            title="Send message"
            disabled={isLoading || (!input.trim() && !pendingFile)}
          >
            <BsArrowUpCircleFill aria-hidden="true" />
          </button>
        </div>
      </form>
    </section>
  );
}

export default function FloatingCodingChat({ isOpen, isMaximized, onOpen, ...windowProps }) {
  // The widget rests on one of four corners. `corner` is the source of truth; a raw
  // drag position is used only WHILE dragging, then discarded when it snaps back to a
  // corner. Defaulting to bottom-right preserves the old launcher spot.
  const [corner, setCorner] = useState(() => readSavedCorner() || "bottom-right");
  // Non-null only during an active drag: the live pointer-following position. When
  // null, the rendered position is derived from `corner`.
  const [dragPosition, setDragPosition] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [, setViewportRevision] = useState(0);
  const dragFrameRef = useRef(null);
  const dragPositionRef = useRef(null);
  const suppressNextOpenRef = useRef(false);

  // Rendered position. The live drag position is honored ONLY while the OPEN window
  // or CLOSED launcher is being dragged; otherwise the widget sits statically on
  // its saved corner.
  const positionBase = dragPosition
    ? dragPosition
    : cornerToPosition(corner, isOpen, isMaximized);
  const safePosition = clampPosition(positionBase, isOpen, isMaximized);

  // Re-clamp on window resize so a corner position stays valid at the new size.
  useEffect(() => {
    const onResize = () => setViewportRevision(revision => revision + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Closing always cancels any in-flight drag, so the launcher can never inherit a
  // stale drag position and chase the cursor.
  useEffect(() => {
    if (!isOpen) {
      setDragPosition(null);
      setIsDragging(false);
    }
  }, [isOpen]);

  const saveCorner = (nextCorner) => {
    setCorner(nextCorner);
    setDragPosition(null);
    try {
      localStorage.setItem(CORNER_KEY, nextCorner);
    } catch (error) {
      console.warn("[coding-chat] corner save failed", error);
    }
  };

  // "Reset position" control returns the widget to its default bottom-right corner.
  const resetPosition = () => saveCorner("bottom-right");
  const moveToCorner = (key) => {
    const [vertical, horizontal] = corner.split("-");
    if (key === "ArrowLeft") saveCorner(`${vertical}-left`);
    if (key === "ArrowRight") saveCorner(`${vertical}-right`);
    if (key === "ArrowUp") saveCorner(`top-${horizontal}`);
    if (key === "ArrowDown") saveCorner(`bottom-${horizontal}`);
  };

  const startDrag = (event) => {
    if (event.button !== 0 || event.target.closest?.("textarea, input, a, .floating-chat-window-controls button, .floating-chat-form button")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (isOpen) event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    // Start from wherever the widget currently sits (its corner's pixel spot).
    const startPosition = clampPosition(cornerToPosition(corner, isOpen, isMaximized), isOpen, isMaximized);
    let movedEnoughToDrag = false;

    const handleMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (!movedEnoughToDrag && Math.hypot(deltaX, deltaY) < 6) return;
      if (!movedEnoughToDrag) {
        movedEnoughToDrag = true;
        setIsDragging(true);
        if (!isOpen) suppressNextOpenRef.current = true;
      }
      dragPositionRef.current = clampPosition({
        x: startPosition.x + deltaX,
        y: startPosition.y + deltaY,
      }, isOpen, isMaximized);
      if (dragFrameRef.current) return;
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        if (dragPositionRef.current) setDragPosition(dragPositionRef.current);
      });
    };

    const handleUp = (upEvent) => {
      if (dragFrameRef.current) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      setIsDragging(false);
      const finalPosition = movedEnoughToDrag
        ? clampPosition({
            x: startPosition.x + upEvent.clientX - startX,
            y: startPosition.y + upEvent.clientY - startY,
          }, isOpen, isMaximized)
        : startPosition;
      dragPositionRef.current = null;
      // Snap to the nearest corner. Clearing dragPosition lets the rendered
      // position fall back to the corner, and the CSS transition animates the glide.
      if (movedEnoughToDrag) saveCorner(nearestCorner(finalPosition, isOpen, isMaximized));
      else setDragPosition(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  };

  // Position from the corner in BOTH states: the open window is dragged there, and
  // the closed launcher then reappears at the same corner. `corner-<name>` also lets
  // CSS anchor the launcher without inline right/bottom fighting left/top.
  return (
    <div
      className={`floating-coding-chat ${isOpen ? "open" : "closed"} corner-${corner} ${isDragging ? "dragging" : ""} ${isMaximized ? "maximized" : ""}`}
      style={{ left: `${safePosition.x}px`, top: `${safePosition.y}px` }}
    >
      {isOpen ? (
        <FloatingChatWindow
          {...windowProps}
          isMaximized={isMaximized}
          onDragStart={startDrag}
          onResetPosition={resetPosition}
          onMoveToCorner={moveToCorner}
        />
      ) : (
        <FloatingChatButton
          onOpen={onOpen}
          onDragStart={startDrag}
          shouldSuppressOpen={() => {
            if (!suppressNextOpenRef.current) return false;
            suppressNextOpenRef.current = false;
            return true;
          }}
        />
      )}
    </div>
  );
}
