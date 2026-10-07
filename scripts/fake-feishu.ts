import { buildFakeFeishu } from '../apps/api/src/testing/fake-feishu';
await buildFakeFeishu().listen({ host: '0.0.0.0', port: 4001 });
