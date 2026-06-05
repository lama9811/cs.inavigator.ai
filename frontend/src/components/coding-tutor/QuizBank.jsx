import QuizProblemCard from "./QuizProblemCard";

function titleCase(value = "") {
  return value ? value[0].toUpperCase() + value.slice(1).replace("_", " ") : "";
}

export default function QuizBank({
  questions,
  progressByQuestion,
  listLoading,
  difficulty,
  selectedLanguage,
  languageOptions,
  progressSummary,
  onDifficultyChange,
  onLanguageChange,
  onSelectProblem,
}) {
  const topics = [...new Set(questions.slice(0, 8).map(question => question.topic))];

  return (
    <section className="coding-page-panel quiz-bank-page">
      <section className="practice-progress-overview">
        <div>
          <span className="coding-kicker">Progress Overview</span>
          <strong>{progressSummary.completionPercent}% complete</strong>
        </div>
        <div className="progress-bar" aria-label={`${progressSummary.completionPercent}% complete`}>
          <span style={{ width: `${progressSummary.completionPercent}%` }} />
        </div>
        <div className="progress-overview-stats">
          <span>{progressSummary.solvedCount} Solved</span>
          <span>{progressSummary.attemptedCount} Attempted</span>
          <span>{progressSummary.displayStreak} Day Streak</span>
        </div>
      </section>
      <div className="quiz-bank-layout">
        <div className="quiz-library">
          <div className="quiz-bank-header">
            <div>
              <span className="coding-kicker">Question Library</span>
              <h2>{titleCase(difficulty)} Practice</h2>
            </div>
            <div className="practice-controls compact">
              <label>Difficulty
                <select className="coding-select" value={difficulty} onChange={(event) => onDifficultyChange(event.target.value)}>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </label>
              <label>Language
                <select className="coding-select" value={selectedLanguage} onChange={(event) => onLanguageChange(event.target.value)}>
                  {languageOptions.map(language => <option key={language} value={language}>{language}</option>)}
                </select>
              </label>
            </div>
          </div>
          {listLoading ? <div className="daily-challenge-loading">Loading CS Navigator practice...</div> : (
            <div className="quiz-card-grid">
              {questions.map(question => (
                <QuizProblemCard
                  key={question.id}
                  question={question}
                  progress={progressByQuestion[question.id]}
                  onSelect={onSelectProblem}
                />
              ))}
            </div>
          )}
        </div>
        <aside className="quiz-insight-panel">
          <section>
            <h3>Topics Covered</h3>
            {topics.map(topic => <p key={topic}>Done {topic}</p>)}
          </section>
          <section>
            <h3>Learning Objectives</h3>
            <p>String normalization</p>
            <p>Character comparison</p>
            <p>Edge case reasoning</p>
          </section>
          <section>
            <h3>Common Mistakes</h3>
            <p>Forgetting lowercase conversion</p>
            <p>Ignoring spaces or punctuation</p>
            <p>Using extra loops when two pointers would work</p>
          </section>
        </aside>
      </div>
    </section>
  );
}
