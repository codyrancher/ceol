import type { AppTemplate } from '../types';
import { generateFiles } from './files';
import { ensureGiteaAdmin, createRepo, deleteRepo, pushFiles } from '../gitea';

function generateLogo(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="12" fill="#35495e"/>
    <polygon points="32,14 47,42 41,42 32,26 23,42 17,42" fill="#42b883"/>
    <polygon points="32,18 40,32 37,32 32,23 27,32 24,32" fill="#35495e"/>
  </svg>`;

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
