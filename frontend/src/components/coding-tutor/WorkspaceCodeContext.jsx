export default function WorkspaceCodeContext({ code, activeProblem, attempts = 0 }) {
  const trimmedCode = code?.trim();
  if (!trimmedCode) return null;

  const label = activeProblem?.title ? `Workspace code: ${activeProblem.title}` : "Workspace code";

  return (
    <details className="floating-code-context">
      <summary>
        <span>{label}</span>
        <small>{attempts} attempts</small>
      </summary>
      <pre><code>{trimmedCode}</code></pre>
    </details>
  );
}
