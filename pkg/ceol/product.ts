import { IPlugin } from '@shell/core/types';
import { BLANK_CLUSTER } from '@shell/store/store-types.js';
import { syncPinnedProducts } from './state/pins';

export function init($plugin: IPlugin, store: any) {
  const { product, virtualType, basicType } = $plugin.DSL(store, 'ceol');

  (product as any)({
    svg:                 require('./assets/ceol-icon.svg'),
    inStore:             'management',
    removable:           false,
    showClusterSwitcher: false,
    weight: 3,
    to:                  {
      name:   'ceol',
      params: { cluster: BLANK_CLUSTER }
    },
  });

  (virtualType as any)({
    label: 'Apps',
    icon: 'folder',
    namespaced: false,
    name: 'ceol-apps',
    weight:     100,
    route:      {
      name:   'ceol',
      params: { cluster: BLANK_CLUSTER }
    },
    exact: true,
  });

  (virtualType as any)({
    label: 'Settings',
    icon: 'gear',
    namespaced: false,
    name: 'ceol-settings-nav',
    weight: -10,
    route: {
      name: 'ceol-settings',
      params: { cluster: BLANK_CLUSTER }
    },
  });

  basicType(['ceol-apps', 'ceol-settings-nav']);

  // Register pinned apps as products in the TopLevelMenu
  syncPinnedProducts(store);
}
