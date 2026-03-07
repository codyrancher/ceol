import type { AppTemplate } from './types';
import { vue3Template } from './vue3';
import { vue3ExpressPgTemplate } from './vue3-express-pg';

export type { AppTemplate } from './types';

export const templates: AppTemplate[] = [
  vue3Template,
  vue3ExpressPgTemplate,
];

export function getTemplate(id: string): AppTemplate | undefined {
  return templates.find((t) => t.id === id);
}
