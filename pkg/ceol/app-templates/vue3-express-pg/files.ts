import type { TemplateFile } from '../types';

import rootPackage      from './files/package.json?raw';
import clientPackage    from './files/client/package.json?raw';
import clientViteConfig from './files/client/vite.config.ts?raw';
import clientTsconfig   from './files/client/tsconfig.json?raw';
import clientIndexHtml  from './files/client/index.html?raw';
import clientMain       from './files/client/src/main.ts?raw';
import clientAppVue     from './files/client/src/App.vue?raw';
import clientEnvD       from './files/client/src/env.d.ts?raw';
import serverPackage    from './files/server/package.json?raw';
import serverIndex      from './files/server/src/index.js?raw';
import dockerfile       from './files/Dockerfile?raw';
import buildScript      from './files/scripts/build.sh?raw';

function interpolate(raw: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(k, v),
    raw,
  );
}

export function generateFiles(appName: string): TemplateFile[] {
  const safeName = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const vars = { __APP_NAME__: appName, __SAFE_NAME__: safeName };

  return [
    { path: 'package.json',          content: interpolate(rootPackage, vars) },
    { path: 'client/package.json',   content: interpolate(clientPackage, vars) },
    { path: 'client/vite.config.ts', content: clientViteConfig },
    { path: 'client/tsconfig.json',  content: clientTsconfig },
    { path: 'client/index.html',     content: interpolate(clientIndexHtml, vars) },
    { path: 'client/src/main.ts',    content: clientMain },
    { path: 'client/src/App.vue',    content: interpolate(clientAppVue, vars) },
    { path: 'client/src/env.d.ts',   content: clientEnvD },
    { path: 'server/package.json',   content: interpolate(serverPackage, vars) },
    { path: 'server/src/index.js',   content: interpolate(serverIndex, vars) },
    { path: 'Dockerfile',            content: dockerfile },
    { path: 'scripts/build.sh',      content: buildScript },
  ];
}
