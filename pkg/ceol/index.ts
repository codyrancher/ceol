import { importTypes } from '@rancher/auto-import';
import { IPlugin } from '@shell/core/types';

// Init the package
export default function(plugin: IPlugin): void {
  // Auto-import model, detail, edit from the folders
  importTypes(plugin);

  // Provide plugin metadata from package.json
  plugin.metadata = require('./package.json');

  // Load a product
  plugin.addProduct(require('./product'));

  // Add routes for ceol pages
  plugin.addRoute('plain', {
    name:      'ceol',
    path:      '/c/:cluster/ceol',
    component: () => import('./pages/index.vue'),
    meta:      { product: 'ceol' },
  });

  plugin.addRoute('plain', {
    name:      'ceol-shared-apps',
    path:      '/c/:cluster/ceol/shared-apps',
    component: () => import('./pages/shared-apps.vue'),
    meta:      { product: 'ceol' },
  });

  plugin.addRoute('plain', {
    name:      'ceol-infrastructure',
    path:      '/c/:cluster/ceol/infrastructure',
    component: () => import('./pages/infrastructure.vue'),
    meta:      { product: 'ceol' },
  });
}
