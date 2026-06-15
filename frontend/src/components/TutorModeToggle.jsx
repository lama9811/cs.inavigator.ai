const CHAT_MODES = [
  { id: "regular", name: "Regular Tutor" },
  { id: "coding_tutor", name: "Coding Tutor" },
];

export default function TutorModeToggle({ chatMode, isLoading, onChange }) {
  return (
    <div className="mode-segmented" role="group" aria-label="Tutor mode">
      {CHAT_MODES.map(mode => (
        <button
          key={mode.id}
          type="button"
          className={`mode-segmented-btn ${chatMode === mode.id ? "active" : ""}`}
          onClick={() => onChange(mode.id)}
          disabled={isLoading}
        >
          {mode.name}
        </button>
      ))}
    </div>
  );
}
