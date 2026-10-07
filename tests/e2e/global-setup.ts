import { execFileSync } from 'node:child_process';
export default function setup() {
  execFileSync('pnpm', ['db:reset'], { stdio: 'inherit' });
}
