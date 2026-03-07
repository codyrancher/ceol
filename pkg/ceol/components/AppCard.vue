<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  props: {
    name: {
      type:    String,
      default: '',
    },
    logo: {
      type:    String,
      default: '',
    },
  },

  emits: ['click'],
});
</script>

<template>
  <div
    class="app-card"
    role="button"
    tabindex="0"
    @click="$emit('click')"
    @keydown.enter="$emit('click')"
  >
    <img
      class="app-card__icon"
      :src="logo"
      :alt="name"
    >
    <span class="app-card__name">{{ name }}</span>
  </div>
</template>

<style lang="scss" scoped>
.app-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  min-height: 140px;

  &:hover {
    border-color: var(--primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  &__icon {
    width: 48px;
    height: 48px;
    border-radius: 8px;
  }

  &__name {
    font-size: 14px;
    font-weight: 500;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
}
</style>
