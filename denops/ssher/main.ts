// deno-lint-ignore-file require-await
import { path } from "https://deno.land/x/denops_core@v1.0.0/deps.ts";
import { Denops, fn, streams, unknownutil } from "./deps.ts";
import * as internal from "./internal_autoload_fn.ts";

const bufVarNames = {
  perm: "ssher_perm",
};

const dispatcherNames = {
  SETUP: "setup",
  ON_ENTER: "onEnter",
  ON_SAVE: "onSave",
  ON_SETUP_BUFFER: "onSetupBuffer",
} as const;

const prefix = "ssher://";

const normalizePath = (p: string) => {
  const t = path.normalize(p);
  if (t === ".") return "";
  if (t === "./") return "";
  return t;
};

interface Target {
  user: string;
  host: string;
  port?: string;
}
const parseTarget = (target: string): Target => {
  // user@host:port!i=
  const g = target.match(/^(.*)@(.*)(?::(\d+))?/);
  if (!g) throw new Error("invalid ssher target");
  const [, user, host, port] = g;
  return {
    user,
    host,
    port,
  };
};

interface Ls {
  stat: string;
  path: string;
}
const parseLs = (lsStr: string): Ls => {
  const g = lsStr.match(
    /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/,
  );
  if (!g) throw new Error("invalid ssher ls");
  // drwxr-xr-x  6 luma luma 4.0K 2021-09-18 11:05 vim/
  const [_, stat, _what, _uname, _gname, _size, _date, _time, pathStr] = g;
  return {
    stat,
    path: pathStr,
  };
};
const lsIsDir = ({ path: p }: Ls) => p.endsWith("/") || p === "";

interface SSHerParams {
  target: Target;
  path: string;
}
const parseName = (dri: string): SSHerParams => {
  const driPath = dri.slice(prefix.length);
  const firstSlashIndex = (() => {
    const tmp = driPath.indexOf("/");
    if (tmp === -1) return driPath.length;
    return tmp;
  })();
  const targetStr = driPath.slice(0, firstSlashIndex);
  const pathStr = driPath.slice(firstSlashIndex + 1);
  return {
    target: parseTarget(targetStr),
    path: pathStr,
  };
};
const constructName = (
  { path, target: { user, host, port } }: SSHerParams,
): string => {
  return `ssher://${user}@${host}${port ? `:${port}` : ""}/${path}`;
};

const isDir = ({ path: p }: SSHerParams) => p.endsWith("/") || p === "";

const statToPerm = (statStr: string): string => {
  const t = (f: number): number => {
    return (statStr[f] !== "-" ? 4 : 0) +
      (statStr[f + 1] !== "-" ? 2 : 0) +
      (statStr[f + 2] !== "-" ? 1 : 0);
  };
  return `${t(1)}${t(4)}${t(7)}`;
};

const runSsh = (target: Target, cmd: string[]) => {
  return Deno.run({
    cmd: [
      "ssh",
      `${target.user}@${target.host}`,
      ...(target.port ? ["-p", target.port] : []),
      ...cmd,
    ],
    stdin: "piped",
    stdout: "piped",
  });
};

const runScp = async (
  data: Uint8Array,
  perm: string,
  params: SSHerParams,
) => {
  const basename = path.basename(params.path);
  const p = runSsh(params.target, ["scp", "-qt", "--", params.path]);
  // const p = runSsh(params.target, ["scp", "-qt", "--", "/home/ec2-user/foo"]);
  await streams.writeAll(
    p.stdin,
    new TextEncoder().encode(`C0${perm} ${data.length} ${basename}\n`),
  );
  await streams.writeAll(p.stdin, data);
  await streams.writeAll(p.stdin, Uint8Array.from([0]));
  p.stdin.close();
  p.status();
  p.close();
};

export async function main(denops: Denops): Promise<void> {
  const isSsherBufferName = (dri: string): boolean => {
    return dri.startsWith(prefix);
  };

  const setupBuffer = async (bufnr: number): Promise<void> => {
    // await fn.setbufvar(denops, bufnr, "ssher_buffer_loaded", 1);
    const bufname = await fn.bufname(denops);
    const params = parseName(bufname);
    const p = await (async () => {
      if (isDir(params)) {
        return runSsh(params.target, [
          "ls",
          "-lFah",
          "--time-style=long-iso",
          ...params.path ? [params.path] : [],
        ]);
      } else {
        const p = runSsh(params.target, [
          "stat",
          "--format=%A",
          "--",
          params.path,
        ]);
        const statStr = new TextDecoder().decode(
          await streams.readAll(p.stdout),
        ).trim();
        await fn.setbufvar(
          denops,
          bufnr,
          bufVarNames.perm,
          statToPerm(statStr),
        );
        return runSsh(params.target, ["cat", params.path]);
      }
    })();

    try {
      let linenr = 1;
      const lineBuf: number[] = [];
      const buf = new Uint8Array(65536);
      let first = true;
      const proc = async () => {
        if (first) {
          await internal.setbufline(
            denops,
            bufnr,
            1,
            [""],
          );

          first = false;
        }
        const lines: string[] = [];
        let s: number;
        while ((s = lineBuf.indexOf(0x0a)) >= 0) {
          const line = lineBuf.splice(0, s + 1).slice(0, -1);
          lines.push(new TextDecoder().decode(Uint8Array.from(line)));
        }
        await internal.setbufline(
          denops,
          bufnr,
          linenr,
          lines,
        );
        linenr += lines.length;
      };
      while (await p.stdout.read(buf) !== null) {
        lineBuf.push(...buf);
        await proc();
      }
      await proc();
    } finally {
      p.close();
    }

    if (!isDir(params)) {
      await fn.execute(denops, "set modifiable");
    }
  };

  const setupAllBuffers = async (): Promise<void> => {
    const buffers = await fn.getbufinfo(
      denops,
    );
    unknownutil.ensureArray(buffers);
    for (const buffer of buffers) {
      unknownutil.ensureObject(buffer);
      const { name, bufnr, linecount } = buffer;
      unknownutil.ensureNumber(bufnr);
      unknownutil.ensureString(name);
      unknownutil.ensureNumber(linecount);
      const waitList: Promise<unknown>[] = [];
      if (isSsherBufferName(name) && linecount === 1) {
        waitList.push(setupBuffer(bufnr));
      }
      await Promise.all(waitList);
    }
  };

  const onEnter = async (): Promise<void> => {
    const bufname: string = await fn.bufname(denops);
    const line: string = await fn.getline(denops, ".");
    const params = parseName(bufname);
    const ls = parseLs(line);
    await fn.execute(
      denops,
      `:e ${
        constructName({
          ...params,
          path: normalizePath(path.join(params.path ?? "", ls.path)),
        })
      }`,
    );
  };

  const onSave = async (bufnr: number, lines: string[]): Promise<void> => {
    const bufname = await fn.bufname(denops, bufnr);
    const params = parseName(bufname);
    if (isDir(params)) return;
    const cmds: string[] = [
      "if !&modifiable",
      "  return",
      "endif",
      "set nomodified",
    ];
    await fn.execute(
      denops,
      cmds.map((line) => line.trim()).join("\n"),
    );
    const perm = await fn.getbufvar(denops, bufnr, bufVarNames.perm) as string;
    const data = new TextEncoder().encode(
      lines.map((line) => `${line}\n`).join(""),
    );
    await runScp(data, perm, params);
  };

  denops.dispatcher = {
    async [dispatcherNames.SETUP](bufnr): Promise<void> {
      unknownutil.ensureNumber(bufnr);
      await setupBuffer(bufnr);
    },
    async [dispatcherNames.ON_ENTER](): Promise<void> {
      await onEnter();
    },
    async [dispatcherNames.ON_SAVE](bufnr, lines): Promise<void> {
      unknownutil.ensureNumber(bufnr);
      unknownutil.ensureArray(lines, unknownutil.isString);
      await onSave(bufnr, lines);
    },
  };

  await Promise.all([
    internal.setup(denops),
    setupAllBuffers(),
  ]);
}
