<script lang="ts">
import { defineComponent } from 'vue';
import { MANAGEMENT } from '@shell/config/types';
import InfrastructurePage from './infrastructure.vue';
import { CEOL_PROJECT_NAME } from '../infra';

const CLUSTER_ID = 'local';
const K8S_BASE = `/k8s/clusters/${ CLUSTER_ID }`;
const CEOL_NAMESPACE = 'ceol-system';
const RBAC_CM_NAME = 'ceol-rbac';
const ROLE_TEMPLATE = 'project-member';

type AccessMode = 'everyone' | 'whitelist' | 'blacklist';

interface RbacConfig {
  mode: AccessMode;
  users: string[];
}

interface RancherUser {
  id: string;
  username: string;
  name: string;
  principalIds: string[];
}

export default defineComponent({
  components: { InfrastructurePage },

  data() {
    return {
      activeTab:    'general' as 'general' | 'infrastructure',
      rbac:         { mode: 'everyone', users: [] } as RbacConfig,
      rbacLoading:  true,
      rbacSaving:   false,
      rbacSyncing:  false,
      rbacStatus:   '',
      allUsers:     [] as RancherUser[],
      userSearch:   '',
    };
  },

  computed: {
    modeOptions(): Array<{ value: AccessMode; label: string; description: string }> {
      return [
        { value: 'everyone', label: 'Everyone', description: 'All authenticated users can access Ceol' },
        { value: 'whitelist', label: 'Whitelist', description: 'Only selected users can access Ceol' },
        { value: 'blacklist', label: 'Blacklist', description: 'All users except selected ones can access Ceol' },
      ];
    },

    userListLabel(): string {
      return this.rbac.mode === 'whitelist' ? 'Allowed Users' : 'Blocked Users';
    },

    currentUser(): string {
      const v3User = this.$store.getters['auth/v3User'];

      return v3User?.username || v3User?.name || '';
    },

    filteredUsers(): Array<{ username: string; name: string; selected: boolean }> {
      const q = this.userSearch.toLowerCase().trim();

      return this.allUsers
        .map((u) => ({
          username: u.username,
          name:     u.name,
          selected: this.rbac.users.includes(u.username),
        }))
        .filter((u) => {
          if (!q) {
            return true;
          }

          return u.username.toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
        })
        .sort((a, b) => {
          if (a.selected !== b.selected) {
            return a.selected ? -1 : 1;
          }

          return a.username.localeCompare(b.username);
        });
    },
  },

  mounted() {
    this.loadRbac();
    this.loadUsers();
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

    async loadRbac() {
      this.rbacLoading = true;

      try {
        const cm = await this.k8sRequest('GET', `api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps/${ RBAC_CM_NAME }`);

        this.rbac = {
          mode:  (cm.data?.mode as AccessMode) || 'everyone',
          users: cm.data?.users ? JSON.parse(cm.data.users) : [],
        };
      } catch {
        // ConfigMap doesn't exist yet, use defaults
        this.rbac = { mode: 'everyone', users: [] };
      } finally {
        this.rbacLoading = false;
      }
    },

    async loadUsers() {
      try {
        const resp = await this.$store.dispatch('management/request', {
          opt: { url: '/v3/users', method: 'GET' },
        });

        this.allUsers = (resp?.data || []).map((u: any) => ({
          id:           u.id,
          username:     u.username || u.id,
          name:         u.name || u.username || u.id,
          principalIds: u.principalIds || [`local://${ u.id }`],
        }));
      } catch {
        this.allUsers = [];
      }
    },

    toggleUser(username: string) {
      const idx = this.rbac.users.indexOf(username);

      if (idx >= 0) {
        this.rbac.users.splice(idx, 1);
      } else {
        this.rbac.users.push(username);
      }
    },

    async getCeolProjectId(): Promise<string | null> {
      const projects = await this.$store.dispatch('management/findAll', { type: MANAGEMENT.PROJECT });
      const project = projects.find(
        (p: any) => p.spec?.displayName === CEOL_PROJECT_NAME && p.spec?.clusterName === CLUSTER_ID
      );

      return project?.metadata?.name || null;
    },

    computeAllowedUsers(): Set<string> {
      const allUsernames = new Set(this.allUsers.map((u) => u.username));

      switch (this.rbac.mode) {
      case 'everyone':
        return allUsernames;
      case 'whitelist':
        return new Set(this.rbac.users);
      case 'blacklist': {
        const blocked = new Set(this.rbac.users);

        return new Set([...allUsernames].filter((u) => !blocked.has(u)));
      }
      default:
        return allUsernames;
      }
    },

    async syncProjectMembership() {
      const projectId = await this.getCeolProjectId();

      if (!projectId) {
        throw new Error('Ceol project not found. Create infrastructure first.');
      }

      const fullProjectId = `local:${ projectId }`;
      const allowed = this.computeAllowedUsers();

      // Always keep the current admin
      allowed.add(this.currentUser);

      // Fetch existing PRTBs for this project
      const resp = await this.$store.dispatch('management/request', {
        opt: { url: `/v3/projectRoleTemplateBindings?projectId=${ fullProjectId }`, method: 'GET' },
      });

      const existingBindings: any[] = resp?.data || [];

      // Build a map: username -> binding (only ceol-managed ones with project-member role)
      const bindingByUser = new Map<string, any>();

      for (const b of existingBindings) {
        if (b.roleTemplateId !== ROLE_TEMPLATE) {
          continue;
        }

        // Find which user this binding belongs to
        const user = this.allUsers.find((u) =>
          u.principalIds.includes(b.userPrincipalId) || `local://${ u.id }` === b.userPrincipalId
        );

        if (user) {
          bindingByUser.set(user.username, b);
        }
      }

      // Create bindings for allowed users who don't have one
      for (const username of allowed) {
        if (bindingByUser.has(username)) {
          continue;
        }

        const user = this.allUsers.find((u) => u.username === username);

        if (!user) {
          continue;
        }

        const principalId = user.principalIds.find((p: string) => p.startsWith('local://')) || `local://${ user.id }`;

        await this.$store.dispatch('management/request', {
          opt: {
            url:     '/v3/projectRoleTemplateBindings',
            method:  'POST',
            headers: { 'content-type': 'application/json' },
            data:    {
              type:            'projectRoleTemplateBinding',
              projectId:       fullProjectId,
              roleTemplateId:  ROLE_TEMPLATE,
              userPrincipalId: principalId,
            },
          },
        });
      }

      // Remove bindings for users who should not have access
      for (const [username, binding] of bindingByUser) {
        if (allowed.has(username)) {
          continue;
        }

        await this.$store.dispatch('management/request', {
          opt: {
            url:    `/v3/projectRoleTemplateBindings/${ binding.id }`,
            method: 'DELETE',
          },
        });
      }
    },

    async saveRbac() {
      this.rbacSaving = true;
      this.rbacStatus = '';

      const data = {
        mode:  this.rbac.mode,
        users: JSON.stringify(this.rbac.users),
      };

      try {
        // Save ConfigMap
        try {
          await this.k8sRequest('GET', `api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps/${ RBAC_CM_NAME }`);
          await this.k8sRequest('PUT', `api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps/${ RBAC_CM_NAME }`, {
            apiVersion: 'v1',
            kind:       'ConfigMap',
            metadata:   { name: RBAC_CM_NAME, namespace: CEOL_NAMESPACE },
            data,
          });
        } catch {
          await this.k8sRequest('POST', `api/v1/namespaces/${ CEOL_NAMESPACE }/configmaps`, {
            apiVersion: 'v1',
            kind:       'ConfigMap',
            metadata:   { name: RBAC_CM_NAME, namespace: CEOL_NAMESPACE },
            data,
          });
        }

        // Sync project membership
        await this.syncProjectMembership();

        this.rbacStatus = 'Settings saved and membership synced.';
      } catch (err: any) {
        this.rbacStatus = `Error: ${ err.message || err }`;
      } finally {
        this.rbacSaving = false;
      }
    },

    async resyncMembership() {
      this.rbacSyncing = true;
      this.rbacStatus = '';

      try {
        await this.loadUsers();
        await this.syncProjectMembership();
        this.rbacStatus = 'Membership synced.';
      } catch (err: any) {
        this.rbacStatus = `Error: ${ err.message || err }`;
      } finally {
        this.rbacSyncing = false;
      }
    },
  },
});
</script>

<template>
  <div class="ceol-settings">
    <div class="ceol-settings__header">
      <h1 class="ceol-settings__title">
        Settings
      </h1>
    </div>

    <!-- Tabs -->
    <div class="ceol-settings__tabs">
      <button
        class="ceol-settings__tab"
        :class="{ 'ceol-settings__tab--active': activeTab === 'general' }"
        @click="activeTab = 'general'"
      >
        Access Control
      </button>
      <button
        class="ceol-settings__tab"
        :class="{ 'ceol-settings__tab--active': activeTab === 'infrastructure' }"
        @click="activeTab = 'infrastructure'"
      >
        Infrastructure
      </button>
    </div>

    <!-- Access Control Tab -->
    <div
      v-if="activeTab === 'general'"
      class="ceol-settings__content"
    >
      <div
        v-if="rbacLoading"
        class="text-muted"
      >
        Loading settings...
      </div>

      <template v-else>
        <h3 class="ceol-settings__section-title">
          Access Mode
        </h3>

        <div class="ceol-mode-options">
          <label
            v-for="opt in modeOptions"
            :key="opt.value"
            class="ceol-mode-option"
            :class="{ 'ceol-mode-option--selected': rbac.mode === opt.value }"
          >
            <input
              v-model="rbac.mode"
              type="radio"
              :value="opt.value"
              class="ceol-mode-option__radio"
            >
            <div class="ceol-mode-option__text">
              <span class="ceol-mode-option__label">{{ opt.label }}</span>
              <span class="ceol-mode-option__desc">{{ opt.description }}</span>
            </div>
          </label>
        </div>

        <!-- User list for whitelist/blacklist -->
        <template v-if="rbac.mode !== 'everyone'">
          <h3 class="ceol-settings__section-title mt-20">
            {{ userListLabel }}
          </h3>

          <div class="ceol-user-search">
            <input
              v-model="userSearch"
              type="text"
              class="ceol-user-search__input"
              placeholder="Search users..."
            >
            <i class="ceol-user-search__icon icon icon-search" />
          </div>

          <div class="ceol-user-list">
            <div
              v-if="!allUsers.length"
              class="text-muted p-10"
            >
              No users found.
            </div>
            <label
              v-for="u in filteredUsers"
              :key="u.username"
              class="ceol-user-item"
              :class="{ 'ceol-user-item--selected': u.selected }"
            >
              <input
                type="checkbox"
                :checked="u.selected"
                @change="toggleUser(u.username)"
              >
              <span class="ceol-user-item__name">{{ u.username }}</span>
              <span
                v-if="u.name && u.name !== u.username"
                class="ceol-user-item__display"
              >{{ u.name }}</span>
            </label>
          </div>
        </template>

        <div class="ceol-settings__actions mt-20">
          <button
            class="btn role-primary"
            :disabled="rbacSaving || rbacSyncing"
            @click="saveRbac"
          >
            <i
              v-if="rbacSaving"
              class="icon icon-spinner icon-spin mr-5"
            />
            {{ rbacSaving ? 'Saving...' : 'Save' }}
          </button>
          <button
            class="btn role-secondary"
            :disabled="rbacSaving || rbacSyncing"
            @click="resyncMembership"
          >
            <i
              v-if="rbacSyncing"
              class="icon icon-spinner icon-spin mr-5"
            />
            {{ rbacSyncing ? 'Syncing...' : 'Resync Membership' }}
          </button>
        </div>

        <p
          v-if="rbacStatus"
          class="ceol-settings__status-msg mt-10"
          :class="{ 'text-error': rbacStatus.startsWith('Error') }"
        >
          {{ rbacStatus }}
        </p>

        <p class="ceol-settings__note mt-10">
          Saving updates the Rancher project membership for the Ceol project. If new users are added to Rancher after saving, click <b>Resync Membership</b> to update their access.
        </p>
      </template>
    </div>

    <!-- Infrastructure Tab -->
    <div
      v-if="activeTab === 'infrastructure'"
      class="ceol-settings__content ceol-settings__content--wide"
    >
      <InfrastructurePage />
    </div>

  </div>
</template>


<style lang="scss" scoped>
.ceol-settings {
  padding: 20px;

  &__header {
    margin-bottom: 20px;
  }

  &__title {
    font-size: 20px;
    font-weight: 500;
    margin: 0;
  }

  &__tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    margin-bottom: 20px;
  }

  &__tab {
    padding: 10px 20px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 14px;
    color: var(--body-text);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;

    &:hover:not(&--active) {
      border-bottom-color: var(--border);
    }

    &--active {
      border-bottom-color: var(--primary);
      color: var(--primary);
    }
  }

  &__content {
    max-width: 700px;

    &--wide {
      max-width: none;
    }
  }

  &__section-title {
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 12px;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  &__status-msg {
    font-size: 13px;
    color: var(--success);
  }

  &__note {
    font-size: 12px;
    color: var(--text-secondary, #888);
    line-height: 1.5;
  }
}

.ceol-mode-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ceol-mode-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 2px solid var(--border);
  border-radius: var(--border-radius);
  cursor: pointer;
  transition: border-color 0.15s;

  &:hover {
    border-color: var(--primary);
  }

  &--selected {
    border-color: var(--primary);
    background: var(--accent-bg, rgba(0, 120, 215, 0.06));
  }

  &__radio {
    margin-top: 2px;
  }

  &__text {
    display: flex;
    flex-direction: column;
  }

  &__label {
    font-size: 14px;
    font-weight: 600;
  }

  &__desc {
    font-size: 12px;
    color: var(--text-secondary, #888);
    margin-top: 2px;
  }
}

.ceol-user-search {
  position: relative;
  margin-bottom: 10px;

  &__input {
    width: 100%;
    padding: 8px 36px 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    background: var(--input-bg);
    color: var(--input-text);
    font-size: 14px;
    outline: none;

    &:focus {
      border-color: var(--primary);
    }
  }

  &__icon {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--input-placeholder, #999);
    pointer-events: none;
  }
}

.ceol-user-list {
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  max-height: 300px;
  overflow-y: auto;
}

.ceol-user-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--body-bg);
  }

  &--selected {
    background: var(--accent-bg, rgba(0, 120, 215, 0.04));
  }

  &__name {
    font-size: 14px;
    font-weight: 500;
  }

  &__display {
    font-size: 12px;
    color: var(--text-secondary, #888);
  }
}
</style>
