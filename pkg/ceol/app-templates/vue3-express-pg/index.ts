import type { AppTemplate, DeployResult } from '../types';
import { generateFiles } from './files';
import { ensureGiteaAdmin, createRepo, deleteRepo, pushFiles } from '../gitea';
import { k8sRequest } from '../../state/k8s';

async function ensurePostgres(store: any, appName: string, ns: string, env: string): Promise<void> {
  const safeName = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const pgName = `${ safeName }-postgres-${ env }`;

  const deployment = {
    apiVersion: 'apps/v1',
    kind:       'Deployment',
    metadata:   {
      name: pgName, namespace: ns,
      labels: { app: pgName, 'ceol/app': appName, 'ceol/env': env, 'ceol/managed': 'true' },
    },
    spec: {
      replicas: 1,
      strategy: { type: 'Recreate' },
      selector: { matchLabels: { app: pgName } },
      template: {
        metadata: { labels: { app: pgName } },
        spec:     {
          containers: [
            {
              name:  'postgres',
              image: 'postgres:16-alpine',
              ports: [{ containerPort: 5432, name: 'pg' }],
              env:   [
                { name: 'POSTGRES_DB', value: safeName },
                { name: 'POSTGRES_USER', value: 'app' },
                { name: 'POSTGRES_PASSWORD', value: 'app' },
              ],
              volumeMounts: [
                { name: 'data', mountPath: '/var/lib/postgresql/data', subPath: 'pgdata' },
              ],
            },
          ],
          volumes: [
            { name: 'data', hostPath: { path: `/var/lib/ceol/pg/${ safeName }-${ env }`, type: 'DirectoryOrCreate' } },
          ],
        },
      },
    },
  };

  try {
    await k8sRequest(store, 'GET', `apis/apps/v1/namespaces/${ ns }/deployments/${ pgName }`);
  } catch {
    await k8sRequest(store, 'POST', `apis/apps/v1/namespaces/${ ns }/deployments`, deployment);
  }

  const service = {
    apiVersion: 'v1',
    kind:       'Service',
    metadata:   {
      name: pgName, namespace: ns,
      labels: { app: pgName, 'ceol/app': appName, 'ceol/env': env, 'ceol/managed': 'true' },
    },
    spec: {
      selector: { app: pgName },
      ports:    [{ name: 'pg', port: 5432, targetPort: 5432 }],
    },
  };

  try {
    await k8sRequest(store, 'GET', `api/v1/namespaces/${ ns }/services/${ pgName }`);
  } catch {
    await k8sRequest(store, 'POST', `api/v1/namespaces/${ ns }/services`, service);
  }
}

function generateLogo(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="12" fill="#1a1a2e"/>
    <!-- Vue -->
    <polygon points="14,10 22,24 19,24 14,15.5 9,24 6,24" fill="#42b883"/>
    <polygon points="14,12 18,19 16.5,19 14,14.5 11.5,19 10,19" fill="#35495e"/>
    <!-- Express -->
    <rect x="27" y="10" width="14" height="14" rx="3" fill="#333"/>
    <text x="34" y="21" text-anchor="middle" font-size="10" font-family="monospace" font-weight="bold" fill="#fff">Ex</text>
    <!-- Postgres -->
    <rect x="46" y="10" width="14" height="14" rx="3" fill="#336791"/>
    <text x="53" y="21.5" text-anchor="middle" font-size="11" font-family="serif" font-weight="bold" fill="#fff">P</text>
    <!-- Label -->
    <text x="32" y="46" text-anchor="middle" font-size="7" font-family="system-ui,sans-serif" fill="#aaa">Full Stack</text>
    <text x="32" y="56" text-anchor="middle" font-size="6" font-family="system-ui,sans-serif" fill="#666">Vue + Express + PG</text>
  </svg>`;

  return `data:image/svg+xml,${ encodeURIComponent(svg) }`;
}

export const vue3ExpressPgTemplate: AppTemplate = {
  id:          'vue3-express-pg',
  name:        'Vue 3 + Express + Postgres',
  description: 'Full-stack app with Vue 3 frontend, Express API, and Postgres database',

  logo: generateLogo,

  files: generateFiles,

  async init(store, appName) {
    const owner = await ensureGiteaAdmin(store);
    const safeName = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    await createRepo(store, safeName);
    await pushFiles(store, owner, safeName, generateFiles(appName));
  },

  async deploy(store, appName, ns, env): Promise<DeployResult> {
    const safeName = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    await ensurePostgres(store, appName, ns, env);

    return {
      env: [
        { name: 'PGHOST', value: `${ safeName }-postgres-${ env }.${ ns }.svc` },
        { name: 'PGPORT', value: '5432' },
        { name: 'PGUSER', value: 'app' },
        { name: 'PGPASSWORD', value: 'app' },
        { name: 'PGDATABASE', value: safeName },
      ],
    };
  },

  async destroy(store, appName) {
    const owner = await ensureGiteaAdmin(store);
    const safeName = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    await deleteRepo(store, owner, safeName);
  },
};
