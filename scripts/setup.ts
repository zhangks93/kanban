import { fileURLToPath } from 'node:url';
import { prepareLocalEnv } from './local-env';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await prepareLocalEnv(root);
console.log(
  result.created
    ? '已创建本地环境文件并生成 Session 密钥。'
    : '已保留现有配置，补齐未设置的本地 Session 密钥。',
);
console.log(`请编辑 ${result.path} 中的 Supabase 与飞书配置，然后运行 pnpm dev。`);
