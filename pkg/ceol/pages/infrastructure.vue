<script lang="ts">
import { defineComponent } from 'vue';
import { MANAGEMENT } from '@shell/config/types';
import {
  CEOL_PROJECT_NAME, CEOL_NAMESPACE, infraResources, MANAGED_KINDS,
  collectionPath
} from '../infra';
import type { InfraResource } from '../infra';
import CeolTabs from '../components/CeolTabs.vue';

const CLUSTER_ID = 'local';
const K8S_BASE = `/k8s/clusters/${ CLUSTER_ID }`;

const KIND_TO_RANCHER_TYPE: Record<string, string> = {
  ConfigMap:      'configmap',
  Deployment:     'apps.deployment',
  Service:        'service',
  ServiceAccount: 'serviceaccount',
  Role:           'rbac.authorization.k8s.io.role',
  RoleBinding:    'rbac.authorization.k8s.io.rolebinding',
};

interface ResourceStatus {
  kind: string;
  name: string;
  state: string;
  stateClass: string;
  link: string;
}

function deriveState(resource: InfraResource, live: any): { state: string; stateClass: string } {
  if (!live) {
    return { state: 'Not Found', stateClass: 'text-muted' };
  }

  switch (resource.kind) {
  case 'Deployment': {
    const ready = live.status?.readyReplicas || 0;
    const desired = live.spec?.replicas || 1;

    if (ready >= desired) {
      return { state: `Ready (${ ready }/${ desired })`, stateClass: 'text-success' };
    }

    return { state: `Progressing (${ ready }/${ desired })`, stateClass: 'text-warning' };
  }
  default:
    return { state: 'Active', stateClass: 'text-success' };
  }
}

export default defineComponent({
  components: { CeolTabs },

  data() {
    return {
      busy:             false,
      statusText:       '',
      deleteStorageToo: false,
      resources:        [] as ResourceStatus[],
      pollTimer:        null as ReturnType<typeof setInterval> | null,
    };
  },

  mounted() {
    this.refreshResources();
    this.pollTimer = setInterval(() => this.refreshResources(), 5000);
  },

  beforeUnmount() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
  },

  methods: {
    async k8sRequest(method: string, path: string, body?: any) {
      const url = `${ K8S_BASE }/${ path }`;
      const opt: any = {
        url,
        method,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
      };

      if (body) {
        opt.data = body;
      }

      return await this.$store.dispatch('management/request', { opt });
    },

    async refreshResources() {
      const results: ResourceStatus[] = [];

      for (const spec of infraResources) {
        const rancherType = KIND_TO_RANCHER_TYPE[spec.kind] || spec.kind.toLowerCase();
        const ns = spec.metadata.namespace || CEOL_NAMESPACE;
        const link = `/c/${ CLUSTER_ID }/explorer/${ rancherType }/${ ns }/${ spec.metadata.name }`;

        let live = null;

        try {
          live = await this.k8sRequest('GET', `${ collectionPath(spec) }/${ spec.metadata.name }`);
        } catch {
          // Resource doesn't exist yet
        }

        const { state, stateClass } = deriveState(spec, live);

        results.push({
          kind: spec.kind,
          name: spec.metadata.name,
          state,
          stateClass,
          link,
        });
      }

      this.resources = results;
    },

    async createInfrastructure() {
      this.busy = true;
      this.statusText = '';

      try {
        // 1. Find or create the ceol project
        this.statusText = 'Ensuring project...';
        const projectId = await this.ensureProject();

        // 2. Ensure the ceol-system namespace exists and is associated with the project
        this.statusText = 'Ensuring namespace...';
        await this.ensureNamespace(projectId);

        // 3. Delete all existing managed resources in the namespace
        this.statusText = 'Cleaning existing resources...';
        await this.deleteExistingResources();

        // 4. Create resources from infra definition
        this.statusText = 'Creating infrastructure...';
        for (const spec of infraResources) {
          await this.createResource(spec);
        }

        await this.refreshResources();
        this.statusText = 'Infrastructure created successfully.';
      } catch (err: any) {
        this.statusText = `Error: ${ err.message || err }`;
        console.error('Failed to create infrastructure:', err); // eslint-disable-line no-console
      } finally {
        this.busy = false;
      }
    },

    async ensureProject(): Promise<string> {
      const projects = await this.$store.dispatch('management/findAll', { type: MANAGEMENT.PROJECT });
      const existing = projects.find(
        (p: any) => p.spec?.displayName === CEOL_PROJECT_NAME && p.spec?.clusterName === CLUSTER_ID
      );

      if (existing) {
        return existing.metadata.name;
      }

      // Create via Norman API directly to avoid the project model needing currentCluster
      const resp = await this.$store.dispatch('management/request', {
        opt: {
          url:     '/v3/projects',
          method:  'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          data:    {
            type:        'project',
            name:        CEOL_PROJECT_NAME,
            description: 'Ceol extension infrastructure',
            clusterId:   CLUSTER_ID,
          },
        },
      });

      // Refresh the management store cache
      await this.$store.dispatch('management/findAll', { type: MANAGEMENT.PROJECT, opt: { force: true } });

      // resp.id is "local:p-xxxxx"
      return resp.id.split(':')[1];
    },

    async ensureNamespace(projectId: string) {
      const annotation = `${ CLUSTER_ID }:${ projectId }`;
      const nsBody = {
        apiVersion: 'v1',
        kind:       'Namespace',
        metadata:   {
          name:        CEOL_NAMESPACE,
          labels:      { 'field.cattle.io/projectId': projectId },
          annotations: { 'field.cattle.io/projectId': annotation },
        },
      };

      try {
        await this.k8sRequest('GET', `api/v1/namespaces/${ CEOL_NAMESPACE }`);
        await this.k8sRequest('PUT', `api/v1/namespaces/${ CEOL_NAMESPACE }`, nsBody);
      } catch {
        await this.k8sRequest('POST', 'api/v1/namespaces', nsBody);
      }
    },

    isStateful(resource: { kind: string; metadata: { name: string } }) {
      if (resource.kind === 'Deployment' && resource.metadata.name === 'gitea') {
        return true;
      }

      // Preserve bootstrap-generated resources that are only created by the Gitea init script
      if (resource.kind === 'ConfigMap' && resource.metadata.name === 'ceol-gitea-token') {
        return true;
      }

      if (resource.kind === 'Secret' && (resource.metadata.name === 'ceol-registry-auth' || resource.metadata.name === 'ceol-registry-pull')) {
        return true;
      }

      return false;
    },

    async deleteExistingResources() {
      for (const kind of MANAGED_KINDS) {
        try {
          const path = collectionPath(kind);
          const resp = await this.k8sRequest('GET', path);
          const items = resp?.items || [];

          for (const item of items) {
            if (!this.deleteStorageToo && this.isStateful({ kind: kind.kind, metadata: item.metadata })) {
              continue;
            }

            const deletePath = `${ path }/${ item.metadata.name }`;

            await this.k8sRequest('DELETE', deletePath);
          }
        } catch {
          // Type may not have any resources yet
        }
      }
    },

    async resourceExists(spec: InfraResource): Promise<boolean> {
      try {
        await this.k8sRequest('GET', `${ collectionPath(spec) }/${ spec.metadata.name }`);

        return true;
      } catch {
        return false;
      }
    },

    async createResource(spec: InfraResource) {
      if (!this.deleteStorageToo && this.isStateful(spec) && await this.resourceExists(spec)) {
        return;
      }

      const path = collectionPath(spec);

      await this.k8sRequest('POST', path, spec);
    },
  },
});
</script>

<template>
  <div>
    <CeolTabs />
    <div class="ceol-page">
    <label class="mt-20">
        <input
          v-model="deleteStorageToo"
          type="checkbox"
          :disabled="busy"
        />
        Delete storage too
      </label>

    <button
      class="btn role-primary mt-10"
      :disabled="busy"
      @click="createInfrastructure"
    >
      <i
        v-if="busy"
        class="icon icon-spinner icon-spin mr-5"
      />
      Create Infrastructure
    </button>

    <p
      v-if="statusText"
      class="mt-10"
    >
      {{ statusText }}
    </p>

    <table
      v-if="resources.length"
      class="sortable-table mt-20"
    >
      <thead>
        <tr>
          <th>Kind</th>
          <th>Name</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in resources"
          :key="`${ r.kind }/${ r.name }`"
        >
          <td>{{ r.kind }}</td>
          <td>
            <router-link :to="r.link">
              {{ r.name }}
            </router-link>
          </td>
          <td :class="r.stateClass">
            {{ r.state }}
          </td>
        </tr>
      </tbody>
    </table>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.ceol-page {
  padding: 20px;
}

.sortable-table {
  width: 100%;
  border-collapse: collapse;

  th, td {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }

  th {
    font-weight: 600;
    color: var(--text-secondary, #888);
    font-size: 12px;
    text-transform: uppercase;
  }

  td a {
    color: var(--primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
