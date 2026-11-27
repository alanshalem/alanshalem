import { renderHeader } from './cards/header.ts';
import { renderLanguages } from './cards/languages.ts';
import { renderProject } from './cards/project.ts';
import { renderStack } from './cards/stack.ts';
import { renderStats } from './cards/stats.ts';
import { renderStreak } from './cards/streak.ts';
import { renderTrophies } from './cards/trophies.ts';
import type { ProfileData } from './model.ts';

/** Every README image (file name in assets/profile/ → SVG), in the order they appear. */
export function renderProfile(data: ProfileData): Record<string, string> {
  return {
    'header.svg': renderHeader(),
    'stack.svg': renderStack(),
    'project.svg': renderProject(),
    'stats.svg': renderStats(data),
    'languages.svg': renderLanguages(data),
    'streak.svg': renderStreak(data),
    'trophies.svg': renderTrophies(data),
  };
}
