# dsh-rescue

Rescue mode for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).
When a version upgrade leaves third-party plugins conflicting and the GUI will
no longer start, `dsh-rescue` temporarily strips every third-party bundle from
a profile's stack so dsh boots on a **pure core** and can repair itself — then
restores the original stack with one command. Plain Node, zero dependencies,
works fully offline, and — critically — works even when the GUI cannot boot at
all.

DSH 救援模式工具。当 DeepSeek Harness 因版本升级后第三方插件冲突而无法启动时，
`dsh-rescue` 临时摘除 profile 中所有第三方插件层，让 dsh 以纯核心启动并自行修复；
修完一条命令原样还原。纯 Node、零依赖、离线可用，dsh GUI 完全起不来时也能用。

## Why a launcher-level tool, not a rescue plugin / 为什么做在插件体系之外

DSH plugins are patch layers declared in a profile's `package.json`
(`dsh.profile.bundles`); at boot they all load in order and fail loudly — one
broken bundle refuses the whole profile. Self-repair therefore **cannot** live
inside the plugin stack (it would be the very thing being quarantined).
`dsh-rescue` edits the profile manifest directly, at the same layer as the
`dsh plugin` command:

- A **third-party** plugin = a package listed in both `dependencies` and
  `dsh.profile.bundles`.
- In-box core layers (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, …)
  are **not** in `dependencies`, so they are always kept.

`enter` only trims `bundles` and leaves `dependencies` untouched — leaving
rescue mode is therefore instant, offline, and needs no `pnpm` step.

DSH 的插件是 profile 里的 bundle 补丁层(`package.json → dsh.profile.bundles`)，启动时按
顺序全部加载且 fail-loud——一个插件崩，整个 profile 拒绝启动。所以"自救"不能做成插件
(它自己就是被隔离对象)，必须发生在插件体系之外。`dsh-rescue` 直接操作 profile 清单，
与 `dsh plugin` 命令同层。第三方插件 = 同时出现在 `dependencies` 与 `bundles` 里的包；
内置核心层(如 `@deepseek-ai/dsh-base`)不在 `dependencies` 中，必然保留。
`enter` 只精简 `bundles`、不动 `dependencies`，因此 `exit` 是秒级、离线的原样还原。

## Dual form / 双形态

The package ships two surfaces:

| Surface | Where | Purpose |
|---|---|---|
| **CLI** `dsh-rescue` | `bin/dsh-rescue.js`, global install | The real mechanism. Usable from a terminal when the GUI is dead. |
| **cordis bundle** entry | `lib/index.js` + `cordis.patch.yml` | Deliberately **inert** plugin entry (`apply()` is a no-op) that declares `dsh.bundle`, making the package installable via `dsh plugin add`. It exists for ecosystem compatibility only — a "rescue plugin" that ran at boot would defeat its own purpose. |

| 形态 | 位置 | 用途 |
|---|---|---|
| **CLI** `dsh-rescue` | `bin/dsh-rescue.js`(全局安装) | 真正的救援机制,GUI 起不来时在终端使用。 |
| **cordis bundle** 入口 | `lib/index.js` + `cordis.patch.yml` | **刻意惰性**的插件入口(`apply()` 为空),声明 `dsh.bundle` 使其可被 `dsh plugin add` 安装。仅为生态兼容——会在启动时运行的"救援插件"恰恰违背自救初衷。 |

## Install / 安装

```sh
# CLI (recommended — this is the rescue path)
npm install -g dsh-rescue

# Optional: register the inert bundle in a profile (ecosystem install form)
dsh plugin --profile web add dsh-rescue
```

## Usage / 用法

```sh
dsh-rescue enter  <profile>    # rescue ON: keep only core layers, park all third-party plugins
dsh-rescue exit   <profile>    # rescue OFF: reconcile-restore the original bundle stack
dsh-rescue status <profile>    # read-only: rescue state + core/third-party split
dsh-rescue help
```

Profiles live under `$DSH_HOME/profiles` (`DSH_HOME` defaults to `~/.dsh`);
the default web GUI profile is named `web`. Set `DSH_HOME` to target another
installation.

Typical rescue workflow / 典型救援流程:

```sh
# dsh won't start. Stop it, then:
dsh-rescue enter web          # ① profile now boots WITHOUT third-party plugins
dsh web                       # ② pure boot succeeds — repair in the GUI/CLI,
                              #    e.g.  dsh plugin --profile web remove <pkg>
dsh-rescue exit web           # ③ reconcile-restore the plugin stack
dsh web                       # ④ normal boot again
```

## Behaviour details / 行为细节

- **Transactional**: backup + state are written before the manifest is
  rewritten; a failed rewrite rolls back and leaves no half-written state.
- **Reconciled exit**: in-box core layers always return; each original
  third-party bundle returns only while its package is still in
  `dependencies`. A plugin removed during rescue (e.g. `dsh plugin ...
  remove <pkg>`) stays removed — it is not resurrected into an unresolvable
  layer.
- If a dsh boot ran while in rescue, the host may auto-append the default
  `patchReload: "live"` to the manifest; `exit` drops exactly that
  auto-written default so the round-trip stays clean. User-chosen values are
  preserved.
- Guardrails: repeated `enter`, state-less `exit`, non-profile directories and
  already-pure profiles all fail with a clear message and touch nothing.

- **事务化**:先备份+写状态,再改写清单;失败自动回滚。
- **exit 协调式还原**:核心层必然恢复;第三方插件仅当其包仍在 `dependencies` 时恢复
  (顺序不变)。救援期间用 `dsh plugin remove` 删掉的插件不会被"复活"成无法解析的层。
- 救援期间若曾用 dsh 启动,宿主可能自动补写默认 `patchReload: "live"`,`exit` 会精确摘除
  这份自动写入,保持往返干净;用户主动设置的值保留。
- 重复 enter、无状态 exit、非 profile 目录、本就无第三方插件等场景都会明确报错且不落地。

## Classification rule / 判定规则

Based on the manifest alone (`dependencies` ∩ `bundles`) — no assumptions about
package-name prefixes — so it stays correct as dsh's core/plugin shapes evolve.

仅依据清单本身判断(`dependencies` ∩ `bundles`),不假设包名前缀规则,对 dsh 核心/插件
形态的未来变化更稳健。

## Development / 开发

```sh
node --test test/rescue-core.test.js     # tests run against throwaway profiles only
node bin/dsh-rescue.js status web        # read-only look at a real profile
```

## License

MIT
