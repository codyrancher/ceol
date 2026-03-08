import { BLANK_CLUSTER } from '@shell/store/store-types.js';
import { getUsername } from './auth';

const STORAGE_KEY = 'ceol-pinned-apps';
const PIN_PRODUCT_PREFIX = 'ceol-pin-';

interface PinnedApp {
  name: string;
  icon: string;
}

function userKey(store: any): string {
  return `${ STORAGE_KEY }:${ getUsername(store) }`;
}

function getRawPins(store: any): PinnedApp[] {
  try {
    const raw = localStorage.getItem(userKey(store));

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    // Backward compat: old format was string[]
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
      return parsed.map((name: string) => ({ name, icon: 'application' }));
    }

    return parsed;
  } catch {
    return [];
  }
}

export function getPinnedApps(store: any): string[] {
  return getRawPins(store).map((p) => p.name);
}

export function isPinned(store: any, appName: string): boolean {
  return getPinnedApps(store).includes(appName);
}

export function togglePin(store: any, appName: string, icon: string = 'application'): boolean {
  const pins = getRawPins(store);
  const idx = pins.findIndex((p) => p.name === appName);

  if (idx >= 0) {
    pins.splice(idx, 1);
  } else {
    pins.push({ name: appName, icon });
  }

  localStorage.setItem(userKey(store), JSON.stringify(pins));

  return idx < 0; // true if now pinned
}

export function syncPinnedProducts(store: any): void {
  const pinned = getRawPins(store);
  const pinnedNames = new Set(pinned.map((p) => p.name));
  const products: any[] = store.state['type-map']?.products || [];

  // Find existing pinned products
  const existingPinNames = new Set(
    products
      .filter((p: any) => p.name?.startsWith(PIN_PRODUCT_PREFIX))
      .map((p: any) => p.name.slice(PIN_PRODUCT_PREFIX.length))
  );

  const locale = store.getters['i18n/selected'] || 'en-us';

  // Add products for newly pinned apps
  for (const { name: appName, icon } of pinned) {
    if (!existingPinNames.has(appName)) {
      const productName = `${ PIN_PRODUCT_PREFIX }${ appName }`;

      store.commit('type-map/product', {
        name:                productName,
        icon:                icon || 'application',
        inStore:             'management',
        removable:           false,
        showClusterSwitcher: false,
        weight:              4,
        to:                  {
          name:   'ceol-app-preview',
          params: { cluster: BLANK_CLUSTER, app: appName, env: 'prod' },
        },
      });

      // Set i18n label so TopLevelMenu shows app name without prefix
      store.commit('i18n/mergeLoadTranslations', {
        locale,
        translations: { product: { [productName]: appName } },
      });
    }
  }

  // Remove products for unpinned apps
  for (const name of existingPinNames) {
    if (!pinnedNames.has(name)) {
      store.commit('type-map/remove', { product: `${ PIN_PRODUCT_PREFIX }${ name }` });
    }
  }
}
