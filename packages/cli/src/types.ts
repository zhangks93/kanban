import type { Environment } from './config';
import type { Fetch } from './http';
export type Flags = Record<string, string | boolean>;
export interface CliIO {
  stdout(value: string): void;
  stderr(value: string): void;
  stdin(): Promise<string>;
  wait(milliseconds: number): Promise<void>;
  now(): number;
}
export interface CliContext {
  io: CliIO;
  env: Environment;
  fetcher: Fetch;
  server(): Promise<string>;
  authenticated(): Promise<{ origin: string; token: string; source: string }>;
  api<T = unknown>(path: string, method?: string, body?: unknown): Promise<T>;
}
