import TutorModeToggle from "../TutorModeToggle";

export default function ChatHeader({
  isLoading,
  showTutorModeToggle,
  chatMode,
  onTutorModeChange,
  isCodingWorkspaceRoute,
  isCodingChatRoute,
  onBackHome,
  onOpenCodingWorkspace,
}) {
  return (
    <div className="model-selector-header">
      <div className="chat-controls-header">
        {showTutorModeToggle && (
          <TutorModeToggle chatMode={chatMode} isLoading={isLoading} onChange={onTutorModeChange} />
        )}
        {isCodingWorkspaceRoute && (
          <button type="button" className="header-home-btn" onClick={onBackHome}>
            Back to Home
          </button>
        )}
        {isCodingChatRoute && (
          <button type="button" className="header-home-btn" onClick={onOpenCodingWorkspace}>
            Open Coding Workspace
          </button>
        )}
      </div>
    </div>
  );
}
