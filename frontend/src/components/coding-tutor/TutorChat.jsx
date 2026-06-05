import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function TutorChat({
  messages,
  input,
  isLoading,
  onInputChange,
  onSendMessage,
  codeRenderer,
  variant = "panel",
}) {
  const submitMessage = (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    onSendMessage(text);
  };

  return (
    <div className={`tutor-chat tutor-chat-${variant}`}>
      <div className="ai-panel-messages tutor-chat-messages">
        {messages.length ? messages.slice(-8).map((msg, index) => (
          <div key={index} className={`ai-panel-message ${msg.sender}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: codeRenderer }}>
              {msg.text || (msg.isStreaming ? "Thinking..." : "")}
            </ReactMarkdown>
          </div>
        )) : <div className="ai-panel-empty">Ask for a hint, debug step, or review after trying the problem.</div>}
      </div>
      <form className="ai-panel-input tutor-chat-input" onSubmit={submitMessage}>
        <textarea
          rows={2}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="Ask about this problem or your code..."
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>Send</button>
      </form>
    </div>
  );
}
