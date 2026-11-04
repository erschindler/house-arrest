/**
 * Minimal declarations for the Node built-ins used by the test suite. The project
 * intentionally has no dependencies, so these are declared rather than installed.
 */

declare module "node:test" {
  type TestFn = () => void | Promise<void>;
  const test: (name: string, fn: TestFn) => void;
  export default test;
}

declare module "node:assert/strict" {
  type Assert = {
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    match(value: string, pattern: RegExp, message?: string): void;
    throws(fn: () => unknown, matcher?: RegExp, message?: string): void;
  };
  const assert: Assert;
  export default assert;
}
