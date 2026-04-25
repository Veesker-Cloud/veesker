export const PROGRESS_KEY = 'veesker_help_progress';

export function loadProgress(): Set<string> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function saveProgress(progress: Set<string>): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...progress]));
  } catch {
    // localStorage unavailable in this environment — silently skip
  }
}

export function markStepDone(
  progress: Set<string>,
  moduleId: string,
  stepIndex: number,
): Set<string> {
  const next = new Set(progress);
  next.add(`${moduleId}:${stepIndex}`);
  return next;
}

export function isModuleDone(
  progress: Set<string>,
  moduleId: string,
  stepCount: number,
): boolean {
  for (let i = 0; i < stepCount; i++) {
    if (!progress.has(`${moduleId}:${i}`)) return false;
  }
  return true;
}

export function overallProgress(
  modules: { id: string; steps: unknown[] }[],
  progress: Set<string>,
): number {
  const totalSteps = modules.reduce((s, m) => s + m.steps.length, 0);
  if (totalSteps === 0) return 0;
  return Math.round((progress.size / totalSteps) * 100);
}
