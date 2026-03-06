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

export default defineComponent({
  components: { CeolTabs },

  data() {
    return {
      busy:             false,
      statusText:       '',
      deleteStorageToo: false,
    };
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

    isStorage(resource: { kind: string }) {
      return resource.kind === 'PersistentVolumeClaim';
    },

    async deleteExistingResources() {
      for (const kind of MANAGED_KINDS) {
        if (this.isStorage(kind) && !this.deleteStorageToo) {
          continue;
        }

        try {
          const path = collectionPath(kind);
          const resp = await this.k8sRequest('GET', path);
          const items = resp?.items || [];

          for (const item of items) {
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
      // Skip storage creation if it already exists and we're preserving storage
      if (this.isStorage(spec) && !this.deleteStorageToo && await this.resourceExists(spec)) {
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
    </div>
  </div>
</template>

<style lang="scss" scoped>
.ceol-page {
  padding: 20px;
}
</style>
