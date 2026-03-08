import { BLANK_CLUSTER } from '@shell/store/store-types.js';

const STORAGE_KEY = 'ceol-pinned-apps';
const PIN_PRODUCT_PREFIX = 'ceol-pin-';

function getUsername(store: any): string {
  const v3User = store.getters['auth/v3User'];

  return v3User?.username || v3User?.name || '';
}

function userKey(store: any): string {
  return `${ STORAGE_KEY }:${ getUsername(store) }`;
}

export function getPinnedApps(store: any): string[] {
  try {
    const raw = localStorage.getItem(userKey(store));

    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function isPinned(store: any, appName: string): boolean {
  return getPinnedApps(store).includes(appName);
}

export function togglePin(store: any, appName: string): boolean {
  const pins = getPinnedApps(store);
  const idx = pins.indexOf(appName);

  if (idx >= 0) {
    pins.splice(idx, 1);
  } else {
    pins.push(appName);
  }

  localStorage.setItem(userKey(store), JSON.stringify(pins));

  return idx < 0; // true if now pinned
}

export function syncPinnedProducts(store: any): void {
  const pinned = getPinnedApps(store);
  const products: any[] = store.state['type-map']?.products || [];

  // Find existing pinned products
  const existingPinNames = new Set(
    products
      .filter((p: any) => p.name?.startsWith(PIN_PRODUCT_PREFIX))
      .map((p: any) => p.name.slice(PIN_PRODUCT_PREFIX.length))
  );

  const locale = store.getters['i18n/selected'] || 'en-us';

  // Add products for newly pinned apps
  for (const appName of pinned) {
    if (!existingPinNames.has(appName)) {
      const productName = `${ PIN_PRODUCT_PREFIX }${ appName }`;

      store.commit('type-map/product', {
        name:                productName,
        icon:                'star',
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
    if (!pinned.includes(name)) {
      store.commit('type-map/remove', { product: `${ PIN_PRODUCT_PREFIX }${ name }` });
    }
  }
}
