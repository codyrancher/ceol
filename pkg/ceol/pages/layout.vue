<script lang="ts">
import { defineComponent } from 'vue';
import CeolTabs from '../components/CeolTabs.vue';

export default defineComponent({
  components: { CeolTabs },
});
</script>

<template>
  <div class="ceol-layout">
    <CeolTabs />
    <div class="ceol-content">
      <router-view />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.ceol-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.ceol-content {
  padding: 20px;
  flex: 1;
  overflow: auto;
}
</style>
