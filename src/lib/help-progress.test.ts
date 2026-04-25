import { describe, it, expect } from 'vitest';
import {
  markStepDone,
  isModuleDone,
  overallProgress,
} from './help-progress';

describe('markStepDone', () => {
  it('adds the moduleId:stepIndex key', () => {
    const result = markStepDone(new Set(), 'getting-started', 0);
    expect(result.has('getting-started:0')).toBe(true);
  });

  it('does not mutate the original set', () => {
    const original = new Set<string>();
    markStepDone(original, 'getting-started', 0);
    expect(original.size).toBe(0);
  });

  it('preserves existing entries', () => {
    const existing = new Set(['mod:0']);
    const result = markStepDone(existing, 'mod', 1);
    expect(result.has('mod:0')).toBe(true);
    expect(result.has('mod:1')).toBe(true);
  });
});

describe('isModuleDone', () => {
  it('returns true when all steps are present', () => {
    const progress = new Set(['mod:0', 'mod:1', 'mod:2']);
    expect(isModuleDone(progress, 'mod', 3)).toBe(true);
  });

  it('returns false when the first step is missing', () => {
    const progress = new Set(['mod:1', 'mod:2']);
    expect(isModuleDone(progress, 'mod', 3)).toBe(false);
  });

  it('returns false when a middle step is missing', () => {
    const progress = new Set(['mod:0', 'mod:2']);
    expect(isModuleDone(progress, 'mod', 3)).toBe(false);
  });

  it('returns false for an empty progress set', () => {
    expect(isModuleDone(new Set(), 'mod', 3)).toBe(false);
  });

  it('returns true for a single-step module', () => {
    const progress = new Set(['mod:0']);
    expect(isModuleDone(progress, 'mod', 1)).toBe(true);
  });
});

describe('overallProgress', () => {
  const modules = [
    { id: 'a', steps: [{}, {}] },
    { id: 'b', steps: [{}] },
  ];

  it('returns 0 when no steps completed', () => {
    expect(overallProgress(modules, new Set())).toBe(0);
  });

  it('returns 100 when all steps completed', () => {
    const progress = new Set(['a:0', 'a:1', 'b:0']);
    expect(overallProgress(modules, progress)).toBe(100);
  });

  it('rounds to nearest integer', () => {
    const progress = new Set(['a:0']); // 1 of 3 = 33.33%
    expect(overallProgress(modules, progress)).toBe(33);
  });

  it('returns 0 for an empty module list', () => {
    expect(overallProgress([], new Set())).toBe(0);
  });
});
