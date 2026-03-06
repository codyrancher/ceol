import { IPlugin } from '@shell/core/types';
import { BLANK_CLUSTER } from '@shell/store/store-types.js';

export function init($plugin: IPlugin, store: any) {
  const { product, virtualType } = $plugin.DSL(store, 'ceol');

  product({
    svg:                 require('./assets/ceol-icon.svg'),
    inStore:             'management',
    removable:           false,
    showClusterSwitcher: false,
    weight:              -1,
    to:                  {
      name:   'ceol',
      params: { cluster: BLANK_CLUSTER }
    },
  });

  virtualType({
    label:      'Ceol',
    icon:       'folder',
    group:      'Root',
    namespaced: false,
    name:       'ceol-dashboard',
    weight:     100,
    route:      {
      name:   'ceol',
      params: { cluster: BLANK_CLUSTER }
    },
    exact: true,
  });
}
