/**
 * Minimal Node built-in declarations so the project keeps zero dependencies.
 */

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
  export function readdirSync(path: string): string[];
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function existsSync(path: string): boolean;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string): string;
}

declare module "node:child_process" {
  export type SpawnSyncOptions = {
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdio?: "inherit" | "pipe";
  };

  export type SpawnSyncResult = {
    status: number | null;
    stdout: string | null;
    stderr: string | null;
    error?: { message: string };
  };

  export function spawnSync(command: string, args: string[], options?: SpawnSyncOptions): SpawnSyncResult;
}
