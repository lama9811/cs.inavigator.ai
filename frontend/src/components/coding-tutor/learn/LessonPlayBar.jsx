import { FaPlay, FaPause, FaStepBackward, FaStepForward, FaHeadphones } from "react-icons/fa";
import { useLessonSpeech } from "./useLessonSpeech";

// A "listen to this lesson" play bar, powered by useLessonSpeech (free browser TTS).
//
// The Web Speech API has no seekable timeline, so this is honest about its unit: it
// tracks SEGMENTS ("Section 3 / 12"), skips by segment, and shows a progress bar of
// position-through-the-lesson — not a 1:23 / 4:00 clock, which the API can't provide.
export default function LessonPlayBar({ lesson }) {
  const speech = useLessonSpeech(lesson);

  // If the browser has no speech support (or the lesson has nothing to read), render
  // nothing rather than a dead control.
  if (!speech.supported) return null;

  const { isPlaying, index, total } = speech;
  // Spoken position is 1-based for display; the bar fills as segments complete.
  const current = Math.min(index + 1, total);
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="lesson-playbar" role="group" aria-label="Listen to this lesson">
      <span className="lesson-playbar-icon" aria-hidden="true">
        <FaHeadphones />
      </span>

      <div className="lesson-playbar-controls">
        <button
          type="button"
          className="lesson-playbar-btn"
          onClick={speech.prev}
          disabled={index <= 0}
          aria-label="Previous section"
          title="Previous section"
        >
          <FaStepBackward aria-hidden="true" />
        </button>

        <button
          type="button"
          className="lesson-playbar-btn is-primary"
          onClick={isPlaying ? speech.pause : speech.play}
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause" : "Listen to this lesson"}
        >
          {isPlaying ? <FaPause aria-hidden="true" /> : <FaPlay aria-hidden="true" />}
        </button>

        <button
          type="button"
          className="lesson-playbar-btn"
          onClick={speech.next}
          disabled={index >= total - 1}
          aria-label="Next section"
          title="Next section"
        >
          <FaStepForward aria-hidden="true" />
        </button>
      </div>

      <div className="lesson-playbar-progress">
        <div className="lesson-playbar-track" aria-hidden="true">
          <span className="lesson-playbar-fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="lesson-playbar-count" aria-live="polite">
          Section {current} / {total}
        </span>
      </div>
    </div>
  );
}
