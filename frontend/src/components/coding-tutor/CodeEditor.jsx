export default function CodeEditor({ code, note, onCodeChange, onNoteChange }) {
  return (
    <>
      <textarea
        className="coding-editor leetcode-editor"
        value={code}
        onChange={(event) => onCodeChange(event.target.value)}
        placeholder="Paste code for review, or load a Quiz Bank problem and write your attempt here."
        spellCheck="false"
      />
      <textarea
        className="coding-note compact-note"
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
        placeholder="Optional note for the tutor..."
      />
    </>
  );
}
