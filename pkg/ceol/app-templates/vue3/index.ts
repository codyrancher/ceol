import type { AppTemplate } from '../types';
import { generateFiles } from './files';
import { ensureGiteaAdmin, createRepo, deleteRepo, pushFiles } from '../gitea';

function generateLogo(appName: string): string {
  const letter = appName.charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#42b883"/><text x="32" y="44" text-anchor="middle" font-size="32" font-family="sans-serif" fill="white">${ letter }</text></svg>`;

  return `data:image/svg+xml,${ encodeURIComponent(svg) }`;
}

export const vue3Template: AppTemplate = {
  id:          'vue3',
  name:        'Vue 3',
  description: 'Vue 3 hello world app with Vite, TypeScript, and Docker support',

  logo: generateLogo,

  files: generateFiles,

  async init(store, appName) {
    const owner = await ensureGiteaAdmin(store);
    const safeName = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    await createRepo(store, safeName);

    const files = generateFiles(appName);

    await pushFiles(store, owner, safeName, files);
  },

  async destroy(store, appName) {
    const owner = await ensureGiteaAdmin(store);
    const safeName = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    await deleteRepo(store, owner, safeName);
  },
};
