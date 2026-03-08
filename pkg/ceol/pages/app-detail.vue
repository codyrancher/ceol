<script lang="ts">
import { defineComponent } from 'vue';
import { _VIEW } from '@shell/config/query-params';
import CeolTabs from '../components/CeolTabs.vue';
import CodeMirror from '@shell/components/CodeMirror.vue';
import { ensureGiteaAdmin, getRepoTree, getFileContent, getCloneInfo, getLatestCommitDate } from '../app-templates/gitea';
import { deleteApp } from '../state/apps';
import {
  getBuildStatus, triggerBuild, pollBuildStatus,
  promoteToProd, pollPromoteStatus,
  fetchBuildLogs, fetchAppInfra,
} from '../state/builds';
import type { GiteaTreeEntry } from '../app-templates/gitea';
import type { AppEnvironment, AppResource } from '../state/builds';

interface FlatEntry {
  name: string;
  path: string;
  type: 'blob' | 'tree';
  size: number;
  depth: number;
  open: boolean;
  parentPath: string;
  lastCommitSha?: string;
  lastCommitDate?: string;
}

const EXT_TO_CM_MODE: Record<string, string> = {
  js:         'javascript',
  ts:         'javascript',
  jsx:        'jsx',
  tsx:        'jsx',
  json:       'application/json',
  html:       'htmlmixed',
  vue:        'htmlmixed',
  css:        'css',
  scss:       'text/x-scss',
  less:       'text/x-less',
  md:         'markdown',
  yaml:       'yaml',
  yml:        'yaml',
  xml:        'xml',
  svg:        'xml',
  sh:         'shell',
  bash:       'shell',
  dockerfile: 'dockerfile',
  py:         'python',
  go:         'go',
  rs:         'rust',
  sql:        'sql',
};

function cmModeForFile(filename: string): string {
  const lower = filename.toLowerCase();

  if (lower === 'dockerfile') {
    return 'dockerfile';
  }

  const ext = lower.split('.').pop() || '';

  return EXT_TO_CM_MODE[ext] || 'text/plain';
}

function buildFlatTree(entries: GiteaTreeEntry[]): FlatEntry[] {
  const sorted = [...entries].sort((a, b) => {
    const aParts = a.path.split('/');
    const bParts = b.path.split('/');

    for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
      if (aParts[i] !== bParts[i]) {
        const aIsDir = i < aParts.length - 1 || a.type === 'tree';
        const bIsDir = i < bParts.length - 1 || b.type === 'tree';

        if (aIsDir !== bIsDir) {
          return aIsDir ? -1 : 1;
        }

        return aParts[i].localeCompare(bParts[i]);
      }
    }

    return aParts.length - bParts.length;
  });

  return sorted.map((entry) => {
    const parts = entry.path.split('/');
    const parentPath = parts.slice(0, -1).join('/');

    return {
      name:           parts[parts.length - 1],
      path:           entry.path,
      type:           entry.type,
      size:           entry.size,
      depth:          parts.length - 1,
      open:           true,
      parentPath,
      lastCommitSha:  entry.lastCommitSha,
      lastCommitDate: entry.lastCommitDate,
    };
  });
}

function relativeTime(dateStr: string): string {
  const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);

  if (diffSec < 60) {
    return `${ diffSec }s ago`;
  }

  if (diffSec < 3600) {
    return `${ Math.floor(diffSec / 60) }m ago`;
  }

  if (diffSec < 86400) {
    return `${ Math.floor(diffSec / 3600) }h ago`;
  }

  if (diffSec < 2592000) {
    return `${ Math.floor(diffSec / 86400) }d ago`;
  }

  if (diffSec < 31536000) {
    return `${ Math.floor(diffSec / 2592000) }mo ago`;
  }

  return `${ Math.floor(diffSec / 31536000) }y ago`;
}

export default defineComponent({
  components: { CeolTabs, CodeMirror },

  data() {
    return {
      repoName:       this.$route.params.app as string,
      entries:        [] as FlatEntry[],
      loading:        true,
      deleting:       false,
      error:          '',
      cloneCmd:       '',
      copied:         false,
      viewMode:       _VIEW,
      // Build & deploy state
      buildEnv:       { staging: { state: 'idle', message: '', timestamp: '', imageTag: '' }, prod: { state: 'idle', message: '', timestamp: '', imageTag: '' } } as AppEnvironment,
      buildPolling:   null as ReturnType<typeof setInterval> | null,
      building:       false,
      promoting:      false,
      // Log viewer state
      logsOpen:       false,
      logsContent:    '',
      logsLoading:    false,
      logsPollTimer:  null as ReturnType<typeof setInterval> | null,
      // File viewer state
      viewerOpen:     false,
      viewerPath:     '',
      viewerContent:  '',
      viewerLoading:  false,
      viewerCmMode:   'text/plain',
      // Detail tab
      detailTab:      'source' as 'source' | 'infrastructure',
      // Source last-updated
      lastCommitDate:   null as string | null,
      lastUpdatedLabel: '',
      lastUpdatedTimer: null as ReturnType<typeof setInterval> | null,
      commitPollTimer:  null as ReturnType<typeof setInterval> | null,
      // Infrastructure state
      infraResources: [] as AppResource[],
      infraPollTimer: null as ReturnType<typeof setInterval> | null,
    };
  },

  computed: {
    visibleEntries(): FlatEntry[] {
      const closedDirs = new Set<string>();

      return this.entries.filter((entry) => {
        for (const dir of closedDirs) {
          if (entry.path.startsWith(`${ dir }/`)) {
            return false;
          }
        }

        if (entry.type === 'tree' && !entry.open) {
          closedDirs.add(entry.path);
        }

        return true;
      });
    },

    canPromote(): boolean {
      return this.buildEnv.staging.state === 'success' && !this.promoting;
    },

    parsedLogs(): Array<{ type: string; text: string }> {
      if (!this.logsContent) {
        return [];
      }

      return this.logsContent.split('\n').map((line: string) => {
        if (line.startsWith('--- ') && line.endsWith(' ---')) {
          return { type: 'header', text: line.slice(4, -4) };
        }

        const lower = line.toLowerCase();

        if (lower.includes('error') || lower.includes('fatal') || lower.includes('fail')) {
          return { type: 'error', text: line };
        }

        if (lower.includes('warn')) {
          return { type: 'warn', text: line };
        }

        if (lower.startsWith('waiting:') || line === '(no output)' || line === '(logs not available yet)') {
          return { type: 'muted', text: line };
        }

        if (
          lower.startsWith('step ') || lower.startsWith('---> ') ||
          lower.startsWith('info[') || lower.includes('successfully') ||
          lower.startsWith('cloning') || lower.startsWith('enumerating') ||
          lower.startsWith('receiving') || lower.startsWith('resolving')
        ) {
          return { type: 'step', text: line };
        }

        return { type: 'default', text: line };
      });
    },
  },

  mounted() {
    this.loadTree();
    this.loadBuildStatus();
    this.loadInfra();
    this.loadLastCommit();

    // Refresh the relative time label every 10s
    this.lastUpdatedTimer = setInterval(() => this.refreshLabel(), 10000);
    // Poll for new commits every 30s
    this.commitPollTimer = setInterval(() => this.loadLastCommit(), 30000);
  },

  beforeUnmount() {
    if (this.buildPolling) {
      clearInterval(this.buildPolling);
    }

    if (this.logsPollTimer) {
      clearInterval(this.logsPollTimer);
    }

    if (this.lastUpdatedTimer) {
      clearInterval(this.lastUpdatedTimer);
    }

    if (this.commitPollTimer) {
      clearInterval(this.commitPollTimer);
    }

    if (this.infraPollTimer) {
      clearInterval(this.infraPollTimer);
    }
  },

  methods: {
    relativeTime,

    async loadBuildStatus() {
      this.buildEnv = await getBuildStatus(this.$store, this.repoName);
    },

    startPolling() {
      if (this.buildPolling) {
        return;
      }

      this.buildPolling = setInterval(async() => {
        try {
          if (this.buildEnv.staging.state === 'building') {
            this.buildEnv.staging = await pollBuildStatus(this.$store, this.repoName);
          }

          if (this.buildEnv.prod.state === 'building') {
            this.buildEnv.prod = await pollPromoteStatus(this.$store, this.repoName);
          }
        } catch (err: any) {
          console.error('Poll error:', err);
          this.error = err?.message || String(err);
        }

        if (this.buildEnv.staging.state !== 'building' && this.buildEnv.prod.state !== 'building') {
          clearInterval(this.buildPolling!);
          this.buildPolling = null;
          this.building = false;
          this.promoting = false;
        }
      }, 5000);
    },

    scrollLogsToBottom() {
      this.$nextTick(() => {
        const el = this.$refs.logsRef as HTMLElement | undefined;

        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    },

    async openLogs() {
      this.logsOpen = true;
      this.logsLoading = true;
      this.logsContent = '';

      try {
        this.logsContent = await fetchBuildLogs(this.$store, this.repoName);
      } catch (err: any) {
        this.logsContent = `Error fetching logs: ${ err?.message || err }`;
      } finally {
        this.logsLoading = false;
        this.scrollLogsToBottom();
      }

      // If build is active, poll for live logs
      this.startLogPolling();
    },

    startLogPolling() {
      if (this.logsPollTimer) {
        clearInterval(this.logsPollTimer);
        this.logsPollTimer = null;
      }

      if (this.buildEnv.staging.state !== 'building') {
        return;
      }

      this.logsPollTimer = setInterval(async() => {
        if (!this.logsOpen) {
          clearInterval(this.logsPollTimer!);
          this.logsPollTimer = null;

          return;
        }

        try {
          this.logsContent = await fetchBuildLogs(this.$store, this.repoName);
          this.scrollLogsToBottom();
        } catch {
          // Ignore transient log fetch errors
        }

        // Stop polling if build finished
        if (this.buildEnv.staging.state !== 'building') {
          // One final fetch to get complete logs
          try {
            this.logsContent = await fetchBuildLogs(this.$store, this.repoName);
          } catch {
            // ignore
          }
          clearInterval(this.logsPollTimer!);
          this.logsPollTimer = null;
        }
      }, 3000);
    },

    closeLogs() {
      this.logsOpen = false;

      if (this.logsPollTimer) {
        clearInterval(this.logsPollTimer);
        this.logsPollTimer = null;
      }
    },

    async onBuildStaging() {
      this.building = true;
      this.error = '';

      try {
        await triggerBuild(this.$store, this.repoName);
        await this.loadBuildStatus();
        this.startPolling();
        this.openLogs();
      } catch (err: any) {
        this.error = err?.message || String(err);
        this.building = false;
      }
    },

    async onPromoteProd() {
      this.promoting = true;
      this.error = '';

      try {
        await promoteToProd(this.$store, this.repoName);
        await this.loadBuildStatus();
        this.startPolling();
      } catch (err: any) {
        this.error = err?.message || String(err);
        this.promoting = false;
      }
    },

    async loadTree() {
      this.loading = true;
      this.error = '';

      try {
        const owner = await ensureGiteaAdmin(this.$store);
        const raw = await getRepoTree(this.$store, owner, this.repoName);

        this.entries = buildFlatTree(raw);
        const info = await getCloneInfo(this.$store, this.repoName);

        this.cloneCmd = info.cloneCmd;
      } catch (err: any) {
        this.error = err?.message || String(err);
      } finally {
        this.loading = false;
      }
    },

    copyCloneCmd() {
      try {
        navigator.clipboard.writeText(this.cloneCmd);
      } catch {
        const el = document.createElement('textarea');

        el.value = this.cloneCmd;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }

      this.copied = true;
      setTimeout(() => { this.copied = false; }, 2000);
    },

    toggle(entry: FlatEntry) {
      entry.open = !entry.open;
    },

    async openFile(entry: FlatEntry) {
      this.viewerOpen = true;
      this.viewerPath = entry.path;
      this.viewerContent = '';
      this.viewerLoading = true;
      this.viewerCmMode = cmModeForFile(entry.name);

      try {
        const owner = await ensureGiteaAdmin(this.$store);

        this.viewerContent = await getFileContent(this.$store, owner, this.repoName, entry.path);
      } catch (err: any) {
        this.viewerContent = `Error loading file: ${ err?.message || err }`;
      } finally {
        this.viewerLoading = false;
      }
    },

    closeViewer() {
      this.viewerOpen = false;
    },

    onEntryClick(entry: FlatEntry) {
      if (entry.type === 'tree') {
        this.toggle(entry);
      } else {
        this.openFile(entry);
      }
    },

    async loadLastCommit() {
      const owner = await ensureGiteaAdmin(this.$store);
      const date = await getLatestCommitDate(this.$store, owner, this.repoName);

      this.lastCommitDate = date;
      this.refreshLabel();
    },

    refreshLabel() {
      if (!this.lastCommitDate) {
        this.lastUpdatedLabel = '';

        return;
      }

      const now = Date.now();
      const then = new Date(this.lastCommitDate).getTime();
      const diffSec = Math.floor((now - then) / 1000);

      if (diffSec < 60) {
        this.lastUpdatedLabel = `${ diffSec }s ago`;
      } else if (diffSec < 3600) {
        const m = Math.floor(diffSec / 60);

        this.lastUpdatedLabel = `${ m }m ago`;
      } else if (diffSec < 86400) {
        const h = Math.floor(diffSec / 3600);

        this.lastUpdatedLabel = `${ h }h ago`;
      } else if (diffSec < 2592000) {
        const d = Math.floor(diffSec / 86400);

        this.lastUpdatedLabel = `${ d }d ago`;
      } else if (diffSec < 31536000) {
        const mo = Math.floor(diffSec / 2592000);

        this.lastUpdatedLabel = `${ mo }mo ago`;
      } else {
        const y = Math.floor(diffSec / 31536000);

        this.lastUpdatedLabel = `${ y }y ago`;
      }
    },

    async loadInfra() {
      this.infraResources = await fetchAppInfra(this.$store, this.repoName);

      if (!this.infraPollTimer) {
        this.infraPollTimer = setInterval(() => this.loadInfra(), 15000);
      }
    },

    async onDelete() {
      if (!confirm(`Delete "${ this.repoName }" and its repository?`)) {
        return;
      }

      this.deleting = true;

      try {
        await deleteApp(this.$store, this.repoName);
        this.$router.push({ name: 'ceol' });
      } catch (err: any) {
        this.error = err?.message || String(err);
        this.deleting = false;
      }
    },
  },
});
</script>

<template>
  <div>
    <CeolTabs />
    <div class="ceol-page">
      <div class="app-header">
        <h2>{{ repoName }}</h2>
        <button
          class="btn-delete"
          :disabled="deleting"
          @click="onDelete"
        >
          <i
            class="icon"
            :class="deleting ? 'icon-spinner icon-spin' : 'icon-trash'"
          />
        </button>
      </div>

      <div
        v-if="cloneCmd"
        class="clone-box mb-20"
      >
        <code class="clone-cmd">{{ cloneCmd }}</code>
        <button
          class="btn role-link btn-sm clone-copy"
          @click="copyCloneCmd"
        >
          <i
            class="icon"
            :class="copied ? 'icon-checkmark' : 'icon-copy'"
          />
        </button>
      </div>

      <!-- Build & Deploy -->
      <div class="build-section mb-20">
        <div class="build-actions">
          <button
            class="btn role-primary btn-sm"
            :disabled="building || buildEnv.staging.state === 'building'"
            @click="onBuildStaging"
          >
            <i
              class="icon mr-5"
              :class="building || buildEnv.staging.state === 'building' ? 'icon-spinner icon-spin' : 'icon-upload'"
            />
            Build Staging
          </button>
          <button
            class="btn role-secondary btn-sm ml-10"
            :disabled="!canPromote"
            @click="onPromoteProd"
          >
            <i
              class="icon mr-5"
              :class="promoting || buildEnv.prod.state === 'building' ? 'icon-spinner icon-spin' : 'icon-chevron-up'"
            />
            Promote to Prod
          </button>
        </div>

        <div class="env-status mt-10">
          <div class="env-row">
            <span class="env-label">Staging:</span>
            <span
              class="env-state"
              :class="{
                'text-success': buildEnv.staging.state === 'success',
                'text-warning': buildEnv.staging.state === 'building',
                'text-error': buildEnv.staging.state === 'error',
                'text-muted': buildEnv.staging.state === 'idle',
              }"
            >{{ buildEnv.staging.state }}</span>
            <router-link
              v-if="buildEnv.staging.state === 'success'"
              :to="{ name: 'ceol-app-preview', params: { cluster: $route.params.cluster, app: repoName, env: 'staging' } }"
              class="env-link ml-10"
            >
              Open Staging
            </router-link>
            <a
              v-if="buildEnv.staging.state !== 'idle'"
              class="env-link ml-10"
              href="#"
              @click.prevent="openLogs"
            >View Logs</a>
          </div>
          <div class="env-row mt-5">
            <span class="env-label">Prod:</span>
            <span
              class="env-state"
              :class="{
                'text-success': buildEnv.prod.state === 'success',
                'text-warning': buildEnv.prod.state === 'building',
                'text-error': buildEnv.prod.state === 'error',
                'text-muted': buildEnv.prod.state === 'idle',
              }"
            >{{ buildEnv.prod.state }}</span>
            <router-link
              v-if="buildEnv.prod.state === 'success'"
              :to="{ name: 'ceol-app-preview', params: { cluster: $route.params.cluster, app: repoName, env: 'prod' } }"
              class="env-link ml-10"
            >
              Open Prod
            </router-link>
          </div>
        </div>

        <!-- Log viewer panel -->
        <div
          v-if="logsOpen"
          class="logs-panel mt-10"
        >
          <div class="logs-header">
            <span class="logs-title">
              <i
                v-if="buildEnv.staging.state === 'building'"
                class="icon icon-spinner icon-spin mr-5"
              />
              Build Logs
            </span>
            <button
              class="btn role-link btn-sm"
              @click="closeLogs"
            >
              <i class="icon icon-close" />
            </button>
          </div>
          <div
            ref="logsRef"
            class="logs-body"
          >
            <div
              v-if="logsLoading"
              class="text-muted pa-10"
            >
              Loading logs...
            </div>
            <template v-else>
              <div
                v-for="(line, idx) in parsedLogs"
                :key="idx"
                class="log-line"
                :class="`log-line--${ line.type }`"
              >
                <span
                  v-if="line.type === 'header'"
                  class="log-line__icon"
                >&#9654;</span>
                <span>{{ line.type === 'header' ? line.text : line.text }}</span>
              </div>
              <div
                v-if="buildEnv.staging.state === 'building' && parsedLogs.length"
                class="log-cursor"
              />
            </template>
          </div>
        </div>

        <div
          v-if="buildEnv.prod.state === 'error' && buildEnv.prod.message"
          class="build-error mt-10"
        >
          <pre>{{ buildEnv.prod.message }}</pre>
        </div>
      </div>

      <p
        v-if="error"
        class="text-error mb-10"
      >
        {{ error }}
      </p>

      <!-- Detail tabs -->
      <div class="detail-tabs mb-10">
        <button
          class="detail-tab"
          :class="{ 'detail-tab--active': detailTab === 'source' }"
          @click="detailTab = 'source'"
        >
          Source
          <span
            v-if="lastUpdatedLabel"
            class="detail-tab__meta"
          >{{ lastUpdatedLabel }}</span>
        </button>
        <button
          class="detail-tab"
          :class="{ 'detail-tab--active': detailTab === 'infrastructure' }"
          @click="detailTab = 'infrastructure'"
        >
          Infrastructure
          <span
            v-if="infraResources.length"
            class="detail-tab__badge"
          >{{ infraResources.length }}</span>
        </button>
      </div>

      <!-- Source tab -->
      <div v-if="detailTab === 'source'">
        <div
          v-if="loading"
          class="text-muted"
        >
          Loading files...
        </div>

        <div
          v-else-if="visibleEntries.length"
          class="file-tree"
        >
          <div
            v-for="entry in visibleEntries"
            :key="entry.path"
            class="tree-entry"
            :class="{
              'tree-entry--dir': entry.type === 'tree',
              'tree-entry--file': entry.type === 'blob',
            }"
            :style="{ paddingLeft: (entry.depth * 20 + 12) + 'px' }"
            @click="onEntryClick(entry)"
          >
            <i
              v-if="entry.type === 'tree'"
              class="icon mr-5"
              :class="entry.open ? 'icon-chevron-down' : 'icon-chevron-right'"
            />
            <i
              v-else
              class="icon icon-file mr-5"
            />
            <span class="tree-entry__name">{{ entry.name }}</span>
            <span
              v-if="entry.lastCommitSha"
              class="tree-entry__commit"
            >
              <span class="tree-entry__sha">{{ entry.lastCommitSha.slice(0, 7) }}</span>
              <span
                v-if="entry.lastCommitDate"
                class="tree-entry__date"
              >{{ relativeTime(entry.lastCommitDate) }}</span>
            </span>
          </div>
        </div>

        <p
          v-else-if="!error"
          class="text-muted"
        >
          Repository is empty.
        </p>
      </div>

      <!-- Infrastructure tab -->
      <div v-if="detailTab === 'infrastructure'">
        <table
          v-if="infraResources.length"
          class="infra-table"
        >
          <thead>
            <tr>
              <th>Kind</th>
              <th>Name</th>
              <th>Namespace</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="res in infraResources"
              :key="`${res.kind}-${res.namespace}-${res.name}`"
            >
              <td>{{ res.kind }}</td>
              <td class="infra-name">
                <router-link :to="res.link">
                  {{ res.name }}
                </router-link>
              </td>
              <td class="infra-name">
                {{ res.namespace }}
              </td>
              <td :class="res.stateClass">
                {{ res.state }}
              </td>
            </tr>
          </tbody>
        </table>
        <p
          v-else
          class="text-muted"
        >
          No infrastructure resources found.
        </p>
      </div>
    </div>

    <!-- File viewer modal -->
    <div
      v-if="viewerOpen"
      class="file-viewer-overlay"
      @click.self="closeViewer"
    >
      <div class="file-viewer-modal">
        <div class="file-viewer-header">
          <span class="file-viewer-path">{{ viewerPath }}</span>
          <button
            class="btn role-link btn-sm"
            @click="closeViewer"
          >
            <i class="icon icon-close" />
          </button>
        </div>
        <div class="file-viewer-body">
          <div
            v-if="viewerLoading"
            class="text-muted pa-20"
          >
            Loading...
          </div>
          <CodeMirror
            v-else
            :value="viewerContent"
            :mode="viewMode"
            :options="{ mode: viewerCmMode, readOnly: true, lineNumbers: true, foldGutter: true }"
          />
        </div>
      </div>
    </div>

  </div>
</template>

<style lang="scss" scoped>
.ceol-page {
  padding: 20px;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;

  h2 {
    margin: 0;
  }
}

.btn-delete {
  background: none;
  border: none;
  color: var(--error);
  cursor: pointer;
  padding: 6px;
  border-radius: 4px;
  font-size: 18px;

  &:hover {
    background: rgba(255, 0, 0, 0.08);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.clone-box {
  display: flex;
  align-items: center;
  background: var(--input-bg, #f5f5f5);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
}

.clone-cmd {
  flex: 1;
  font-family: monospace;
  word-break: break-all;
  color: var(--body-text);
  background: none;
  border: none;
  padding: 0;
}

.clone-copy {
  flex-shrink: 0;
  margin-left: 8px;
  font-size: 16px;
}

.build-section {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 16px;
}

.build-actions {
  display: flex;
  align-items: center;
}

.env-status {
  font-size: 13px;
}

.env-row {
  display: flex;
  align-items: center;
}

.env-label {
  font-weight: 600;
  width: 60px;
}

.env-state {
  text-transform: capitalize;
}

.env-link {
  color: var(--primary);
  text-decoration: none;
  font-size: 12px;

  &:hover {
    text-decoration: underline;
  }
}

.logs-panel {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--input-bg, #f5f5f5);
}

.logs-title {
  font-weight: 600;
  font-size: 13px;
  display: flex;
  align-items: center;
}

.logs-body {
  max-height: 400px;
  overflow: auto;
  background: #1a1a2e;
  padding: 12px 0;
}

.log-line {
  padding: 1px 16px;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: #c8c8d0;

  &--header {
    color: #7ec8e3;
    font-weight: 700;
    padding-top: 8px;
    padding-bottom: 2px;
    border-bottom: 1px solid rgba(126, 200, 227, 0.15);
    margin-bottom: 2px;
  }

  &__icon {
    margin-right: 6px;
    font-size: 10px;
  }

  &--error {
    color: #ff6b6b;
    background: rgba(255, 107, 107, 0.08);
  }

  &--warn {
    color: #ffc857;
  }

  &--muted {
    color: #6c6c80;
    font-style: italic;
  }

  &--step {
    color: #6bdf8f;
  }
}

.log-cursor {
  display: inline-block;
  width: 8px;
  height: 14px;
  background: #7ec8e3;
  margin-left: 16px;
  margin-top: 4px;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.build-error {
  background: var(--input-bg, #f5f5f5);
  border: 1px solid var(--error);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 12px;
  max-height: 200px;
  overflow: auto;

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
  }
}

.detail-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
}

.detail-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #888);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;

  &:hover {
    color: var(--body-text);
  }

  &--active {
    color: var(--body-text);
    border-bottom-color: var(--primary);
  }

  &__badge {
    background: var(--primary);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    min-width: 18px;
    height: 18px;
    line-height: 18px;
    text-align: center;
    padding: 0 5px;
    border-radius: 0;
  }

  &__meta {
    font-size: 11px;
    font-weight: 400;
    color: var(--text-secondary, #888);
  }
}

.infra-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th, td {
    text-align: left;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
  }

  th {
    font-weight: 600;
    color: var(--text-secondary, #888);
    font-size: 12px;
    text-transform: uppercase;
  }

  tr:last-child td {
    border-bottom: none;
  }
}

.infra-name {
  font-family: monospace;

  a {
    color: var(--primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}

.file-tree {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.tree-entry {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  font-family: monospace;

  &:last-child {
    border-bottom: none;
  }

  &--dir, &--file {
    cursor: pointer;

    &:hover {
      background: var(--body-bg);
    }
  }

  &__name {
    flex: 1;
  }

  &__commit {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 12px;
    font-size: 12px;
    color: var(--text-secondary, #888);
    flex-shrink: 0;
  }

  &__sha {
    font-family: monospace;
    color: var(--primary);
  }

  &__date {
    white-space: nowrap;
  }
}

.file-viewer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-viewer-modal {
  background: var(--body-bg, #fff);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 85vw;
  max-width: 1100px;
  height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.file-viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  font-family: monospace;
  font-size: 13px;
  flex-shrink: 0;
}

.file-viewer-path {
  font-weight: 600;
}

.file-viewer-body {
  flex: 1;
  overflow: auto;

  .code-mirror {
    margin-bottom: 0;
    height: 100%;

    :deep(.codemirror-container) {
      height: 100%;

      .CodeMirror {
        height: 100% !important;
      }
    }
  }
}
</style>
