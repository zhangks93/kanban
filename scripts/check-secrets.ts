import { readdir, readFile } from 'node:fs/promises';
async function scan(dir: string): Promise<void> {
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${f.name}`;
    if (f.isDirectory()) await scan(path);
    else if (/\.(js|html|css|map)$/.test(path)) {
      const text = await readFile(path, 'utf8');
      if (/SUPABASE_DB_URL|FEISHU_APP_SECRET|APP_SESSION_SECRET|postgres:\/\//.test(text))
        throw Error(`Secret reference in ${path}`);
    }
  }
}
await scan('apps/web/dist');
console.log('Web bundle secret scan passed');
