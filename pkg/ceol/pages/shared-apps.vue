<script lang="ts">
import { defineComponent } from 'vue';
import CeolTabs from '../components/CeolTabs.vue';

export default defineComponent({
  components: { CeolTabs },
});
</script>

<template>
  <div>
    <CeolTabs />
    <div class="ceol-page">
      <h2>Shared Apps</h2>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.ceol-page {
  padding: 20px;
}
</style>
