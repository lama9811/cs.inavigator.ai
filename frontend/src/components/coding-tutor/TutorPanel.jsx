import TutorChat from "./TutorChat";
import TutorQuickActions from "./TutorQuickActions";
import TutorStatusCard from "./TutorStatusCard";

export default function TutorPanel({
  activeProblem,
  selectedLanguage,
  attempts,
  tutorMode,
  messages,
  input,
  isLoading,
  onInputChange,
  onQuickAction,
  onSendMessage,
  codeRenderer,
}) {
  return (
    <aside className="coding-ai-panel tutor-panel">
      <TutorStatusCard
        activeProblem={activeProblem}
        selectedLanguage={selectedLanguage}
        attempts={attempts}
        tutorMode={tutorMode}
      />
      <TutorQuickActions isLoading={isLoading} onQuickAction={onQuickAction} />
      <TutorChat
        messages={messages}
        input={input}
        isLoading={isLoading}
        onInputChange={onInputChange}
        onSendMessage={onSendMessage}
        codeRenderer={codeRenderer}
      />
    </aside>
  );
}
