import { Denops, fn, vars } from "./deps.ts";
export type { Denops };
export { vars };

// deno-lint-ignore no-explicit-any
const createCaller = (name: string): any => {
  return async (denops: Denops, ...args: unknown[]) => {
    return await fn.call(denops, name, args);
  };
};

export type Setup = (
  denops: Denops,
) => Promise<void>;
export const setup = createCaller(
  "ssher#internal#setup",
) as Setup;

export type SetupBuffer = (
  denops: Denops,
) => Promise<void>;
export const setupBuffer = createCaller(
  "ssher#internal#setup_buffer",
) as SetupBuffer;

export type Setbufline = (
  denops: Denops,
  bufnr: number,
  linenr: number,
  line: string | string[],
) => Promise<void>;
export const setbufline = createCaller(
  "ssher#internal#setbufline",
) as Setbufline;
