<script lang="ts">
import { defineComponent } from 'vue';
import CeolTabs from '../components/CeolTabs.vue';
import AppCard from '../components/AppCard.vue';
import CreateAppModal from '../components/CreateAppModal.vue';
import { fetchApps, createApp } from '../state/apps';
import type { App } from '../state/apps';

export default defineComponent({
  components: {
    CeolTabs, AppCard, CreateAppModal,
  },

  data() {
    return {
      apps:        [] as App[],
      loading:     true,
      creating:    false,
      statusText:  '',
      showModal:   false,
    };
  },

  computed: {
    existingNames(): string[] {
      return this.apps.map((a) => a.name);
    },
  },

  mounted() {
    this.loadApps();
  },

  methods: {
    async loadApps() {
      this.loading = true;

      try {
        this.apps = await fetchApps(this.$store);
        this.statusText = '';
      } catch (err: any) {
        const msg = err?.data || err?.message || err?.statusText || String(err);

        this.statusText = `Error loading apps: ${ msg }`;
      } finally {
        this.loading = false;
      }
    },

    async onCreateApp({ name, templateId }: { name: string; templateId: string }) {
      this.showModal = false;
      this.creating = true;
      this.statusText = 'Creating app...';

      try {
        await createApp(this.$store, name, templateId);
        await this.loadApps();
      } catch (err: any) {
        const msg = err?.data || err?.message || err?.statusText || JSON.stringify(err);

        this.statusText = `Error: ${ msg }`;
        console.error('Failed to create app:', err); // eslint-disable-line no-console
      } finally {
        this.creating = false;
      }
    },

    openApp(app: App) {
      this.$router.push({
        name:   'ceol-app-detail',
        params: { app: app.repoName },
      });
    },
  },
});
</script>

<template>
  <div>
    <CeolTabs>
      <template #actions>
        <button
          class="btn role-primary btn-sm"
          :disabled="creating"
          @click="showModal = true"
        >
          <i
            v-if="creating"
            class="icon icon-spinner icon-spin mr-5"
          />
          Create App
        </button>
      </template>
    </CeolTabs>
    <div class="ceol-page">
      <p
        v-if="statusText"
        class="mb-10"
      >
        {{ statusText }}
      </p>

      <div
        v-if="loading"
        class="text-muted"
      >
        Loading apps...
      </div>

      <div
        v-else-if="!apps.length && !statusText"
        class="text-muted"
      >
        No apps yet. Click <b>Create App</b> to get started.
      </div>

      <div
        v-else
        class="app-grid"
      >
        <AppCard
          v-for="app in apps"
          :key="app.id"
          :name="app.name"
          :logo="app.logo"
          @click="openApp(app)"
        />
      </div>
    </div>

    <CreateAppModal
      v-if="showModal"
      :existing-names="existingNames"
      @close="showModal = false"
      @create="onCreateApp"
    />
  </div>
</template>

<style lang="scss" scoped>
.ceol-page {
  padding: 20px;
}

.app-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}
</style>
