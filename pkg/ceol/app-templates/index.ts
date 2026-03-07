import type { AppTemplate } from './types';
import { vue3Template } from './vue3';

export type { AppTemplate } from './types';

export const templates: AppTemplate[] = [
  vue3Template,
];

export function getTemplate(id: string): AppTemplate | undefined {
  return templates.find((t) => t.id === id);
}
