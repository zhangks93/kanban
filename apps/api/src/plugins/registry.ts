// API composition root: concrete plugin dependencies exist only here.
import { manifest as rndManifest } from '@work/plugin-rnd/manifest';
import { server as rndServer } from '@work/plugin-rnd/server';
import { manifest as opsManifest } from '@work/plugin-ops/manifest';
import { server as opsServer } from '@work/plugin-ops/server';
import {
  assertPluginKeys,
  coreTemplates,
  type WorkPluginManifest,
  type WorkPluginServer,
} from '@work/plugin-sdk';
export const installedPlugins: [WorkPluginManifest, WorkPluginServer][] = [
  [rndManifest, rndServer],
  [opsManifest, opsServer],
];
export interface Extension {
  key: string;
  table: string;
  fields: string[];
  domainTables: string[];
}
export function buildRegistry(plugins = installedPlugins) {
  const manifests: WorkPluginManifest[] = [];
  const extensions = new Map<string, Extension>();
  for (const [manifest, server] of plugins) {
    assertPluginKeys(manifest, server);
    if (manifests.some((m) => m.key === manifest.key)) throw Error('Duplicate plugin');
    manifests.push(manifest);
    server.register({
      registerTaskExtension(e) {
        if (e.key !== manifest.key || extensions.has(e.key))
          throw Error('Invalid plugin extension registration');
        extensions.set(e.key, e);
      },
    });
  }
  return {
    manifests,
    extensions,
    templates: [...coreTemplates, ...manifests.flatMap((m) => m.boardTemplates ?? [])],
  };
}
