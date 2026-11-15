import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, resolveConfig } from './config.mjs';
import { ROLE_TOKENS, collectTokens, computeRoles } from './theme.mjs';

export const THEME_PAGE_PATH = '/__theme/';
export const DATA_PATH = '/__theme/data.json';

// The dev-only mounts for the theme page. The shared front end modules are served from src/js so the page runs the code the site runs.
export function themePageMounts(repoRoot) {
  return { '/__theme/js/': join(repoRoot, 'src', 'js'), '/__theme/': join(repoRoot, 'scripts', 'theme-page') };
}

// Builds the JSON the theme page needs beyond site.json: tokens, overrides, poster targets and the roles of both brands.
export function themeData({ repoRoot, root, outDir }) {
  const site = JSON.parse(readFileSync(join(outDir, 'data', 'site.json'), 'utf8'));
  const schema = JSON.parse(readFileSync(join(repoRoot, 'src', 'config.schema.json'), 'utf8'));
  const defaults = resolveConfig({}, schema).advanced.posters;
  const sample = JSON.parse(readFileSync(join(repoRoot, 'docs', 'examples', 'sample-brand.json'), 'utf8'));
  const own = loadConfig(join(root, 'curator.config.json')).config?.advanced?.posters ?? {};
  return {
    tokens: collectTokens(join(repoRoot, 'src'), site.scene.name),
    roleTokens: ROLE_TOKENS,
    overrides: site.scene.colors ?? {},
    brands: {
      configured: { name: 'Your brand', brand: site.brand, posters: { ...defaults, ...own }, roles: computeRoles(site.brand, site.types) },
      sample: { name: 'Sample brand', brand: sample.basic.brand, posters: { ...defaults, ...(sample.advanced?.posters ?? {}) }, roles: computeRoles(sample.basic.brand, site.types) },
    },
  };
}

// Routes for startServer: answers the data path with JSON, or a 503 while there is no good build.
export function themePageRoutes({ repoRoot, root, getOutDir }) {
  return {
    [DATA_PATH]: () => {
      try {
        return { status: 200, body: JSON.stringify(themeData({ repoRoot, root, outDir: getOutDir() })) };
      } catch (err) {
        return { status: 503, body: JSON.stringify({ error: String(err?.message ?? err) }) };
      }
    },
  };
}
