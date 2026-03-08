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
      <p class="text-muted">
        No shared apps yet.
      </p>
    </div>

  </div>
</template>

<style lang="scss" scoped>
.ceol-page {
  padding: 20px;
}
</style>
