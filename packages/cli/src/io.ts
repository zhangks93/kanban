import type { CliIO } from './types';
import { usage } from './errors';
export const defaultIO: CliIO = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
  stdin: async () => {
    let data = '';
    for await (const chunk of process.stdin) {
      data += chunk.toString();
      if (Buffer.byteLength(data) > 1024 * 1024) usage('JSON input must not exceed 1 MiB');
    }
    return data;
  },
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => Date.now(),
};
