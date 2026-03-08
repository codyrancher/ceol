import { CEOL_NAMESPACE, GITEA_NODE_PORT } from '../infra';
import { ensureGiteaAdmin, getGiteaToken } from '../app-templates/gitea';
import { getTemplate } from '../app-templates';
import { MANAGEMENT } from '@shell/config/types';
import { k8sRequest, CLUSTER_ID, K8S_BASE } from './k8s';
import { resolveUsername } from './auth';

export { k8sRequest } from './k8s';

export function appNamespace(appName: string): string {
  return `ceol-app-${ appName }`;
}

export interface BuildStatus {
  state: 'idle' | 'building' | 'success' | 'error';
  message: string;
  timestamp: string;
  imageTag: string;
}

export interface AppEnvironment {
  staging: BuildStatus;
  prod: BuildStatus;
}

function configMapName(appName: string): string {
  return `ceol-build-${ appName }`;
}

export interface AppMeta {
  templateId: string;
  createdBy:  string;
  icon:       string;
}

export async function saveAppMeta(store: any, appName: string, templateId: string, icon: string): Promise<void> {
  const cmName = configMapName(appName);
  const createdBy = await resolveUsername(store) || 'unknown';
  const data = { templateId, createdBy, icon };

  try {
    await k8sRequest(store, 'GET', `api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps/${ cmName }`);
    await k8sRequest(store, 'PATCH', `api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps/${ cmName }`, {
      data,
    }, 'application/strategic-merge-patch+json');
  } catch {
    await k8sRequest(store, 'POST', `api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps`, {
      apiVersion: 'v1',
      kind:       'ConfigMap',
      metadata:   { name: cmName, namespace: CEOL_NAMESPACE },
      data,
    });
  }
}

export async function getAppMeta(store: any, appName: string): Promise<AppMeta> {
  try {
    const cm = await k8sRequest(store, 'GET', `api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps/${ configMapName(appName) }`);

    return {
      templateId: cm.data?.templateId || 'vue3',
      createdBy:  cm.data?.createdBy || 'unknown',
      icon:       cm.data?.icon || 'application',
    };
  } catch {
    return { templateId: 'vue3', createdBy: 'unknown', icon: 'application' };
  }
}

export interface AppResource {
  kind: string;
  name: string;
  namespace: string;
  state: string;
  stateClass: string;
  link: string;
}

const KIND_TO_RANCHER_TYPE: Record<string, string> = {
  ConfigMap:  'configmap',
  Deployment: 'apps.deployment',
  Service:    'service',
  Secret:     'secret',
};

function rancherLink(kind: string, namespace: string, name: string): string {
  const rancherType = KIND_TO_RANCHER_TYPE[kind] || kind.toLowerCase();

  return `/c/${ CLUSTER_ID }/explorer/${ rancherType }/${ namespace }/${ name }`;
}

export async function fetchAppInfra(store: any, appName: string): Promise<AppResource[]> {
  const ns = appNamespace(appName);
  const resources: AppResource[] = [];

  // Build ConfigMap in ceol-system
  try {
    const cm = await k8sRequest(store, 'GET', `api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps/${ configMapName(appName) }`);

    if (cm?.metadata?.name) {
      resources.push({
        kind:       'ConfigMap',
        name:       cm.metadata.name,
        namespace:  CEOL_NAMESPACE,
        state:      'Active',
        stateClass: 'text-success',
        link:       rancherLink('ConfigMap', CEOL_NAMESPACE, cm.metadata.name),
      });
    }
  } catch {
    // ConfigMap may not exist yet
  }

  // App namespace resources
  const queries: Array<{ kind: string; path: string; stateFn: (item: any) => { state: string; stateClass: string } }> = [
    {
      kind:    'Deployment',
      path:    `apis/apps/v1/namespaces/${ ns }/deployments`,
      stateFn: (d: any) => {
        const ready = d.status?.readyReplicas || 0;
        const desired = d.spec?.replicas || 1;

        if (ready >= desired) {
          return { state: `Ready (${ ready }/${ desired })`, stateClass: 'text-success' };
        }

        return { state: `Progressing (${ ready }/${ desired })`, stateClass: 'text-warning' };
      },
    },
    {
      kind:    'Service',
      path:    `api/v1/namespaces/${ ns }/services`,
      stateFn: () => ({ state: 'Active', stateClass: 'text-success' }),
    },
    {
      kind:    'Secret',
      path:    `api/v1/namespaces/${ ns }/secrets`,
      stateFn: () => ({ state: 'Active', stateClass: 'text-success' }),
    },
  ];

  for (const q of queries) {
    try {
      const resp = await k8sRequest(store, 'GET', q.path);
      const items = resp?.items || [];

      for (const item of items) {
        // Skip default service account secrets
        if (q.kind === 'Secret' && (item.type === 'kubernetes.io/service-account-token' || item.metadata?.name?.startsWith('default-token'))) {
          continue;
        }

        const { state, stateClass } = q.stateFn(item);

        resources.push({
          kind:      q.kind,
          name:      item.metadata.name,
          namespace: ns,
          state,
          stateClass,
          link:      rancherLink(q.kind, ns, item.metadata.name),
        });
      }
    } catch {
      // Namespace may not exist yet
    }
  }

  return resources;
}

function defaultBuildStatus(): BuildStatus {
  return {
    state:     'idle',
    message:   '',
    timestamp: '',
    imageTag:  '',
  };
}

export async function getBuildStatus(store: any, appName: string): Promise<AppEnvironment> {
  try {
    const cm = await k8sRequest(store, 'GET', `api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps/${ configMapName(appName) }`);

    return {
      staging: cm.data?.staging ? JSON.parse(cm.data.staging) : defaultBuildStatus(),
      prod:    cm.data?.prod ? JSON.parse(cm.data.prod) : defaultBuildStatus(),
    };
  } catch {
    return { staging: defaultBuildStatus(), prod: defaultBuildStatus() };
  }
}

async function saveBuildStatus(store: any, appName: string, env: 'staging' | 'prod', status: BuildStatus): Promise<void> {
  const cmName = configMapName(appName);
  const data = { [env]: JSON.stringify(status) };

  try {
    await k8sRequest(store, 'GET', `api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps/${ cmName }`);
    // Exists — patch it
    await k8sRequest(store, 'PATCH', `api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps/${ cmName }`, {
      data,
    }, 'application/strategic-merge-patch+json');
  } catch {
    // Create it
    await k8sRequest(store, 'POST', `api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps`, {
      apiVersion: 'v1',
      kind:       'ConfigMap',
      metadata:   { name: cmName, namespace: CEOL_NAMESPACE },
      data,
    });
  }
}

const PULL_SECRET_NAME = 'ceol-registry-pull';

async function ensureAppProject(store: any, appName: string): Promise<void> {
  const ns = appNamespace(appName);
  const projectName = ns;

  // Find or create the Rancher project
  const projects = await store.dispatch('management/findAll', { type: MANAGEMENT.PROJECT });
  let project = projects.find(
    (p: any) => p.spec?.displayName === projectName && p.spec?.clusterName === CLUSTER_ID
  );

  if (!project) {
    const resp = await store.dispatch('management/request', {
      opt: {
        url:     '/v3/projects',
        method:  'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        data:    {
          type:        'project',
          name:        projectName,
          description: `Ceol app: ${ appName }`,
          clusterId:   CLUSTER_ID,
        },
      },
    });

    await store.dispatch('management/findAll', { type: MANAGEMENT.PROJECT, opt: { force: true } });
    project = { metadata: { name: resp.id.split(':')[1] } };
  }

  const projectId = project.metadata.name;
  const annotation = `${ CLUSTER_ID }:${ projectId }`;

  // Ensure namespace exists and is associated with the project
  const nsBody = {
    apiVersion: 'v1',
    kind:       'Namespace',
    metadata:   {
      name:        ns,
      labels:      { 'field.cattle.io/projectId': projectId },
      annotations: { 'field.cattle.io/projectId': annotation },
    },
  };

  try {
    await k8sRequest(store, 'GET', `api/v1/namespaces/${ ns }`);
    await k8sRequest(store, 'PUT', `api/v1/namespaces/${ ns }`, nsBody);
  } catch {
    await k8sRequest(store, 'POST', 'api/v1/namespaces', nsBody);
  }
}

async function ensureBuildSecret(store: any): Promise<void> {
  const { token, user } = await getGiteaToken(store);
  const auth = btoa(`${ user }:${ token }`);
  const dockerConfig = JSON.stringify({
    auths: {
      [`gitea.${ CEOL_NAMESPACE }.svc:3000`]: { auth },
      [`localhost:${ GITEA_NODE_PORT }`]:      { auth },
    },
  });

  await ensureSecret(store, CEOL_NAMESPACE, 'ceol-registry-auth', 'Opaque', {
    'config.json': btoa(dockerConfig),
  });
}

async function ensurePullSecret(store: any, appName: string): Promise<void> {
  const { token, user } = await getGiteaToken(store);
  const auth = btoa(`${ user }:${ token }`);
  const pullConfig = JSON.stringify({
    auths: {
      [`localhost:${ GITEA_NODE_PORT }`]: { username: user, password: token, auth },
    },
  });

  await ensureSecret(store, appNamespace(appName), PULL_SECRET_NAME, 'kubernetes.io/dockerconfigjson', {
    '.dockerconfigjson': btoa(pullConfig),
  });
}

async function ensureSecret(store: any, ns: string, name: string, type: string, data: Record<string, string>): Promise<void> {
  try {
    await k8sRequest(store, 'GET', `api/v1/namespaces/${ ns }/secrets/${ name }`);

    return; // Already exists
  } catch {
    // Need to create it
  }

  await k8sRequest(store, 'POST', `api/v1/namespaces/${ ns }/secrets`, {
    apiVersion: 'v1',
    kind:       'Secret',
    metadata:   { name, namespace: ns },
    type,
    data,
  });
}

// In-cluster address (used by Kaniko/crane running inside pods where cluster DNS works)
function clusterRegistryImage(appName: string, tag: string): string {
  return `gitea.${ CEOL_NAMESPACE }.svc:3000/ceol-admin/${ appName }:${ tag }`;
}

// Node-accessible address (used in Deployment image refs pulled by containerd on the host)
function nodeRegistryImage(appName: string, tag: string): string {
  return `localhost:${ GITEA_NODE_PORT }/ceol-admin/${ appName }:${ tag }`;
}

function deploymentName(appName: string, env: string): string {
  return `ceol-app-${ appName }-${ env }`;
}

function serviceName(appName: string, env: string): string {
  return `ceol-app-${ appName }-${ env }`;
}

export function appProxyUrl(appName: string, env: string): string {
  const svc = serviceName(appName, env);
  const ns = appNamespace(appName);

  return `${ K8S_BASE }/api/v1/namespaces/${ ns }/services/http:${ svc }:80/proxy/`;
}

async function ensureDeployment(store: any, appName: string, env: string, imageTag: string): Promise<void> {
  const ns = appNamespace(appName);

  await ensureAppProject(store, appName);
  await ensurePullSecret(store, appName);

  const meta = await getAppMeta(store, appName);
  const template = getTemplate(meta.templateId);
  let extraEnv: Array<{ name: string; value: string }> = [];

  // Provision template-specific infrastructure
  if (template?.deploy) {
    const result = await template.deploy(store, appName, ns, env);

    if (result.env) {
      extraEnv = result.env;
    }
  }

  const name = deploymentName(appName, env);
  const image = nodeRegistryImage(appName, imageTag);
  const labels = {
    app:              name,
    'ceol/app':       appName,
    'ceol/env':       env,
    'ceol/managed':   'true',
  };

  const deployment = {
    apiVersion: 'apps/v1',
    kind:       'Deployment',
    metadata:   { name, namespace: ns, labels },
    spec:       {
      replicas: 1,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels },
        spec:     {
          imagePullSecrets: [{ name: PULL_SECRET_NAME }],
          containers:       [
            {
              name:  'app',
              image,
              imagePullPolicy: 'Always',
              ports: [{ containerPort: 80, name: 'http' }],
              ...(extraEnv.length ? { env: extraEnv } : {}),
            },
          ],
        },
      },
    },
  };

  try {
    await k8sRequest(store, 'GET', `apis/apps/v1/namespaces/${ ns }/deployments/${ name }`);
    // Exists — replace it to pick up new image
    await k8sRequest(store, 'PUT', `apis/apps/v1/namespaces/${ ns }/deployments/${ name }`, deployment);
  } catch {
    await k8sRequest(store, 'POST', `apis/apps/v1/namespaces/${ ns }/deployments`, deployment);
  }

  // Ensure service
  const svcName = serviceName(appName, env);
  const service = {
    apiVersion: 'v1',
    kind:       'Service',
    metadata:   { name: svcName, namespace: ns, labels },
    spec:       {
      selector: { app: name },
      ports:    [{ name: 'http', port: 80, targetPort: 80 }],
    },
  };

  try {
    await k8sRequest(store, 'GET', `api/v1/namespaces/${ ns }/services/${ svcName }`);
  } catch {
    await k8sRequest(store, 'POST', `api/v1/namespaces/${ ns }/services`, service);
  }
}

export async function triggerBuild(store: any, appName: string): Promise<void> {
  await ensureBuildSecret(store);
  const owner = await ensureGiteaAdmin(store);
  const { token } = await getGiteaToken(store);
  const tag = `staging-${ Date.now() }`;
  const image = nodeRegistryImage(appName, tag);
  const jobName = `ceol-build-${ appName }-${ Date.now() }`;

  // Save building state
  await saveBuildStatus(store, appName, 'staging', {
    state:     'building',
    message:   'Build started',
    timestamp: new Date().toISOString(),
    imageTag:  tag,
  });

  // Create Kaniko build job
  const job = {
    apiVersion: 'batch/v1',
    kind:       'Job',
    metadata:   {
      name:      jobName,
      namespace: CEOL_NAMESPACE,
      labels:    {
        'ceol/app':     appName,
        'ceol/build':   'true',
        'ceol/managed': 'true',
      },
    },
    spec: {
      backoffLimit:            0,
      ttlSecondsAfterFinished: 600,
      template:                {
        metadata: { labels: { 'ceol/build': 'true' } },
        spec:     {
          hostNetwork:        true,
          restartPolicy:      'Never',
          serviceAccountName: 'ceol-builder',
          initContainers:     [
            {
              name:         'clone',
              image:        'alpine/git:latest',
              command:      ['/bin/sh', '-c', `git clone http://${ owner }:${ token }@localhost:${ GITEA_NODE_PORT }/${ owner }/${ appName }.git /workspace`],
              volumeMounts: [{ name: 'workspace', mountPath: '/workspace' }],
            },
          ],
          containers: [
            {
              name:  'kaniko',
              image: 'gcr.io/kaniko-project/executor:latest',
              args:  [
                '--dockerfile=Dockerfile',
                '--context=/workspace',
                `--destination=${ image }`,
                '--insecure',
                '--skip-tls-verify',
              ],
              volumeMounts: [
                { name: 'workspace', mountPath: '/workspace' },
                { name: 'docker-config', mountPath: '/kaniko/.docker' },
              ],
            },
          ],
          volumes: [
            { name: 'workspace', emptyDir: {} },
            {
              name:   'docker-config',
              secret: { secretName: 'ceol-registry-auth' },
            },
          ],
        },
      },
    },
  };

  await k8sRequest(store, 'POST', `apis/batch/v1/namespaces/${ CEOL_NAMESPACE }/jobs`, job);
}

export async function pollBuildStatus(store: any, appName: string): Promise<BuildStatus> {
  const env = await getBuildStatus(store, appName);
  const staging = env.staging;

  if (staging.state !== 'building') {
    return staging;
  }

  // Check latest build job
  const jobs = await k8sRequest(store, 'GET', `apis/batch/v1/namespaces/${ CEOL_NAMESPACE }/jobs?labelSelector=ceol/app=${ appName },ceol/build=true`);
  const items = jobs?.items || [];

  if (items.length === 0) {
    return staging;
  }

  // Sort by creation time, newest first
  items.sort((a: any, b: any) => new Date(b.metadata.creationTimestamp).getTime() - new Date(a.metadata.creationTimestamp).getTime());
  const latest = items[0];

  if (latest.status?.succeeded) {
    const status: BuildStatus = {
      state:     'success',
      message:   'Build completed successfully',
      timestamp: new Date().toISOString(),
      imageTag:  staging.imageTag,
    };

    await saveBuildStatus(store, appName, 'staging', status);
    await ensureDeployment(store, appName, 'staging', staging.imageTag);

    return status;
  }

  if (latest.status?.failed) {
    // Try to get logs from the pod
    let errorMsg = 'Build failed';

    try {
      const pods = await k8sRequest(store, 'GET', `api/v1/namespaces/${ CEOL_NAMESPACE }/pods?labelSelector=job-name=${ latest.metadata.name }`);
      const pod = pods?.items?.[0];

      if (pod) {
        const containerStatuses = [
          ...(pod.status?.initContainerStatuses || []),
          ...(pod.status?.containerStatuses || []),
        ];

        for (const cs of containerStatuses) {
          if (cs.state?.terminated?.reason === 'Error' || cs.state?.terminated?.exitCode !== 0) {
            try {
              const logs = await k8sRequest(store, 'GET', `api/v1/namespaces/${ CEOL_NAMESPACE }/pods/${ pod.metadata.name }/log?container=${ cs.name }&tailLines=20`);

              if (typeof logs === 'string' && logs.length > 0) {
                errorMsg = logs;
              }
            } catch {
              // Logs may not be available
            }
            break;
          }
        }
      }
    } catch {
      // Ignore log fetch errors
    }

    const status: BuildStatus = {
      state:     'error',
      message:   errorMsg,
      timestamp: new Date().toISOString(),
      imageTag:  staging.imageTag,
    };

    await saveBuildStatus(store, appName, 'staging', status);

    return status;
  }

  // Still running
  return staging;
}

// Strip ANSI escape codes from text
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*[a-zA-Z]/g;

function extractLogText(resp: any): string {
  let raw = '';

  if (typeof resp === 'string') {
    raw = resp;
  } else if (resp && typeof resp === 'object') {
    // Rancher proxy wraps pod logs in {"data": "..."}
    raw = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp);
  }

  return raw.replace(ANSI_RE, '');
}

export async function fetchBuildLogs(store: any, appName: string, type: 'build' | 'promote' = 'build'): Promise<string> {
  const labelKey = type === 'build' ? 'ceol/build' : 'ceol/promote';
  const jobs = await k8sRequest(store, 'GET', `apis/batch/v1/namespaces/${ CEOL_NAMESPACE }/jobs?labelSelector=ceol/app=${ appName },${ labelKey }=true`);
  const items = jobs?.items || [];

  if (items.length === 0) {
    return 'No build jobs found.';
  }

  items.sort((a: any, b: any) => new Date(b.metadata.creationTimestamp).getTime() - new Date(a.metadata.creationTimestamp).getTime());
  const latest = items[0];

  const pods = await k8sRequest(store, 'GET', `api/v1/namespaces/${ CEOL_NAMESPACE }/pods?labelSelector=job-name=${ latest.metadata.name }`);
  const pod = pods?.items?.[0];

  if (!pod) {
    return 'Waiting for pod to start...';
  }

  const parts: string[] = [];

  // Gather logs from init containers then main containers
  const allContainers = [
    ...(pod.spec?.initContainers || []).map((c: any) => ({ name: c.name, isInit: true })),
    ...(pod.spec?.containers || []).map((c: any) => ({ name: c.name, isInit: false })),
  ];

  // Figure out which containers have started by checking statuses
  const initStatuses = pod.status?.initContainerStatuses || [];
  const containerStatuses = pod.status?.containerStatuses || [];
  const allStatuses = [...initStatuses, ...containerStatuses];
  const statusMap = new Map(allStatuses.map((s: any) => [s.name, s]));

  for (const container of allContainers) {
    const cs = statusMap.get(container.name);

    // Skip containers that haven't started yet
    if (!cs || cs.state?.waiting) {
      if (cs?.state?.waiting) {
        parts.push(`--- ${ container.name } ---`);
        parts.push(`Waiting: ${ cs.state.waiting.reason || 'Pending' }`);
      }
      continue;
    }

    try {
      const resp = await k8sRequest(store, 'GET', `api/v1/namespaces/${ CEOL_NAMESPACE }/pods/${ pod.metadata.name }/log?container=${ container.name }`);
      const text = extractLogText(resp);

      parts.push(`--- ${ container.name } ---`);
      parts.push(text || '(no output)');
    } catch {
      parts.push(`--- ${ container.name } ---`);
      parts.push('(logs not available yet)');
    }
  }

  if (parts.length === 0) {
    return 'Waiting for containers to start...';
  }

  return parts.join('\n');
}

export async function promoteToProd(store: any, appName: string): Promise<void> {
  const env = await getBuildStatus(store, appName);

  if (env.staging.state !== 'success') {
    throw new Error('Staging build must succeed before promoting to prod');
  }

  const stagingTag = env.staging.imageTag;

  // Re-tag via crane running with hostNetwork so localhost:NodePort reaches Gitea
  const stagingImage = nodeRegistryImage(appName, stagingTag);
  const prodTag = `prod-${ Date.now() }`;
  const prodImage = nodeRegistryImage(appName, prodTag);

  await ensureBuildSecret(store);

  // Use crane to copy the image (lightweight, no docker needed)
  const jobName = `ceol-promote-${ appName }-${ Date.now() }`;

  const job = {
    apiVersion: 'batch/v1',
    kind:       'Job',
    metadata:   {
      name:      jobName,
      namespace: CEOL_NAMESPACE,
      labels:    { 'ceol/app': appName, 'ceol/promote': 'true', 'ceol/managed': 'true' },
    },
    spec: {
      backoffLimit:            0,
      ttlSecondsAfterFinished: 300,
      template:                {
        spec: {
          hostNetwork:   true,
          restartPolicy: 'Never',
          containers:    [
            {
              name:    'crane',
              image:   'gcr.io/go-containerregistry/crane:latest',
              command: [
                'crane', 'copy',
                '--insecure',
                stagingImage, prodImage,
              ],
              env: [
                {
                  name:  'DOCKER_CONFIG',
                  value: '/kaniko/.docker',
                },
              ],
              volumeMounts: [
                { name: 'docker-config', mountPath: '/kaniko/.docker' },
              ],
            },
          ],
          volumes: [
            {
              name:   'docker-config',
              secret: { secretName: 'ceol-registry-auth' },
            },
          ],
        },
      },
    },
  };

  await k8sRequest(store, 'POST', `apis/batch/v1/namespaces/${ CEOL_NAMESPACE }/jobs`, job);

  // Save prod status
  const status: BuildStatus = {
    state:     'building',
    message:   'Promoting staging to prod',
    timestamp: new Date().toISOString(),
    imageTag:  prodTag,
  };

  await saveBuildStatus(store, appName, 'prod', status);
}

export async function pollPromoteStatus(store: any, appName: string): Promise<BuildStatus> {
  const env = await getBuildStatus(store, appName);
  const prod = env.prod;

  if (prod.state !== 'building') {
    return prod;
  }

  const jobs = await k8sRequest(store, 'GET', `apis/batch/v1/namespaces/${ CEOL_NAMESPACE }/jobs?labelSelector=ceol/app=${ appName },ceol/promote=true`);
  const items = jobs?.items || [];

  if (items.length === 0) {
    return prod;
  }

  items.sort((a: any, b: any) => new Date(b.metadata.creationTimestamp).getTime() - new Date(a.metadata.creationTimestamp).getTime());
  const latest = items[0];

  if (latest.status?.succeeded) {
    const status: BuildStatus = {
      state:     'success',
      message:   'Promoted to production',
      timestamp: new Date().toISOString(),
      imageTag:  prod.imageTag,
    };

    await saveBuildStatus(store, appName, 'prod', status);
    await ensureDeployment(store, appName, 'prod', prod.imageTag);

    return status;
  }

  if (latest.status?.failed) {
    const status: BuildStatus = {
      state:     'error',
      message:   'Promotion failed',
      timestamp: new Date().toISOString(),
      imageTag:  prod.imageTag,
    };

    await saveBuildStatus(store, appName, 'prod', status);

    return status;
  }

  return prod;
}
