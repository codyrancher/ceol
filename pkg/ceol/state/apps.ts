import { getTemplate } from '../app-templates';
import { listRepos, deleteRepo, ensureGiteaAdmin } from '../app-templates/gitea';
import type { GiteaRepo } from '../app-templates/gitea';
import { saveAppMeta } from './builds';

export interface App {
  id: string;
  name: string;
  logo: string;
  repoName: string;
  description: string;
  createdAt: string;
}

function repoLogo(name: string): string {
  const letter = name.charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#42b883"/><text x="32" y="44" text-anchor="middle" font-size="32" font-family="sans-serif" fill="white">${ letter }</text></svg>`;

  return `data:image/svg+xml,${ encodeURIComponent(svg) }`;
}

function repoToApp(repo: GiteaRepo): App {
  return {
    id:          repo.name,
    name:        repo.name,
    logo:        repoLogo(repo.name),
    repoName:    repo.name,
    description: repo.description,
    createdAt:   repo.created_at,
  };
}

export async function fetchApps(store: any): Promise<App[]> {
  const repos = await listRepos(store);

  return repos.map(repoToApp);
}

export async function createApp(store: any, name: string, templateId: string): Promise<App> {
  const template = getTemplate(templateId);

  if (!template) {
    throw new Error(`Unknown template: ${ templateId }`);
  }

  await template.init(store, name);

  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Persist template ID so deploy can provision template-specific infra
  await saveAppMeta(store, safeName, templateId);

  return {
    id:          safeName,
    name:        safeName,
    logo:        repoLogo(safeName),
    repoName:    safeName,
    description: `Ceol app: ${ safeName }`,
    createdAt:   new Date().toISOString(),
  };
}

export async function deleteApp(store: any, repoName: string): Promise<void> {
  const owner = await ensureGiteaAdmin(store);

  await deleteRepo(store, owner, repoName);
}
