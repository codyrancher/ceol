<script lang="ts">
import { defineComponent } from 'vue';
import CreateAppModal from '../components/CreateAppModal.vue';
import { fetchApps } from '../state/apps';
import { togglePin, getPinnedApps, syncPinnedProducts } from '../state/pins';
import { templates } from '../app-templates';
import type { App } from '../state/apps';

export default defineComponent({
  components: { CreateAppModal },

  data() {
    return {
      apps:             [] as App[],
      loading:          true,
      accessDenied:     false,
      statusText:       '',
      showModal:        false,
      search:           '',
      activeTemplate:   'all',
      activeCreator:    'all',
      pinnedNames:      [] as string[],
    };
  },

  computed: {
    existingNames(): string[] {
      return this.apps.map((a) => a.name);
    },

    currentUser(): string {
      const v3User = this.$store.getters['auth/v3User'];

      return v3User?.username || v3User?.name || '';
    },

    /** Apps visible to this user: prod-deployed OR owned by current user */
    visibleApps(): App[] {
      return this.apps.filter((a) => a.prodDeployed || a.createdBy === this.currentUser);
    },

    templateFilters(): Array<{ key: string; label: string; count: number }> {
      const all = { key: 'all', label: 'All', count: this.visibleApps.length };
      const byTemplate = templates.map((t) => ({
        key:   t.id,
        label: t.name,
        count: this.visibleApps.filter((a) => a.templateId === t.id).length,
      }));

      return [all, ...byTemplate.filter((f) => f.count > 0)];
    },

    creatorFilters(): Array<{ key: string; label: string; count: number }> {
      const all = { key: 'all', label: 'All', count: this.visibleApps.length };
      const creators = new Map<string, number>();

      for (const app of this.visibleApps) {
        creators.set(app.createdBy, (creators.get(app.createdBy) || 0) + 1);
      }

      const entries = [...creators.entries()].map(([name, count]) => ({
        key: name, label: name, count,
      }));

      // Current user first
      entries.sort((a, b) => {
        if (a.key === this.currentUser) return -1;
        if (b.key === this.currentUser) return 1;

        return a.label.localeCompare(b.label);
      });

      return [all, ...entries];
    },

    filteredApps(): App[] {
      let result = this.visibleApps;

      if (this.activeTemplate !== 'all') {
        result = result.filter((a) => a.templateId === this.activeTemplate);
      }

      if (this.activeCreator !== 'all') {
        result = result.filter((a) => a.createdBy === this.activeCreator);
      }

      const q = this.search.toLowerCase().trim();

      if (q) {
        result = result.filter((a) => a.name.toLowerCase().includes(q));
      }

      return result;
    },

    appCount(): string {
      const total = this.visibleApps.length;
      const shown = this.filteredApps.length;

      if (shown === total) {
        return `${ total } app${ total === 1 ? '' : 's' } in total`;
      }

      return `${ shown } of ${ total } apps`;
    },
  },

  mounted() {
    this.pinnedNames = getPinnedApps(this.$store);
    this.loadApps();
  },

  methods: {
    async loadApps() {
      this.loading = true;
      this.accessDenied = false;

      try {
        this.apps = await fetchApps(this.$store);
        this.statusText = '';
      } catch (err: any) {
        const status = err?.status || err?.statusCode;

        if (status === 403) {
          this.accessDenied = true;

          return;
        }

        const msg = err?.data || err?.message || err?.statusText || String(err);

        this.statusText = `Error loading apps: ${ msg }`;
      } finally {
        this.loading = false;
      }
    },

    onAppCreated() {
      this.showModal = false;
      this.loadApps();
    },

    isOwnApp(app: App): boolean {
      return app.createdBy === this.currentUser;
    },

    isAppPinned(app: App): boolean {
      return this.pinnedNames.includes(app.name);
    },

    onTogglePin(app: App, e: Event) {
      e.stopPropagation();
      togglePin(this.$store, app.name, app.icon);
      this.pinnedNames = getPinnedApps(this.$store);
      syncPinnedProducts(this.$store);
    },

    openProd(app: App) {
      if (!app.prodDeployed) {
        // Not deployed to prod — go to detail page instead
        this.$router.push({
          name:   'ceol-app-detail',
          params: { app: app.repoName },
        });

        return;
      }

      const route = this.$router.resolve({
        name:   'ceol-app-preview',
        params: { app: app.repoName, env: 'prod' },
      });

      window.open(route.href, '_blank');
    },

    openDetail(app: App, e: Event) {
      e.stopPropagation();
      this.$router.push({
        name:   'ceol-app-detail',
        params: { app: app.repoName },
      });
    },

    openSettings() {
      this.$router.push({
        name:   'ceol-settings',
        params: { cluster: this.$route.params.cluster },
      });
    },
  },
});
</script>

<template>
  <div class="ceol-apps-page">
    <!-- Access denied -->
    <div
      v-if="accessDenied"
      class="ceol-access-denied"
    >
      <i class="icon icon-lock ceol-access-denied__icon" />
      <h2 class="ceol-access-denied__title">
        Access Denied
      </h2>
      <p class="ceol-access-denied__text">
        You don't have permission to access Ceol. Contact your administrator to request access.
      </p>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="ceol-header">
        <h1 class="ceol-header__title">
          Ceol Apps
        </h1>
        <div class="ceol-header__actions">
          <button
            class="btn role-primary"
            @click="showModal = true"
          >
            Create App
          </button>
          <button
            class="btn role-multi-action"
            @click="openSettings"
          >
            <i class="icon icon-gear" />
          </button>
        </div>
      </div>

      <div class="ceol-body">
      <!-- Sidebar -->
      <div class="ceol-sidebar">
        <h3 class="ceol-sidebar__heading">
          Created By
        </h3>
        <div
          v-for="opt in creatorFilters"
          :key="'creator-' + opt.key"
          class="ceol-sidebar__item"
          :class="{ 'ceol-sidebar__item--active': activeCreator === opt.key }"
          role="button"
          tabindex="0"
          @click="activeCreator = opt.key"
          @keydown.enter="activeCreator = opt.key"
        >
          <span class="ceol-sidebar__label">{{ opt.label }}</span>
          <span class="ceol-sidebar__count">{{ opt.count }}</span>
        </div>

        <h3 class="ceol-sidebar__heading">
          Template
        </h3>
        <div
          v-for="opt in templateFilters"
          :key="'template-' + opt.key"
          class="ceol-sidebar__item"
          :class="{ 'ceol-sidebar__item--active': activeTemplate === opt.key }"
          role="button"
          tabindex="0"
          @click="activeTemplate = opt.key"
          @keydown.enter="activeTemplate = opt.key"
        >
          <span class="ceol-sidebar__label">{{ opt.label }}</span>
          <span class="ceol-sidebar__count">{{ opt.count }}</span>
        </div>
      </div>

      <!-- Main content -->
      <div class="ceol-main">
        <!-- Search -->
        <div class="ceol-search">
          <input
            v-model="search"
            type="text"
            class="ceol-search__input"
            placeholder="Search apps..."
          >
          <i class="ceol-search__icon icon icon-search" />
        </div>

        <!-- Status -->
        <p
          v-if="statusText"
          class="ceol-status"
        >
          {{ statusText }}
        </p>

        <!-- Content -->
        <div
          v-if="loading"
          class="text-muted ceol-empty"
        >
          Loading apps...
        </div>

        <div
          v-else-if="!apps.length && !statusText"
          class="text-muted ceol-empty"
        >
          No apps yet. Click <b>Create App</b> to get started.
        </div>

        <div
          v-else
          class="ceol-content"
        >
          <!-- App count -->
          <div class="ceol-count">
            {{ appCount }}
          </div>

          <!-- App list -->
          <div class="ceol-app-list">
            <div
              v-for="app in filteredApps"
              :key="app.id"
              class="ceol-app-card"
              :class="{ 'ceol-app-card--draft': !app.prodDeployed }"
              role="button"
              tabindex="0"
              @click="openProd(app)"
              @keydown.enter="openProd(app)"
            >
              <div class="ceol-app-card__icon">
                <i
                  class="icon"
                  :class="`icon-${ app.icon }`"
                />
              </div>
              <div class="ceol-app-card__info">
                <span class="ceol-app-card__name">
                  {{ app.name }}
                  <span
                    v-if="!app.prodDeployed"
                    class="ceol-app-card__badge"
                  >draft</span>
                </span>
                <span class="ceol-app-card__author">Author: {{ app.createdBy }}</span>
              </div>
              <div class="ceol-app-card__actions">
                <button
                  class="ceol-app-card__btn"
                  :class="{ 'ceol-app-card__btn--active': isAppPinned(app) }"
                  :title="isAppPinned(app) ? 'Unpin app' : 'Pin app'"
                  @click="onTogglePin(app, $event)"
                >
                  <i
                    class="icon"
                    :class="isAppPinned(app) ? 'icon-star' : 'icon-star-open'"
                  />
                </button>
                <button
                  v-if="isOwnApp(app)"
                  class="ceol-app-card__btn"
                  title="App settings"
                  @click="openDetail(app, $event)"
                >
                  <i class="icon icon-gear" />
                </button>
              </div>
            </div>

            <div
              v-if="filteredApps.length === 0 && visibleApps.length > 0"
              class="text-muted ceol-empty"
            >
              No apps match "{{ search }}"
            </div>
          </div>
        </div>
      </div>
    </div>

      <CreateAppModal
        v-if="showModal"
        :existing-names="existingNames"
        @close="showModal = false"
        @created="onAppCreated"
      />

    </template>
  </div>
</template>

<style lang="scss" scoped>
.ceol-apps-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0 20px 20px;
}

.ceol-access-denied {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  text-align: center;
  padding: 60px 20px;

  &__icon {
    font-size: 48px;
    color: var(--text-secondary, #888);
    margin-bottom: 16px;
  }

  &__title {
    font-size: 20px;
    font-weight: 500;
    margin: 0 0 8px;
  }

  &__text {
    font-size: 14px;
    color: var(--text-secondary, #888);
    max-width: 400px;
    margin: 0;
  }
}

.ceol-header {
  display: flex;
  align-items: center;
  justify-content: space-between;

  &__title {
    font-size: 20px;
    font-weight: 500;
    margin: 0;
  }

  &__actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
}

.ceol-body {
  display: flex;
  flex: 1;
  min-height: 0;
  margin-top: 20px;
  gap: 20px;
}

.ceol-sidebar {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  padding-right: 10px;

  &__heading {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-secondary, #888);
    letter-spacing: 0.5px;
    margin: 16px 0 6px;
    padding: 0 12px;

    &:first-child {
      margin-top: 0;
    }
  }

  &__item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-radius: var(--border-radius);
    cursor: pointer;
    font-size: 14px;
    color: var(--body-text);
    transition: background 0.1s;

    &:hover {
      background: var(--body-bg);
    }

    &--active {
      background: var(--primary) !important;
      color: #fff;
    }
  }

  &__count {
    font-size: 12px;
    opacity: 0.7;
  }
}

.ceol-main {
  flex: 1;
  min-width: 0;
}

.ceol-search {
  position: relative;
  margin-bottom: 20px;

  &__input {
    width: 100%;
    padding: 10px 40px 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--input-bg);
    color: var(--input-text);
    font-size: 14px;
    outline: none;

    &:focus {
      border-color: var(--primary);
    }

    &::placeholder {
      color: var(--input-placeholder, #999);
    }
  }

  &__icon {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--input-placeholder, #999);
    pointer-events: none;
  }
}

.ceol-status {
  margin-bottom: 10px;
}

.ceol-empty {
  padding: 40px 0;
  text-align: center;
}

.ceol-content {
  display: flex;
  flex-direction: column;
}

.ceol-count {
  font-size: 13px;
  color: var(--text-secondary, #888);
  margin-bottom: 12px;
}

.ceol-app-list {
  display: flex;
  flex-direction: column;
}

.ceol-app-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--border);
  margin-bottom: -1px;
  cursor: pointer;
  transition: background 0.1s;

  &:first-child {
    border-radius: var(--border-radius) var(--border-radius) 0 0;
  }

  &:last-child {
    border-radius: 0 0 var(--border-radius) var(--border-radius);
  }

  &:only-child {
    border-radius: var(--border-radius);
  }

  &:hover {
    background: var(--body-bg);
  }

  &__icon {
    width: 48px;
    height: 48px;
    border-radius: 8px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-bg, rgba(0, 120, 215, 0.06));
    font-size: 24px;
    color: var(--primary);
  }

  &--draft {
    opacity: 0.7;
  }

  &__info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  &__name {
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__badge {
    font-size: 11px;
    font-weight: 500;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--warning, #e6a23c);
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  &__author {
    font-size: 13px;
    color: var(--text-secondary, #888);
    margin-top: 4px;
  }

  &__actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    margin-left: auto;
  }

  &__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--border-radius);
    background: transparent;
    color: var(--text-secondary, #888);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;

    &:hover {
      background: var(--border);
      color: var(--body-text);
    }

    &--active {
      color: var(--primary);
    }
  }
}
</style>

<style lang="scss">
.indented-panel:has(.ceol-apps-page) {
  width: 100%;
  margin-left: 0;
}
</style>
