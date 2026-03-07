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
  ConfigMap:          'configmaps',
  Deployment:         'deployments',
  Service:            'services',
  Secret:             'secrets',
  ServiceAccount:     'serviceaccounts',
  Role:               'roles',
  RoleBinding:        'rolebindings',
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
  { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding', metadata: { name: '', namespace: CEOL_NAMESPACE } },
  { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata: { name: '', namespace: CEOL_NAMESPACE } },
  { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: '', namespace: CEOL_NAMESPACE } },
];

// Startup script for the git auth proxy.
// Reads Gitea credentials from env vars, generates nginx config, and starts nginx.
const GIT_PROXY_STARTUP = `
#!/bin/sh
AUTH=$(echo -n "$GITEA_USER:$GITEA_TOKEN" | base64)
cat > /etc/nginx/conf.d/default.conf <<NGINX_EOF
server {
    listen 3000;
    client_max_body_size 512m;
    location / {
        proxy_pass http://gitea.${ CEOL_NAMESPACE }.svc:3000;
        proxy_set_header Host gitea.${ CEOL_NAMESPACE }.svc:3000;
        proxy_set_header Authorization "Basic $AUTH";
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
NGINX_EOF
exec nginx -g 'daemon off;'
`.trim();

// Shell script that bootstraps the Gitea admin user and writes the access token to a K8s ConfigMap.
// Uses only BusyBox-compatible wget flags. No set -e to avoid silent failures.
const GITEA_BOOTSTRAP_SCRIPT = `
#!/bin/sh

# Clean stale LevelDB locks from previous crashes
rm -f /data/gitea/queues/common/LOCK 2>/dev/null

# Start Gitea in background
/usr/bin/entrypoint /bin/s6-svscan /etc/s6 &
GITEA_PID=$!

# Install curl (BusyBox wget cannot do HTTPS with certs)
apk add --no-cache curl >/dev/null 2>&1 || echo "[ceol] WARN: could not install curl"

# Wait for Gitea to be ready (up to 60s)
echo "[ceol] Waiting for Gitea..."
READY=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  if wget -qO /dev/null http://localhost:3000/api/v1/settings/api 2>/dev/null; then
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" != "1" ]; then
  echo "[ceol] ERROR: Gitea did not become ready in 60s"
  wait $GITEA_PID
  exit 0
fi
echo "[ceol] Gitea is ready"

# Gitea CLI fatals when run as root. Use su-exec to run as git user instead.
# Create admin user (ignore if already exists)
su-exec git gitea admin user create --admin --username ceol-admin --password ceol-admin-pass --email ceol-admin@local.dev --must-change-password=false 2>&1 || echo "[ceol] Admin user may already exist"
echo "[ceol] Admin user ensured"

# Check for service account
SA_TOKEN_FILE=/var/run/secrets/kubernetes.io/serviceaccount/token
if [ ! -f "$SA_TOKEN_FILE" ]; then
  echo "[ceol] ERROR: No service account token"
  wait $GITEA_PID
  exit 0
fi

SA_TOKEN=$(cat $SA_TOKEN_FILE)
CA=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
K8S_API="https://kubernetes.default.svc/api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps"
echo "[ceol] Service account token found"

# Check if ConfigMap already exists with a valid token
EXISTING=$(curl -sf --cacert $CA -H "Authorization: Bearer $SA_TOKEN" "$K8S_API/ceol-gitea-token" 2>/dev/null || true)
if echo "$EXISTING" | grep -q '"token"'; then
  echo "[ceol] Token ConfigMap already exists, skipping"
  wait $GITEA_PID
  exit 0
fi
echo "[ceol] Token ConfigMap does not exist yet"

# Generate new token with unique name
TNAME="ceol-$(date +%s)"
echo "[ceol] Generating access token..."
TOKEN=$(su-exec git gitea admin user generate-access-token --username ceol-admin --token-name "$TNAME" --scopes all --raw 2>/dev/null | tr -d '\\n')

if [ -z "$TOKEN" ]; then
  echo "[ceol] ERROR: Failed to generate access token"
  wait $GITEA_PID
  exit 0
fi

echo "[ceol] Generated access token, creating ConfigMap..."

# Create ConfigMap via K8s API
PAYLOAD='{"apiVersion":"v1","kind":"ConfigMap","metadata":{"name":"ceol-gitea-token","namespace":"${ CEOL_NAMESPACE }"},"data":{"token":"'"$TOKEN"'","user":"ceol-admin"}}'
curl -sf --cacert $CA -H "Authorization: Bearer $SA_TOKEN" -H "Content-Type: application/json" -d "$PAYLOAD" "$K8S_API" >/dev/null 2>&1 || true
echo "[ceol] Bootstrap complete"

wait $GITEA_PID
`;

const GITEA_BOOTSTRAP = ['/bin/sh', '-c', GITEA_BOOTSTRAP_SCRIPT.trim()];

export const infraResources: InfraResource[] = [
  // ServiceAccount for Gitea pod to write the token ConfigMap
  {
    apiVersion: 'v1',
    kind:       'ServiceAccount',
    metadata:   {
      name:      'ceol-gitea',
      namespace: CEOL_NAMESPACE,
    },
  },
  {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind:       'Role',
    metadata:   {
      name:      'ceol-gitea-token-writer',
      namespace: CEOL_NAMESPACE,
    },
    rules: [
      {
        apiGroups: [''],
        resources: ['configmaps'],
        verbs:     ['get', 'create', 'update', 'patch'],
      },
    ],
  },
  {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind:       'RoleBinding',
    metadata:   {
      name:      'ceol-gitea-token-writer',
      namespace: CEOL_NAMESPACE,
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind:     'Role',
      name:     'ceol-gitea-token-writer',
    },
    subjects: [
      {
        kind:      'ServiceAccount',
        name:      'ceol-gitea',
        namespace: CEOL_NAMESPACE,
      },
    ],
  },
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
    apiVersion: 'apps/v1',
    kind:       'Deployment',
    metadata:   {
      name:      'gitea',
      namespace: CEOL_NAMESPACE,
    },
    spec: {
      replicas: 1,
      strategy: { type: 'Recreate' },
      selector: { matchLabels: { app: 'gitea' } },
      template: {
        metadata: { labels: { app: 'gitea' } },
        spec:     {
          serviceAccountName: 'ceol-gitea',
          containers:         [
            {
              name:    'gitea',
              image:   'gitea/gitea:1.22',
              command: GITEA_BOOTSTRAP,
              ports:   [
                { containerPort: 3000, name: 'http' },
                { containerPort: 22, name: 'ssh' },
              ],
              env: [
                { name: 'GITEA__server__ROOT_URL', value: `http://gitea.${ CEOL_NAMESPACE }.svc:3000` },
                { name: 'GITEA__server__SSH_DOMAIN', value: `gitea.${ CEOL_NAMESPACE }.svc` },
                { name: 'GITEA__service__DISABLE_REGISTRATION', value: 'false' },
                { name: 'GITEA__packages__ENABLED', value: 'true' },
                { name: 'GITEA__security__INSTALL_LOCK', value: 'true' },
              ],
              volumeMounts: [
                { name: 'data', mountPath: '/data' },
              ],
            },
          ],
          volumes: [
            { name: 'data', hostPath: { path: '/var/lib/ceol/gitea', type: 'DirectoryOrCreate' } },
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
  // Git auth proxy — injects Gitea credentials so git clone/push works through Rancher's K8s service proxy
  {
    apiVersion: 'apps/v1',
    kind:       'Deployment',
    metadata:   {
      name:      'ceol-git-proxy',
      namespace: CEOL_NAMESPACE,
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: 'ceol-git-proxy' } },
      template: {
        metadata: { labels: { app: 'ceol-git-proxy' } },
        spec:     {
          containers: [
            {
              name:    'nginx',
              image:   'nginx:alpine',
              command: ['/bin/sh', '-c', GIT_PROXY_STARTUP],
              ports:   [{ containerPort: 3000, name: 'http' }],
              env:     [
                {
                  name:      'GITEA_TOKEN',
                  valueFrom: { configMapKeyRef: { name: 'ceol-gitea-token', key: 'token' } },
                },
                {
                  name:      'GITEA_USER',
                  valueFrom: { configMapKeyRef: { name: 'ceol-gitea-token', key: 'user' } },
                },
              ],
            },
          ],
        },
      },
    },
  },
  {
    apiVersion: 'v1',
    kind:       'Service',
    metadata:   {
      name:      'ceol-git-proxy',
      namespace: CEOL_NAMESPACE,
    },
    spec: {
      selector: { app: 'ceol-git-proxy' },
      ports:    [
        { name: 'http', port: 3000, targetPort: 3000 },
      ],
    },
  },
];
