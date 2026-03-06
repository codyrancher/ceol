<script lang="ts">
import { defineComponent } from 'vue';

const TABS = [
  { name: 'my-apps', label: 'My Apps', route: 'ceol' },
  { name: 'shared-apps', label: 'Shared Apps', route: 'ceol-shared-apps' },
  { name: 'infrastructure', label: 'Infrastructure', route: 'ceol-infrastructure' },
];

export default defineComponent({
  computed: {
    tabs() {
      return TABS;
    },

    cluster(): string {
      return this.$route.params.cluster as string;
    },

    activeTab(): string {
      const routeName = this.$route.name as string;
      const tab = TABS.find((t) => t.route === routeName);

      return tab?.name || 'my-apps';
    },
  },
});
</script>

<template>
  <div class="ceol-tabs">
    <ul role="tablist">
      <li
        v-for="tab in tabs"
        :key="tab.name"
        :class="{ active: activeTab === tab.name }"
        role="tab"
      >
        <router-link :to="{ name: tab.route, params: { cluster } }">
          {{ tab.label }}
        </router-link>
      </li>
    </ul>
  </div>
</template>

<style lang="scss">
// Override IndentedPanel constraints for ceol pages
.indented-panel:has(.ceol-tabs) {
  width: 100%;
  margin-left: 0;
}
</style>

<style lang="scss" scoped>
.ceol-tabs {
  ul {
    display: flex;
    list-style: none;
    padding: 0 20px;
    margin: 0;
    border-bottom: 1px solid var(--border);
  }

  li {
    padding: 10px 20px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;

    a {
      color: var(--body-text);
      text-decoration: none;
    }

    &.active {
      border-bottom-color: var(--primary);

      a {
        color: var(--primary);
      }
    }

    &:hover:not(.active) {
      border-bottom-color: var(--border);
    }
  }
}
</style>
