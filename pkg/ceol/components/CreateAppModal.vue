<script lang="ts">
import { defineComponent } from 'vue';
import AppModal from '@shell/components/AppModal.vue';
import { templates } from '../app-templates';
import { createApp } from '../state/apps';
import type { AppTemplate } from '../app-templates';

const NAME_RE = /^[a-z][a-z0-9-]*$/;

export default defineComponent({
  components: { AppModal },

  props: {
    existingNames: {
      type:    Array as () => string[],
      default: () => [],
    },
  },

  emits: ['close', 'created'],

  data() {
    return {
      appName:            '',
      selectedTemplateId: templates[0]?.id || '',
      templates,
      creating:           false,
      error:              '',
    };
  },

  computed: {
    safeName(): string {
      return this.appName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
    },

    nameError(): string {
      if (!this.appName.trim()) {
        return '';
      }

      if (!NAME_RE.test(this.safeName)) {
        return 'Name must start with a letter and contain only lowercase letters, numbers, and hyphens.';
      }

      if (this.safeName.length < 2) {
        return 'Name must be at least 2 characters.';
      }

      if (this.safeName.length > 40) {
        return 'Name must be 40 characters or fewer.';
      }

      if (this.existingNames.includes(this.safeName)) {
        return `An app named "${ this.safeName }" already exists.`;
      }

      return '';
    },

    selectedTemplate(): AppTemplate | undefined {
      return templates.find((t) => t.id === this.selectedTemplateId);
    },

    canCreate(): boolean {
      return this.safeName.length >= 2 && !this.nameError && !!this.selectedTemplateId && !this.creating;
    },
  },

  mounted() {
    this.$nextTick(() => {
      (this.$refs.nameInput as HTMLInputElement)?.focus();
    });
  },

  methods: {
    async onSubmit() {
      if (!this.canCreate) {
        return;
      }

      this.creating = true;
      this.error = '';

      try {
        await createApp(this.$store, this.safeName, this.selectedTemplateId);
        this.$emit('created');
      } catch (err: any) {
        const msg = err?.data || err?.message || err?.statusText || JSON.stringify(err);

        this.error = msg;
        this.creating = false;
      }
    },
  },
});
</script>

<template>
  <AppModal
    :width="520"
    @close="$emit('close')"
  >
    <div class="create-app-modal">
      <h2 class="create-app-modal__title">
        Create App
      </h2>

      <div class="create-app-modal__section">
        <label class="create-app-modal__label">Template</label>
        <div class="template-grid">
          <div
            v-for="t in templates"
            :key="t.id"
            class="template-card"
            :class="{ 'template-card--selected': selectedTemplateId === t.id }"
            role="button"
            tabindex="0"
            @click="selectedTemplateId = t.id"
            @keydown.enter="selectedTemplateId = t.id"
          >
            <img
              class="template-card__logo"
              :src="t.logo(t.name)"
              :alt="t.name"
            >
            <div class="template-card__info">
              <span class="template-card__name">{{ t.name }}</span>
              <span class="template-card__desc">{{ t.description }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="create-app-modal__section">
        <label
          class="create-app-modal__label"
          for="ceol-app-name"
        >App Name</label>
        <input
          id="ceol-app-name"
          ref="nameInput"
          v-model="appName"
          type="text"
          class="create-app-modal__input"
          placeholder="my-app"
          maxlength="40"
          @keydown.enter="onSubmit"
        >
        <p
          v-if="safeName && safeName !== appName"
          class="create-app-modal__hint"
        >
          Will be created as <b>{{ safeName }}</b>
        </p>
        <p
          v-if="nameError"
          class="create-app-modal__error"
        >
          {{ nameError }}
        </p>
      </div>

      <p
        v-if="error"
        class="create-app-modal__error"
      >
        {{ error }}
      </p>

      <div class="create-app-modal__actions">
        <button
          class="btn role-secondary"
          :disabled="creating"
          @click="$emit('close')"
        >
          Cancel
        </button>
        <button
          class="btn role-primary"
          :disabled="!canCreate"
          @click="onSubmit"
        >
          <i
            v-if="creating"
            class="icon icon-spinner icon-spin mr-5"
          />
          {{ creating ? 'Creating...' : 'Create' }}
        </button>
      </div>
    </div>
  </AppModal>
</template>

<style lang="scss" scoped>
.create-app-modal {
  padding: 24px;

  &__title {
    margin: 0 0 20px;
    font-size: 18px;
    font-weight: 600;
  }

  &__section {
    margin-bottom: 20px;
  }

  &__label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--input-label);
    margin-bottom: 6px;
  }

  &__input {
    width: 100%;
    padding: 8px 10px;
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

  &__hint {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-secondary, #888);
  }

  &__error {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--error);
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding-top: 4px;
  }
}

.template-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.template-card {
  display: flex;
  align-items: center;
  gap: 12px;
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

  &__logo {
    width: 36px;
    height: 36px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  &__info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  &__name {
    font-size: 14px;
    font-weight: 600;
  }

  &__desc {
    font-size: 12px;
    color: var(--text-secondary, #888);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
