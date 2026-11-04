/**
 * Node globals used by this project, declared locally so the repository needs no
 * dependencies at all to typecheck or run.
 */

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};

declare const process: {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  exit(code?: number): void;
  argv: string[];
  env: Record<string, string | undefined>;
  platform: string;
  cwd(): string;
  versions: { node: string };
};

declare const performance: {
  now(): number;
};
