export function problemHasVisualizer(problem) {
  return Boolean(problem?.visualizer?.concept && problem.visualizer.title && problem.visualizer.caption);
}
