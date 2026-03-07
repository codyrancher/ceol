<script lang="ts">
import { defineComponent } from 'vue';
import { _VIEW } from '@shell/config/query-params';
import CeolTabs from '../components/CeolTabs.vue';
import CodeMirror from '@shell/components/CodeMirror.vue';
import { ensureGiteaAdmin, getRepoTree, getFileContent, getCloneInfo } from '../app-templates/gitea';
import { deleteApp } from '../state/apps';
import type { GiteaTreeEntry } from '../app-templates/gitea';

interface FlatEntry {
  name: string;
  path: string;
  type: 'blob' | 'tree';
  size: number;
  depth: number;
  open: boolean;
  parentPath: string;
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
      name:       parts[parts.length - 1],
      path:       entry.path,
      type:       entry.type,
      size:       entry.size,
      depth:      parts.length - 1,
      open:       true,
      parentPath,
    };
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${ bytes } B`;
  }

  return `${ (bytes / 1024).toFixed(1) } KB`;
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
      // File viewer state
      viewerOpen:     false,
      viewerPath:     '',
      viewerContent:  '',
      viewerLoading:  false,
      viewerCmMode:   'text/plain',
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
  },

  mounted() {
    this.loadTree();
  },

  methods: {
    formatSize,

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

      <p
        v-if="error"
        class="text-error mb-10"
      >
        {{ error }}
      </p>

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
            v-if="entry.type === 'blob'"
            class="tree-entry__size"
          >{{ formatSize(entry.size) }}</span>
        </div>
      </div>

      <p
        v-else-if="!error"
        class="text-muted"
      >
        Repository is empty.
      </p>
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

  &__size {
    color: var(--text-secondary, #888);
    font-size: 12px;
    margin-left: 12px;
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
