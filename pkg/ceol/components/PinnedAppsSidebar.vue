<script lang="ts">
import { defineComponent } from 'vue';
import { getPinnedApps } from '../state/pins';

export default defineComponent({
  data() {
    return {
      pinned:      [] as string[],
      targetReady: false,
    };
  },

  computed: {
    cluster(): string {
      return (this.$route.params.cluster as string) || '_';
    },
  },

  mounted() {
    this.pinned = getPinnedApps(this.$store);

    // Wait for the SideNav DOM to be ready
    this.$nextTick(() => {
      this.targetReady = !!document.querySelector('.side-nav .nav');
    });
  },

  methods: {
    refresh() {
      this.pinned = getPinnedApps(this.$store);
    },

    openPinnedApp(appName: string) {
      const route = this.$router.resolve({
        name:   'ceol-app-preview',
        params: { cluster: this.cluster, app: appName, env: 'prod' },
      });

      window.open(route.href, '_blank');
    },
  },
});
</script>

<template>
  <Teleport
    v-if="targetReady && pinned.length"
    to=".side-nav .nav"
  >
    <div class="ceol-pinned-section">
      <h6 class="ceol-pinned-section__heading">
        Pinned
      </h6>
      <div
        v-for="name in pinned"
        :key="name"
        class="ceol-pinned-section__item"
        role="button"
        tabindex="0"
        @click="openPinnedApp(name)"
        @keydown.enter="openPinnedApp(name)"
      >
        <i class="icon icon-star ceol-pinned-section__icon" />
        <span>{{ name }}</span>
      </div>
    </div>
  </Teleport>
</template>

<style lang="scss">
.ceol-pinned-section {
  padding: 0 10px;
  margin-top: 10px;
  border-top: 1px solid var(--border);
  padding-top: 10px;

  &__heading {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-secondary, #888);
    letter-spacing: 0.5px;
    margin: 0 0 6px 5px;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--border-radius);
    cursor: pointer;
    font-size: 14px;
    color: var(--body-text);

    &:hover {
      background: var(--nav-hover);
    }
  }

  &__icon {
    font-size: 16px;
    color: var(--primary);
  }
}
</style>
