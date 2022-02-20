// deno-lint-ignore-file require-await
import { path } from "https://deno.land/x/denops_core@v1.0.0/deps.ts";
import { base64, Denops, fmtBytes, fn, streams, unknownutil } from "./deps.ts";
import * as internal from "./internal_autoload_fn.ts";
import { StatTypeName, statTypes } from "./stat.ts";

export interface DirInfo {
  headerLength: number;
  to: string[];
}

const bufVarNames = {
  perm: "ssher_perm",
  dirInfo: "ssher_dir_info",
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

const basename = (p: string) => {
  if (p === ".") return p;
  if (p === "..") return p;
  return path.basename(p);
};

const joinCommandsInShell = (
  commands: readonly (readonly string[])[],
): string[] => {
  return [
    "sh",
    "-c",
    commands.map((cmd) => toEscapedShellLine(cmd)).join("\n"),
  ];
};

const toEscapedShellLine = (cmd: readonly string[]): string => {
  const escaped = cmd.map((c) => base64.encode(c)).map((b) =>
    `"$(printf "%s" ${b}|base64 -d)"`
  ).join(" ");
  return escaped;
};

interface SshTarget {
  user: string;
  host: string;
  port?: string;
}
const parseSshTarget = (target: string): SshTarget => {
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

interface SSHerParams {
  target: SshTarget;
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
    target: parseSshTarget(targetStr),
    path: pathStr,
  };
};
const constructName = (
  { path, target: { user, host, port } }: SSHerParams,
): string => {
  return `ssher://${user}@${host}${port ? `:${port}` : ""}/${path}`;
};

const isDir = ({ path: p }: SSHerParams) => p.endsWith("/") || p === "";

export interface StatAccess {
  oct: string;
  isSymlink: boolean;
  isDirectory: boolean;
}
const parseStatAccess = (statStr: string): StatAccess => {
  const t = (f: number): number => {
    return (statStr[f] !== "-" ? 4 : 0) +
      (statStr[f + 1] !== "-" ? 2 : 0) +
      (statStr[f + 2] !== "-" ? 1 : 0);
  };
  return {
    oct: `${t(1)}${t(4)}${t(7)}`,
    isSymlink: statStr[0] === "l",
    isDirectory: statStr[0] === "d",
  };
};

const runSsh = (targetStr: SshTarget, cmd: string[]) => {
  return Deno.run({
    cmd: [
      "ssh",
      `${targetStr.user}@${targetStr.host}`,
      ...(targetStr.port ? ["-p", targetStr.port] : []),
      ...cmd,
    ],
    stdin: "piped",
    stdout: "piped",
  });
};

const runSshShellWithEscape = (targetStr: SshTarget, cmd: string[]) => {
  return runSsh(targetStr, ["sh", "-c", `'${toEscapedShellLine(cmd)}'`]);
};

const runScp = async (
  data: Uint8Array,
  perm: string,
  params: SSHerParams,
) => {
  const basename = path.basename(params.path);
  const p = runSsh(params.target, ["scp", "-qt", "--", params.path]);
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

  const setupFileBuffer = async (
    bufnr: number,
    params: SSHerParams,
  ): Promise<void> => {
    const p = await (async () => {
      const tmp = runSsh(params.target, [
        "stat",
        "--format=%A",
        "--",
        params.path,
      ]);
      const statStr = new TextDecoder().decode(
        await streams.readAll(tmp.stdout),
      ).trim();
      await fn.setbufvar(
        denops,
        bufnr,
        bufVarNames.perm,
        parseStatAccess(statStr).oct,
      );
      return runSsh(params.target, ["cat", params.path]);
    })();

    const lines = new TextDecoder().decode(await streams.readAll(p.stdout))
      .split("\n");
    if (lines.length !== 1 && lines.slice(-1)[0] === "") lines.pop();
    await internal.setbufline(
      denops,
      bufnr,
      1,
      lines,
    );

    await fn.execute(denops, "set modifiable");
  };

  const setupDirBuffer = async (
    bufnr: number,
    params: SSHerParams,
  ): Promise<void> => {
    const statTypeNames = Object.keys(statTypes) as StatTypeName[];
    const script = [
      ...statTypeNames.map((name) => statTypes[name]).map((
        { format, needEscape, flags },
      ) =>
        `stat${flags ? ` ${flags}` : ""} ${
          needEscape ? "--printf" : "--format"
        }=${format} -- "$0"${needEscape ? "|base64 -w0;echo" : ""}`
      ),
      'readlink -n -f "$0"|base64 -w0;echo',
    ].join(
      ";",
    );

    const p = runSshShellWithEscape(
      params.target,
      joinCommandsInShell([
        [
          "sh",
          "-c",
          script,
          "..",
        ],
        [
          "sh",
          "-c",
          script,
          ".",
        ],
        [
          "find",
          ...params.path ? [params.path] : ["."],
          "-mindepth",
          "1",
          "-maxdepth",
          "1",
          "-exec",
          "sh",
          "-c",
          script,
          "{}",
          ";",
        ],
      ]),
    );
    const lines = new TextDecoder().decode(await streams.readAll(p.stdout))
      .trim()
      .split("\n");
    type Stat = Record<StatTypeName | "dereferenced", string>;
    const stats: Stat[] = [];
    for (let i = 0; i < lines.length;) {
      const rest = lines.length - i;
      if (rest < statTypeNames.length) {
        console.warn("ssher.vim: UNREACHABLE: #1");
        break;
      }
      const stat = Object.fromEntries(
        statTypeNames.map((statTypeName) => {
          const e: [StatTypeName, string] = [statTypeName, lines[i]];
          if (statTypes[statTypeName].needEscape) {
            e[1] = new TextDecoder().decode(base64.decode(e[1]));
          }
          i += 1;
          return e;
        }),
      ) as Stat;
      stat.dereferenced = new TextDecoder().decode(base64.decode(lines[i]));
      i += 1;
      stats.push(stat);
    }
    const formatStat = (
      { access, userId, groupId, fileName, sizeInBytes, dereferenced }: Stat,
    ): string => {
      return [
        access,
        fmtBytes.prettyBytes(Number.parseInt(sizeInBytes, 10)),
        `${userId}:${groupId}`,
        basename(fileName) + (parseStatAccess(access).isDirectory ? "/" : "") +
        (
          parseStatAccess(access).isSymlink ? `\t-> ${dereferenced}` : ""
        ),
      ].join("\t");
    };
    const header = [
      `Entries fetched at ${new Date().toLocaleString()}.`,
      `NOTE: Less custimizability. PRs are welcome.`,
      `-`.repeat(78),
      `[Enter] Select`,
      `=`.repeat(78),
      "",
    ];
    await internal.setbufline(
      denops,
      bufnr,
      1,
      [
        ...header,
        ...stats.map((stat) => formatStat(stat)),
      ],
    );

    const dirInfo: DirInfo = {
      headerLength: header.length,
      to: stats.map(({ fileName, access }) =>
        basename(fileName) + (parseStatAccess(access).isDirectory ? "/" : "")
      ),
    };
    await fn.setbufvar(
      denops,
      bufnr,
      bufVarNames.dirInfo,
      dirInfo,
    );
    await fn.execute(denops, "setlocal tabstop=12");
  };

  const setupBuffer = async (bufnr: number): Promise<void> => {
    const bufname = await fn.bufname(denops);
    const params = parseName(bufname);
    if (isDir(params)) {
      setupDirBuffer(bufnr, params);
    } else {
      setupFileBuffer(bufnr, params);
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

  const onEnter = async (bufnr: number): Promise<void> => {
    const bufname: string = await fn.bufname(denops, bufnr);
    const line = await fn.line(denops, ".") - 1;
    const params = parseName(bufname);
    const dirInfo = await fn.getbufvar(
      denops,
      bufnr,
      bufVarNames.dirInfo,
    ) as DirInfo;
    if (line < dirInfo.headerLength) return;
    const index = line - dirInfo.headerLength;
    if (index >= dirInfo.to.length) return;
    const to = dirInfo.to[index];

    await fn.execute(
      denops,
      `:e ${
        constructName({
          ...params,
          path: normalizePath(path.join(params.path ?? "", to)),
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
    async [dispatcherNames.ON_ENTER](bufnr): Promise<void> {
      unknownutil.ensureNumber(bufnr);
      await onEnter(bufnr);
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
