const config = require('@rancher/shell/vue.config'); // eslint-disable-line @typescript-eslint/no-var-requires

const base = config(__dirname, {
  excludes: [],
});

// Support ?raw imports for template files (webpack 5 asset/source)
const origConfigureWebpack = base.configureWebpack;

base.configureWebpack = function(cfg) {
  if (origConfigureWebpack) {
    origConfigureWebpack(cfg);
  }

  // Exclude ?raw files from all existing loaders
  for (const rule of cfg.module.rules) {
    if (rule.resourceQuery) {
      continue;
    }

    rule.resourceQuery = { not: [/raw/] };
  }

  // Then handle ?raw as plain text
  cfg.module.rules.push({
    resourceQuery: /raw/,
    type:          'asset/source',
  });
};

module.exports = base;
