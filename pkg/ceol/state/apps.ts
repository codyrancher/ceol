import { getTemplate } from '../app-templates';
import { listRepos, deleteRepo, ensureGiteaAdmin } from '../app-templates/gitea';
import type { GiteaRepo } from '../app-templates/gitea';
import { saveAppMeta, getAppMeta, getBuildStatus } from './builds';
import { isPinned, togglePin, syncPinnedProducts } from './pins';
import { resolveUsername } from './auth';

export interface App {
  id: string;
  name: string;
  logo: string;
  icon: string;
  repoName: string;
  description: string;
  createdAt: string;
  templateId: string;
  createdBy: string;
  prodDeployed: boolean;
}

function templateLogo(templateId: string): string {
  const template = getTemplate(templateId);

  if (template) {
    return template.logo('');
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#42b883"/><text x="32" y="44" text-anchor="middle" font-size="32" font-family="sans-serif" fill="white">?</text></svg>`;

  return `data:image/svg+xml,${ encodeURIComponent(svg) }`;
}

function repoToApp(repo: GiteaRepo, templateId: string, createdBy: string, prodDeployed: boolean, icon: string): App {
  return {
    id:          repo.name,
    name:        repo.name,
    logo:        templateLogo(templateId),
    icon,
    repoName:    repo.name,
    description: repo.description,
    createdAt:   repo.created_at,
    templateId,
    createdBy,
    prodDeployed,
  };
}

export async function fetchApps(store: any): Promise<App[]> {
  const repos = await listRepos(store);

  const apps = await Promise.all(repos.map(async(repo) => {
    const meta = await getAppMeta(store, repo.name);
    const buildEnv = await getBuildStatus(store, repo.name);
    const prodDeployed = buildEnv.prod.state === 'success';

    return repoToApp(repo, meta.templateId, meta.createdBy, prodDeployed, meta.icon);
  }));

  return apps;
}

export async function createApp(store: any, name: string, templateId: string, icon: string): Promise<App> {
  const template = getTemplate(templateId);

  if (!template) {
    throw new Error(`Unknown template: ${ templateId }`);
  }

  await template.init(store, name);

  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Persist template ID so deploy can provision template-specific infra
  await saveAppMeta(store, safeName, templateId, icon);

  const createdBy = await resolveUsername(store) || 'unknown';

  return {
    id:           safeName,
    name:         safeName,
    logo:         templateLogo(templateId),
    icon,
    repoName:     safeName,
    description:  `Ceol app: ${ safeName }`,
    createdAt:    new Date().toISOString(),
    templateId,
    createdBy,
    prodDeployed: false,
  };
}

export async function deleteApp(store: any, repoName: string): Promise<void> {
  const owner = await ensureGiteaAdmin(store);

  await deleteRepo(store, owner, repoName);

  // Remove pin if pinned, and sync sidebar
  if (isPinned(store, repoName)) {
    togglePin(store, repoName);
    syncPinnedProducts(store);
  }
}

export async function deleteAllApps(store: any): Promise<void> {
  const repos = await listRepos(store);
  const owner = await ensureGiteaAdmin(store);

  for (const repo of repos) {
    await deleteRepo(store, owner, repo.name);

    if (isPinned(store, repo.name)) {
      togglePin(store, repo.name);
    }
  }

  syncPinnedProducts(store);
}
