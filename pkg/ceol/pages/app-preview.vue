<script lang="ts">
import { defineComponent } from 'vue';
import { appProxyUrl } from '../state/builds';

export default defineComponent({
  data() {
    return {
      appName: this.$route.params.app as string,
      env:     this.$route.params.env as string,
    };
  },

  computed: {
    username(): string {
      const v3User = this.$store.getters['auth/v3User'];

      return v3User?.username || v3User?.name || '';
    },

    proxyUrl(): string {
      if (!this.username) {
        return '';
      }

      return appProxyUrl(this.appName, this.env);
    },
  },

  mounted() {
    document.title = `${ this.appName } — ${ this.env }`;

    document.documentElement.style.colorScheme = 'light';
    document.documentElement.classList.add('ceol-preview-active');

    // Listen for the iframe to request the username
    window.addEventListener('message', this.onMessage);
  },

  beforeUnmount() {
    document.documentElement.style.colorScheme = '';
    document.documentElement.classList.remove('ceol-preview-active');
    window.removeEventListener('message', this.onMessage);
  },

  methods: {
    onMessage(e: MessageEvent) {
      if (e.data?.type === 'get-username') {
        const iframe = this.$el as HTMLIFrameElement;

        iframe?.contentWindow?.postMessage(
          { type: 'username', user: this.username },
          '*',
        );
      }
    },
  },
});
</script>

<template>
  <iframe
    v-if="proxyUrl"
    :src="proxyUrl"
    class="app-preview-frame"
  />
</template>

<style lang="scss">
html.ceol-preview-active {
  color-scheme: light !important;
  background: #fff !important;

  body {
    background: #fff !important;
    color: #000 !important;
  }
}
</style>

<style lang="scss" scoped>
.app-preview-frame {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
  color-scheme: light;
}
</style>
