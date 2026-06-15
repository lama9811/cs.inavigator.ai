import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BsArrowUpCircleFill } from "react-icons/bs";
import { FaCommentDots, FaCompress, FaExpand, FaExternalLinkAlt, FaMicrophone, FaPaperclip, FaSyncAlt, FaTimes, FaWindowMinimize } from "react-icons/fa";
import TutorStatusCard from "./TutorStatusCard";
import WorkspaceCodeContext from "./WorkspaceCodeContext";
import "./FloatingCodingChat.css";

const POSITION_KEY = "coding_floating_chat_position";
const DEFAULT_POSITION = { x: null, y: null };
const QUICK_ACTIONS = [
  { label: "Hint", description: "Switches the tutor into guided hint mode for your current code." },
  { label: "Debug", description: "Focuses the tutor on finding bugs and explaining likely causes." },
  { label: "Review", description: "Asks the tutor to review structure, correctness, and the biggest issue." },
  { label: "Complexity", description: "Focuses on time and space complexity reasoning." },
  { label: "Edge Cases", description: "Focuses on tricky inputs and tests you may have missed." },
  { label: "Rewrite", description: "Focuses on rewriting while preserving your approach." },
];
const DEFAULT_THINKING_STEPS = ["Reading workspace", "Checking code/context", "Preparing tutor guidance"];

function getFloatingDimensions(isOpen, isMaximized) {
  if (typeof window === "undefined") return { width: 470, height: 680 };
  if (isMaximized) {
    return {
      width: Math.min(920, window.innerWidth - 48),
      height: Math.min(760, window.innerHeight - 48),
    };
  }
  if (isOpen) {
    return {
      width: Math.min(470, window.innerWidth - 32),
      height: Math.min(680, window.innerHeight - 36),
    };
  }
  return { width: 176, height: 56 };
}

function getDefaultPosition(isOpen, isMaximized) {
  if (typeof window === "undefined") return DEFAULT_POSITION;
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

function readSavedPosition(isOpen, isMaximized) {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return getDefaultPosition(isOpen, isMaximized);
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return getDefaultPosition(isOpen, isMaximized);
    return clampPosition(parsed, isOpen, isMaximized);
  } catch {
    return getDefaultPosition(isOpen, isMaximized);
  }
}

function FloatingChatButton({ onOpen }) {
  return (
    <button
      type="button"
      className="floating-chat-button"
      onClick={onOpen}
      aria-label="Open coding tutor chat"
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
  onMinimize,
  onMaximizeToggle,
  onOpenFullChat,
  onClose,
  onResetPosition,
  onDragStart,
}) {
  const activeProblem = context?.activeProblem || null;
  const selectedLanguage = context?.selectedLanguage || "Python";
  const attempts = context?.attempts ?? 0;
  const tutorMode = context?.tutorMode || "Guided Tutor";
  const topic = activeProblem?.title ? `Helping with: ${activeProblem.title}` : "Personal Code Help";
  const visibleMessages = isMaximized ? messages.slice(-24) : messages.slice(-10);
  const showThinking = isLoading && !visibleMessages.some(msg => msg.isStreaming && msg.text);

  return (
    <section className={`floating-chat-window ${isMaximized ? "maximized" : ""}`} aria-label="Coding tutor floating chat">
      <header className="floating-chat-header" onPointerDown={onDragStart}>
        <div>
          <span className="coding-kicker">Coding Tutor Chat</span>
          <strong>{topic}</strong>
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

      <div className="floating-chat-actions" aria-label="Coding tutor mode controls">
        {QUICK_ACTIONS.map(action => (
          <button
            key={action.label}
            type="button"
            className="floating-chat-action"
            onClick={() => onQuickAction(action.label)}
            disabled={isLoading || !hasCode}
            title={hasCode ? action.description : "Write or paste code in the workspace before choosing a tutor mode."}
          >
            {action.label}
          </button>
        ))}
      </div>

      {suggestedCodeBlock && onApplyAICode && (
        <button
          type="button"
          className="floating-apply-code-btn"
          onClick={onApplyAICode}
        >
          Apply AI Code to Workspace
        </button>
      )}

      <div className="floating-chat-messages">
        {visibleMessages.length ? visibleMessages.map((msg, index) => (
          <div key={`${msg.time || "message"}-${index}`} className={`floating-chat-message ${msg.sender}`}>
            {msg.isStreaming && !msg.text ? (
              <FloatingThinkingSteps steps={thinkingMessages} />
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: codeRenderer }}>
                {msg.text || ""}
              </ReactMarkdown>
            )}
          </div>
        )) : showThinking ? (
          <FloatingThinkingSteps steps={thinkingMessages} />
        ) : (
          <div className="floating-chat-empty">
            Paste code in the workspace, choose a tutor mode, then ask a focused question here.
          </div>
        )}
      </div>

      <form className="floating-chat-form" onSubmit={onSend}>
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
            disabled={isLoading || isSpeaking || isVoiceMode || !onVoiceInput}
          >
            <FaMicrophone aria-hidden="true" />
          </button>
          <textarea
            ref={inputRef}
            rows={isMaximized ? 4 : 2}
            value={input}
            onChange={onInputChange}
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
  const [position, setPosition] = useState(() => readSavedPosition(isOpen, isMaximized));
  const [isDragging, setIsDragging] = useState(false);
  const wasMaximizedRef = useRef(isMaximized);
  const lastNormalPositionRef = useRef(readSavedPosition(isOpen, false));

  const safePosition = useMemo(() => clampPosition(position, isOpen, isMaximized), [isMaximized, isOpen, position]);

  const applyPosition = useCallback((nextPosition) => {
    setPosition(prev => (
      prev.x === nextPosition.x && prev.y === nextPosition.y ? prev : nextPosition
    ));
  }, []);

  useEffect(() => {
    if (isMaximized && !wasMaximizedRef.current) {
      lastNormalPositionRef.current = clampPosition(position, isOpen, false);
    }
    if (!isMaximized && wasMaximizedRef.current) {
      applyPosition(clampPosition(lastNormalPositionRef.current, isOpen, false));
    } else {
      const nextPosition = position.x === null ? getDefaultPosition(isOpen, isMaximized) : position;
      applyPosition(clampPosition(nextPosition, isOpen, isMaximized));
    }
    wasMaximizedRef.current = isMaximized;
  }, [applyPosition, isMaximized, isOpen, position]);

  const savePosition = (nextPosition) => {
    const clamped = clampPosition(nextPosition, isOpen, isMaximized);
    setPosition(clamped);
    if (!isMaximized) lastNormalPositionRef.current = clamped;
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(clamped));
    } catch (error) {
      console.warn("[coding-chat] position save failed", error);
    }
  };

  const resetPosition = () => savePosition(getDefaultPosition(isOpen, isMaximized));

  const startDrag = (event) => {
    if (event.button !== 0 || event.target.closest?.("textarea, input, a, .floating-chat-window-controls button, .floating-chat-form button")) return;
    event.preventDefault();
    setIsDragging(true);
    const startX = event.clientX;
    const startY = event.clientY;
    const startPosition = safePosition;

    const handleMove = (moveEvent) => {
      setPosition(clampPosition({
        x: startPosition.x + moveEvent.clientX - startX,
        y: startPosition.y + moveEvent.clientY - startY,
      }, isOpen, isMaximized));
    };

    const handleUp = (upEvent) => {
      setIsDragging(false);
      savePosition({
        x: startPosition.x + upEvent.clientX - startX,
        y: startPosition.y + upEvent.clientY - startY,
      });
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  return (
    <div
      className={`floating-coding-chat ${isOpen ? "open" : "closed"} ${isDragging ? "dragging" : ""} ${isMaximized ? "maximized" : ""}`}
      style={isOpen ? { left: `${safePosition.x}px`, top: `${safePosition.y}px` } : undefined}
    >
      {isOpen ? (
        <FloatingChatWindow
          {...windowProps}
          isMaximized={isMaximized}
          onDragStart={startDrag}
          onResetPosition={resetPosition}
        />
      ) : (
        <FloatingChatButton onOpen={onOpen} />
      )}
    </div>
  );
}
