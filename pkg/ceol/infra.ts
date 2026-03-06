// Infrastructure resources matching ../../infra.yaml
// Each entry is a full K8s manifest to be created in the ceol-system namespace.

export const CEOL_PROJECT_NAME = 'ceol';
export const CEOL_NAMESPACE = 'ceol-system';

export interface InfraResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
  };
  [key: string]: any;
}

// Map kind to its plural API resource name
const KIND_TO_PLURAL: Record<string, string> = {
  ConfigMap:             'configmaps',
  PersistentVolumeClaim: 'persistentvolumeclaims',
  Deployment:            'deployments',
  Service:               'services',
  Secret:                'secrets',
};

/**
 * Returns the K8s API path for listing/creating resources of this kind in a namespace.
 */
export function collectionPath(resource: InfraResource): string {
  const ns = resource.metadata.namespace || CEOL_NAMESPACE;
  const plural = KIND_TO_PLURAL[resource.kind];

  if (!plural) {
    throw new Error(`Unknown kind: ${ resource.kind }`);
  }

  const base = resource.apiVersion.includes('/') ? `apis/${ resource.apiVersion }` : `api/${ resource.apiVersion }`;

  return `${ base }/namespaces/${ ns }/${ plural }`;
}

/**
 * Returns the K8s API path for a specific resource instance.
 */
export function resourcePath(resource: InfraResource): string {
  return `${ collectionPath(resource) }/${ resource.metadata.name }`;
}

// All resource kinds we manage (used for cleanup). Order matters for deletion (delete workloads first).
export const MANAGED_KINDS: InfraResource[] = [
  { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: '', namespace: CEOL_NAMESPACE } },
  { apiVersion: 'v1', kind: 'Service', metadata: { name: '', namespace: CEOL_NAMESPACE } },
  { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: '', namespace: CEOL_NAMESPACE } },
  { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: '', namespace: CEOL_NAMESPACE } },
];

export const infraResources: InfraResource[] = [
  {
    apiVersion: 'v1',
    kind:       'ConfigMap',
    metadata:   {
      name:      'ceol-test',
      namespace: CEOL_NAMESPACE,
    },
    data: { status: 'initialized' },
  },
  {
    apiVersion: 'v1',
    kind:       'PersistentVolumeClaim',
    metadata:   {
      name:      'gitea-data',
      namespace: CEOL_NAMESPACE,
    },
    spec: {
      accessModes: ['ReadWriteOnce'],
      resources:   { requests: { storage: '5Gi' } },
    },
  },
  {
    apiVersion: 'apps/v1',
    kind:       'Deployment',
    metadata:   {
      name:      'gitea',
      namespace: CEOL_NAMESPACE,
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: 'gitea' } },
      template: {
        metadata: { labels: { app: 'gitea' } },
        spec:     {
          containers: [
            {
              name:  'gitea',
              image: 'gitea/gitea:1.22',
              ports: [
                { containerPort: 3000, name: 'http' },
                { containerPort: 22, name: 'ssh' },
              ],
              env: [
                { name: 'GITEA__server__ROOT_URL', value: `http://gitea.${ CEOL_NAMESPACE }.svc:3000` },
                { name: 'GITEA__server__SSH_DOMAIN', value: `gitea.${ CEOL_NAMESPACE }.svc` },
                { name: 'GITEA__service__DISABLE_REGISTRATION', value: 'true' },
                { name: 'GITEA__packages__ENABLED', value: 'true' },
              ],
              volumeMounts: [
                { name: 'data', mountPath: '/data' },
              ],
            },
          ],
          volumes: [
            { name: 'data', persistentVolumeClaim: { claimName: 'gitea-data' } },
          ],
        },
      },
    },
  },
  {
    apiVersion: 'v1',
    kind:       'Service',
    metadata:   {
      name:      'gitea',
      namespace: CEOL_NAMESPACE,
    },
    spec: {
      selector: { app: 'gitea' },
      ports:    [
        { name: 'http', port: 3000, targetPort: 3000 },
        { name: 'ssh', port: 22, targetPort: 22 },
      ],
    },
  },
];
