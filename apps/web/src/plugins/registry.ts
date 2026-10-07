// Web composition root imports web entries only, never server/DB modules.
import { manifest as rndManifest } from '@work/plugin-rnd/manifest';
import { web as rndWeb } from '@work/plugin-rnd/web';
import { manifest as opsManifest } from '@work/plugin-ops/manifest';
import { web as opsWeb } from '@work/plugin-ops/web';
import { assertPluginKeys } from '@work/plugin-sdk';
export const installedPlugins = [
  { manifest: rndManifest, web: rndWeb },
  { manifest: opsManifest, web: opsWeb },
];
for (const plugin of installedPlugins) assertPluginKeys(plugin.manifest, plugin.web);
