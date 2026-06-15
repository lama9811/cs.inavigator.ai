function getLineIndent(line) {
  return line.match(/^\s*/)?.[0] || "";
}

function shouldIncreaseIndent(line) {
  return /:\s*(#.*)?$/.test(line.trimEnd()) || /[{[(]\s*$/.test(line.trimEnd());
}

export default function CodeEditor({ code, onCodeChange }) {
  const handleEditorKeyDown = (event) => {
    const textarea = event.currentTarget;
    const { selectionStart, selectionEnd, value } = textarea;
    const indent = "    ";

    if (event.key === "Enter") {
      event.preventDefault();
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
      const currentLine = value.slice(lineStart, selectionStart);
      const currentIndent = getLineIndent(currentLine);
      const extraIndent = shouldIncreaseIndent(currentLine) ? indent : "";
      const insertion = `\n${currentIndent}${extraIndent}`;
      const nextValue = value.slice(0, selectionStart) + insertion + value.slice(selectionEnd);
      onCodeChange(nextValue);
      requestAnimationFrame(() => {
        const nextCursor = selectionStart + insertion.length;
        textarea.selectionStart = nextCursor;
        textarea.selectionEnd = nextCursor;
      });
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
      onCodeChange(nextValue);
      requestAnimationFrame(() => {
        textarea.selectionStart = Math.max(lineStart, selectionStart - Math.min(4, removed));
        textarea.selectionEnd = Math.max(textarea.selectionStart, selectionEnd - removed);
      });
      return;
    }

    if (selectionStart !== selectionEnd && value.slice(selectionStart, selectionEnd).includes("\n")) {
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
      const selectedText = value.slice(lineStart, selectionEnd);
      const indentedText = selectedText.replace(/^/gm, indent);
      const nextValue = value.slice(0, lineStart) + indentedText + value.slice(selectionEnd);
      onCodeChange(nextValue);
      requestAnimationFrame(() => {
        textarea.selectionStart = selectionStart + indent.length;
        textarea.selectionEnd = selectionEnd + (indentedText.length - selectedText.length);
      });
      return;
    }

    const nextValue = value.slice(0, selectionStart) + indent + value.slice(selectionEnd);
    onCodeChange(nextValue);
    requestAnimationFrame(() => {
      textarea.selectionStart = selectionStart + indent.length;
      textarea.selectionEnd = selectionStart + indent.length;
    });
  };

  return (
    <>
      <textarea
        className="coding-editor leetcode-editor"
        value={code}
        onChange={(event) => onCodeChange(event.target.value)}
        onKeyDown={handleEditorKeyDown}
        placeholder="Paste code for review, or load a Quiz Bank problem and write your attempt here."
        spellCheck="false"
      />
    </>
  );
}
