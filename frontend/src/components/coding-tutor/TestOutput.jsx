export default function TestOutput({ testOutput, expanded = false }) {
  return (
    <div className={`coding-terminal ${expanded ? "expanded" : ""}`} aria-live="polite">
      <div className="coding-terminal-header"><span>Test Output</span><span>Non-executing V1</span></div>
      <pre>{testOutput}</pre>
    </div>
  );
}
