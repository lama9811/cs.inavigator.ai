import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { highlightCode } from "../../lib/highlight";

function getLineIndent(line) {
  return line.match(/^\s*/)?.[0] || "";
}

function shouldIncreaseIndent(line) {
  return /:\s*(#.*)?$/.test(line.trimEnd()) || /[{[(]\s*$/.test(line.trimEnd());
}

function opensCodeBlock(line) {
  const trimmed = line.trimEnd();
  return /:\s*(#.*)?$/.test(trimmed) || /\{\s*(\/\/.*)?$/.test(trimmed);
}

// Auto-close pairs. The closing char is inserted after the opening one.
const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
const CLOSERS = new Set(Object.values(PAIRS));
const OPENERS = new Set(Object.keys(PAIRS));
const INDENT = "    ";
const INDENT_LEN = INDENT.length;
const EDITOR_LINE_HEIGHT_EM = 1.55;

function getIndentLevel(line) {
  return Math.floor(getLineIndent(line).replace(/\t/g, INDENT).length / INDENT_LEN);
}

function getActiveBlockGuide(lines, activeIndex) {
  const safeIndex = Math.min(Math.max(activeIndex, 0), lines.length - 1);
  const stack = [];

  for (let index = 0; index <= safeIndex; index += 1) {
    const line = lines[index] || "";
    if (!line.trim()) continue;

    const indentLevel = getIndentLevel(line);
    while (
      stack.length > 0 &&
      index > stack[stack.length - 1].ownerIndex &&
      indentLevel <= stack[stack.length - 1].ownerLevel
    ) {
      stack.pop();
    }

    if (opensCodeBlock(line)) {
      stack.push({
        ownerIndex: index,
        ownerLevel: indentLevel,
        bodyLevel: indentLevel + 1,
      });
    }
  }

  const owner = stack[stack.length - 1];
  if (!owner) return null;

  const start = owner.ownerIndex + 1;
  let end = start - 1;

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] || "";
    if (line.trim().length > 0 && getIndentLevel(line) <= owner.ownerLevel) {
      break;
    }
    end = index;
  }

  if (end < start) return null;

  return {
    level: owner.bodyLevel,
    start,
    lines: end - start + 1,
  };
}

export default function CodeEditor({ code, onCodeChange, onCursorChange, language }) {
  const textareaRef = useRef(null);
  const gutterRef = useRef(null);
  const highlightRef = useRef(null);
  const guideRef = useRef(null);
  const historyRef = useRef([{ code: code || "", selectionStart: 0, selectionEnd: 0 }]);
  const historyIndexRef = useRef(0);
  const pendingLocalCodeRef = useRef(null);
  const [activeLine, setActiveLine] = useState(1);

  // Syntax-colored HTML for the overlay. Trailing newline keeps overlay height
  // in sync with the textarea so the last line never clips.
  const highlightedHtml = useMemo(
    () => highlightCode(code + "\n", language),
    [code, language]
  );

  const lineCount = useMemo(() => {
    const n = (code ? code.split("\n").length : 1);
    return Math.max(n, 1);
  }, [code]);

  const editorLines = useMemo(() => {
    const lines = code ? code.split("\n") : [""];
    return lines.length ? lines : [""];
  }, [code]);

  const activeIndentGuide = useMemo(() => {
    return getActiveBlockGuide(editorLines, activeLine - 1);
  }, [activeLine, editorLines]);

  // Keep the gutter and the highlight overlay scrolled in lockstep with the textarea.
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = ta.scrollTop;
      highlightRef.current.scrollLeft = ta.scrollLeft;
    }
    if (guideRef.current) {
      guideRef.current.scrollTop = ta.scrollTop;
      guideRef.current.scrollLeft = ta.scrollLeft;
    }
  }, []);

  // Report the caret line/column (for the status bar) and track the active line.
  const reportCaret = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const upto = el.value.slice(0, el.selectionStart);
    const line = upto.split("\n").length;
    const col = upto.length - upto.lastIndexOf("\n");
    setActiveLine(line);
    onCursorChange?.({ line, col, chars: el.value.length });
  }, [onCursorChange]);

  useEffect(() => {
    reportCaret();
  }, [code, reportCaret]);

  useEffect(() => {
    if (pendingLocalCodeRef.current === code) {
      pendingLocalCodeRef.current = null;
      return;
    }
    historyRef.current = [{ code: code || "", selectionStart: 0, selectionEnd: 0 }];
    historyIndexRef.current = 0;
  }, [code]);

  const rememberEdit = (nextCode, selectionStart, selectionEnd = selectionStart) => {
    const history = historyRef.current.slice(0, historyIndexRef.current + 1);
    const last = history[history.length - 1];

    if (last?.code === nextCode) {
      history[history.length - 1] = { code: nextCode, selectionStart, selectionEnd };
      historyRef.current = history;
      historyIndexRef.current = history.length - 1;
      return;
    }

    history.push({ code: nextCode, selectionStart, selectionEnd });
    while (history.length > 100) history.shift();
    historyRef.current = history;
    historyIndexRef.current = history.length - 1;
  };

  const applyEditorChange = (textarea, nextValue, caretStart, caretEnd = caretStart) => {
    pendingLocalCodeRef.current = nextValue;
    rememberEdit(nextValue, caretStart, caretEnd);
    onCodeChange(nextValue);
    requestAnimationFrame(() => {
      textarea.selectionStart = caretStart;
      textarea.selectionEnd = caretEnd;
      reportCaret();
    });
  };

  const restoreHistory = (textarea, direction) => {
    const history = historyRef.current;
    const currentIndex = historyIndexRef.current;
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), history.length - 1);
    if (nextIndex === currentIndex) return;

    const entry = history[nextIndex];
    historyIndexRef.current = nextIndex;
    pendingLocalCodeRef.current = entry.code;
    onCodeChange(entry.code);
    requestAnimationFrame(() => {
      textarea.selectionStart = entry.selectionStart;
      textarea.selectionEnd = entry.selectionEnd;
      reportCaret();
    });
  };

  // Apply a text replacement and place the caret, going through onCodeChange so
  // React stays the source of truth.
  const applyEdit = (textarea, nextValue, caretStart, caretEnd = caretStart) => {
    applyEditorChange(textarea, nextValue, caretStart, caretEnd);
  };

  const handleEditorKeyDown = (event) => {
    const textarea = event.currentTarget;
    const { selectionStart, selectionEnd, value } = textarea;
    const indent = "    ";
    const charBefore = value[selectionStart - 1];
    const charAfter = value[selectionStart];
    const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey;
    const isRedo = ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y")
      || ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "z");

    if (isUndo || isRedo) {
      event.preventDefault();
      restoreHistory(textarea, isUndo ? -1 : 1);
      return;
    }

    // Auto-close brackets and quotes.
    if (OPENERS.has(event.key)) {
      event.preventDefault();
      const open = event.key;
      const close = PAIRS[open];
      if (selectionStart !== selectionEnd) {
        // Wrap the current selection: open + selection + close.
        const selected = value.slice(selectionStart, selectionEnd);
        const next = value.slice(0, selectionStart) + open + selected + close + value.slice(selectionEnd);
        applyEdit(textarea, next, selectionStart + 1, selectionEnd + 1);
        return;
      }
      // For quotes, don't auto-close right before a word char (e.g. mid-token).
      const isQuote = open === '"' || open === "'" || open === "`";
      const nextIsWord = charAfter && /[\w]/.test(charAfter);
      if (isQuote && (charBefore && /[\w]/.test(charBefore) || nextIsWord)) {
        const next = value.slice(0, selectionStart) + open + value.slice(selectionStart);
        applyEdit(textarea, next, selectionStart + 1);
        return;
      }
      const next = value.slice(0, selectionStart) + open + close + value.slice(selectionStart);
      applyEdit(textarea, next, selectionStart + 1);
      return;
    }

    // Skip over an auto-inserted closer.
    if (CLOSERS.has(event.key) && charAfter === event.key && selectionStart === selectionEnd) {
      event.preventDefault();
      applyEdit(textarea, value, selectionStart + 1);
      return;
    }

    // Backspace.
    if (event.key === "Backspace" && selectionStart === selectionEnd) {
      // Delete an empty auto-closed pair in one stroke: ()| -> |
      if (OPENERS.has(charBefore) && PAIRS[charBefore] === charAfter) {
        event.preventDefault();
        const next = value.slice(0, selectionStart - 1) + value.slice(selectionStart + 1);
        applyEdit(textarea, next, selectionStart - 1);
        return;
      }

      // Smart-backspace for indentation. Code editors treat four leading spaces
      // like one tab stop, so Backspace should step back one indent level instead
      // of unexpectedly joining/removing the whole line.
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
      const lineEndIndex = value.indexOf("\n", selectionStart);
      const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
      const before = value.slice(lineStart, selectionStart);
      const after = value.slice(selectionStart, lineEnd);

      if (before.length > 0 && /^[ \t]+$/.test(before)) {
        event.preventDefault();
        const remove = before.endsWith("\t")
          ? 1
          : ((before.replace(/\t/g, INDENT).length - 1) % INDENT_LEN) + 1;
        const next = value.slice(0, selectionStart - remove) + value.slice(selectionStart);
        applyEdit(textarea, next, selectionStart - remove);
        return;
      }

      if (before.length === 0 && /^[ \t]+/.test(after)) {
        event.preventDefault();
        const nextIndent = after.match(/^[ \t]+/)?.[0] || "";
        const remove = nextIndent.startsWith("\t") ? 1 : Math.min(INDENT_LEN, nextIndent.length);
        const next = value.slice(0, selectionStart) + value.slice(selectionStart + remove);
        applyEdit(textarea, next, selectionStart);
        return;
      }
    }

    if (
      event.key === "Delete" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      if (selectionStart !== selectionEnd) {
        const next = value.slice(0, selectionStart) + value.slice(selectionEnd);
        applyEdit(textarea, next, selectionStart);
        return;
      }
      if (selectionStart < value.length) {
        const next = value.slice(0, selectionStart) + value.slice(selectionStart + 1);
        applyEdit(textarea, next, selectionStart);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
      const currentLine = value.slice(lineStart, selectionStart);
      const currentIndent = getLineIndent(currentLine);
      const extraIndent = shouldIncreaseIndent(currentLine) ? indent : "";
      const insertion = `\n${currentIndent}${extraIndent}`;
      const nextValue = value.slice(0, selectionStart) + insertion + value.slice(selectionEnd);
      const nextCursor = selectionStart + insertion.length;
      applyEditorChange(textarea, nextValue, nextCursor);
      return;
    }

    if (event.key !== "Tab") return;

    event.preventDefault();

    if (event.shiftKey) {
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
      const selectedText = value.slice(lineStart, selectionEnd);
      const outdentedText = selectedText.replace(/^( {1,4}|\t)/gm, "");
      const nextValue = value.slice(0, lineStart) + outdentedText + value.slice(selectionEnd);
      const removed = selectedText.length - outdentedText.length;
      const nextStart = Math.max(lineStart, selectionStart - Math.min(4, removed));
      const nextEnd = Math.max(nextStart, selectionEnd - removed);
      applyEditorChange(textarea, nextValue, nextStart, nextEnd);
      return;
    }

    if (selectionStart !== selectionEnd && value.slice(selectionStart, selectionEnd).includes("\n")) {
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
      const selectedText = value.slice(lineStart, selectionEnd);
      const indentedText = selectedText.replace(/^/gm, indent);
      const nextValue = value.slice(0, lineStart) + indentedText + value.slice(selectionEnd);
      applyEditorChange(
        textarea,
        nextValue,
        selectionStart + indent.length,
        selectionEnd + (indentedText.length - selectedText.length),
      );
      return;
    }

    const nextValue = value.slice(0, selectionStart) + indent + value.slice(selectionEnd);
    applyEditorChange(textarea, nextValue, selectionStart + indent.length);
  };

  return (
    <div className="code-editor-shell">
      <div className="code-editor-gutter" ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => (
          <span
            key={i}
            className={`code-editor-line-no ${i + 1 === activeLine ? "active" : ""}`}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <div className="code-editor-input-wrap">
        {activeIndentGuide && (
          <div ref={guideRef} className="code-editor-active-indent-layer" aria-hidden="true">
            <span
              className="code-editor-active-indent-guide"
              style={{
                "--guide-level": String(activeIndentGuide.level),
                "--guide-top": `${activeIndentGuide.start * EDITOR_LINE_HEIGHT_EM}em`,
                "--guide-height": `${activeIndentGuide.lines * EDITOR_LINE_HEIGHT_EM}em`,
              }}
            />
          </div>
        )}
        {/* Colored layer behind the transparent textarea. Must share the same
            font metrics + padding as the textarea so the colors stay aligned. */}
        <pre
          ref={highlightRef}
          className="code-editor-highlight"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
        <textarea
          ref={textareaRef}
          className="coding-editor leetcode-editor code-editor-textarea"
          value={code}
          onChange={(event) => {
            pendingLocalCodeRef.current = event.target.value;
            rememberEdit(event.target.value, event.target.selectionStart, event.target.selectionEnd);
            onCodeChange(event.target.value);
          }}
          onKeyDown={handleEditorKeyDown}
          onScroll={syncScroll}
          onClick={reportCaret}
          onKeyUp={reportCaret}
          onSelect={reportCaret}
          placeholder="Paste code for review, or load a Practice Library problem and write your attempt here."
          spellCheck="false"
          wrap="off"
        />
      </div>
    </div>
  );
}
