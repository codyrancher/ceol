import { CEOL_NAMESPACE } from '../infra';

const CLUSTER_ID = 'local';
const K8S_BASE = `/k8s/clusters/${ CLUSTER_ID }`;
const GITEA_PROXY = `${ K8S_BASE }/api/v1/namespaces/${ CEOL_NAMESPACE }/services/http:gitea:3000/proxy`;
const GITEA_GIT_PROXY = `${ K8S_BASE }/api/v1/namespaces/${ CEOL_NAMESPACE }/services/http:ceol-git-proxy:3000/proxy`;

let cachedToken: string | null = null;
let cachedUser: string | null = null;
let cachedRancherKey: string | null = null;
let cachedServerUrl: string | null = null;

function getCsrfToken(): string {
  const match = document.cookie.match(/CSRF=([^;]+)/);

  return match ? match[1] : '';
}

async function getGiteaToken(store: any): Promise<{ token: string; user: string }> {
  if (cachedToken && cachedUser) {
    return { token: cachedToken, user: cachedUser };
  }

  const cm = await store.dispatch('management/request', {
    opt: {
      url:    `${ K8S_BASE }/api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps/ceol-gitea-token`,
      method: 'GET',
    },
  });

  if (!cm?.data?.token) {
    throw new Error('Gitea token not found. Infrastructure may still be starting — wait for the Gitea deployment to be Ready, then try again.');
  }

  cachedToken = cm.data.token;
  cachedUser = cm.data.user;
  cachedRancherKey = cm.data.rancherKey || null;

  return { token: cachedToken!, user: cachedUser! };
}

async function ensureRancherKey(store: any): Promise<string> {
  await getGiteaToken(store);

  if (cachedRancherKey) {
    return cachedRancherKey;
  }

  // Create a Rancher API key
  const resp = await store.dispatch('management/request', {
    opt: {
      url:     '/v3/tokens',
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      data:    {
        type:        'token',
        description: 'ceol-git-access',
      },
    },
  });

  if (!resp?.token) {
    throw new Error('Failed to create Rancher API key');
  }

  cachedRancherKey = resp.token;

  // Persist it in the ConfigMap so it survives page reloads
  await store.dispatch('management/request', {
    opt: {
      url:    `${ K8S_BASE }/api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps/ceol-gitea-token`,
      method: 'PATCH',
      headers: {
        'content-type': 'application/strategic-merge-patch+json',
      },
      data: {
        data: { rancherKey: cachedRancherKey },
      },
    },
  });

  return cachedRancherKey!;
}

async function giteaApi(store: any, method: string, path: string, body?: any): Promise<any> {
  const { token } = await getGiteaToken(store);
  const separator = path.includes('?') ? '&' : '?';
  const url = `${ GITEA_PROXY }${ path }${ separator }token=${ token }`;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept':       'application/json',
    'x-api-csrf':   getCsrfToken(),
  };

  const opts: RequestInit = { method, headers };

  if (body) {
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(url, opts);

  if (!resp.ok) {
    const text = await resp.text();

    throw new Error(`Gitea ${ method } ${ path }: ${ resp.status } ${ text }`);
  }

  const ct = resp.headers.get('content-type') || '';

  return ct.includes('json') ? await resp.json() : null;
}

export async function ensureGiteaAdmin(store: any): Promise<string> {
  const { user } = await getGiteaToken(store);

  return user;
}

async function getServerUrl(store: any): Promise<string> {
  if (cachedServerUrl) {
    return cachedServerUrl;
  }

  const setting = await store.dispatch('management/request', {
    opt: {
      url:    '/v3/settings/server-url',
      method: 'GET',
    },
  });

  cachedServerUrl = setting?.value || window.location.origin;

  return cachedServerUrl!;
}

export interface CloneInfo {
  url: string;
  cloneCmd: string;
}

export async function getCloneInfo(store: any, repoName: string): Promise<CloneInfo> {
  const { user } = await getGiteaToken(store);
  const rancherKey = await ensureRancherKey(store);
  const serverUrl = await getServerUrl(store);
  const b64 = btoa(rancherKey);
  const url = `${ serverUrl }${ GITEA_GIT_PROXY }/${ user }/${ repoName }.git`;

  const cloneCmd = `git clone -c 'http.extraHeader=Authorization: Basic ${ b64 }' -c http.sslVerify=false ${ url }`;

  return { url, cloneCmd };
}

export interface GiteaRepo {
  name: string;
  description: string;
  html_url: string;
  avatar_url: string;
  created_at: string;
}

export async function listRepos(store: any): Promise<GiteaRepo[]> {
  const { user } = await getGiteaToken(store);

  return await giteaApi(store, 'GET', `/api/v1/users/${ user }/repos?limit=50`) || [];
}

export interface GiteaTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size: number;
}

export async function getRepoTree(store: any, owner: string, repo: string, ref = 'main'): Promise<GiteaTreeEntry[]> {
  const result = await giteaApi(store, 'GET', `/api/v1/repos/${ owner }/${ repo }/git/trees/${ ref }?recursive=true`);

  return result?.tree || [];
}

export async function createRepo(store: any, name: string): Promise<any> {
  return await giteaApi(store, 'POST', '/api/v1/user/repos', {
    name,
    auto_init:   false,
    private:     false,
    description: `Ceol app: ${ name }`,
  });
}

export async function deleteRepo(store: any, owner: string, name: string): Promise<void> {
  try {
    await giteaApi(store, 'DELETE', `/api/v1/repos/${ owner }/${ name }`);
  } catch {
    // Repo may not exist
  }
}

export async function getFileContent(store: any, owner: string, repo: string, filePath: string, ref = 'main'): Promise<string> {
  const result = await giteaApi(store, 'GET', `/api/v1/repos/${ owner }/${ repo }/contents/${ filePath }?ref=${ ref }`);

  if (!result?.content) {
    return '';
  }

  return decodeURIComponent(escape(atob(result.content)));
}

export async function pushFile(
  store: any,
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  message: string,
): Promise<void> {
  const encoded = btoa(unescape(encodeURIComponent(content)));

  await giteaApi(store, 'POST', `/api/v1/repos/${ owner }/${ repo }/contents/${ filePath }`, {
    content: encoded,
    message,
  });
}

export async function pushFiles(
  store: any,
  owner: string,
  repo: string,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  for (const file of files) {
    await pushFile(store, owner, repo, file.path, file.content, `Add ${ file.path }`);
  }
}
