// At-a-glance momentum tiles: streak, solved, attempted, % complete.
// Reuses progressSummary (no new data). Shared by the Home dashboard, Quiz Bank,
// and the Progress tab so the progress UI is consistent everywhere.
// Icons come from the existing react-icons/fa library (not emoji) to match the
// rest of the Coding Lab and the ProgressBadges cards.
import { FaFire, FaCheckCircle, FaPenFancy, FaChartLine } from "react-icons/fa";

export default function StatTiles({ progressSummary }) {
  const tiles = [
    { key: "streak", Icon: FaFire, value: progressSummary.displayStreak, label: "Day streak" },
    { key: "solved", Icon: FaCheckCircle, value: progressSummary.solvedCount, label: "Solved" },
    { key: "attempted", Icon: FaPenFancy, value: progressSummary.attemptedCount, label: "Attempted" },
    { key: "complete", Icon: FaChartLine, value: `${progressSummary.completionPercent}%`, label: "Problems complete" },
  ];
  return (
    <div className="coding-stat-tiles" aria-label="Your coding progress at a glance">
      {tiles.map((tile) => {
        const Icon = tile.Icon;
        // The streak flame stays cold/grey at 0 and "catches fire" (flicker + glow)
        // once a streak begins, so starting a streak feels rewarding.
        const isLitStreak = tile.key === "streak" && Number(progressSummary.displayStreak) > 0;
        return (
          <div className={`coding-stat-tile stat-${tile.key}`} key={tile.key}>
            <span className={`coding-stat-icon${isLitStreak ? " flame-lit" : ""}`} aria-hidden="true"><Icon /></span>
            <strong className="coding-stat-value">{tile.value}</strong>
            <span className="coding-stat-label">{tile.label}</span>
          </div>
        );
      })}
    </div>
  );
}
