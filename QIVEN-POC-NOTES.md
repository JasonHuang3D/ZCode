# Qiven PoC Working Notes (branch poc/seam-events)

Working notes for Qiven sessions continuing the harness-mediation proof of
concept on this clone (upstream `29628c9` = tag `v3.14.3`). The evidence
record and its claims live in qiven-docs PR #3 document 05; this file is the
pitfall diary and reproduction cookbook so a future session does not step on
the same mines. Nothing here is pushed anywhere.

## 1. What this branch carries

- `5948bf6` observation events: helper `apps/zcode-cli/packages/adapters/src/model/qiven-poc-emit.ts`
  plus emit points at (a) the executor seam in `runner.ts` (both `generateText`
  and `streamText`, first statements, phase `logical`) and (b) immediately
  before `input.runtime.generateText/streamText(options)` in `runner-generate.ts`
  / `runner-stream.ts` (phase `final-permit`, after options construction and
  per-attempt model re-resolution).
- `47da19f` optional deny: `QIVEN_POC_PERMIT=deny` throws `QivenPocPermitDenied`
  at the final-permit point, before the SDK call.
- Flags: `QIVEN_POC=1` + `QIVEN_POC_LOG=<abs jsonl path>` enable events; unset
  = zero side effects (proven by negative control). Patch file also saved at
  `<scratch>/seam-events.patch`.

## 2. Environment recipe (measured 2026-09-25/26)

- Portable Node v24.14.0 + pnpm 10.33.2 side-by-side in a scratch dir
  (`node.exe` and `pnpm` shim live there; prepend to PATH). System Node untouched.
- `pnpm install` at repo root: **2m28s** (includes node-gyp ssh2 optional build,
  node-pty prebuild, husky). Set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  and `COREPACK_ENABLE_PROJECT_SPEC=0` per `mise.toml`.
- Narrow build chain (64s full / 30s incremental), producing
  `apps/zcode-cli/packages/cli/dist/zcode.cjs`:
  `pnpm --filter @zcode/shared-types --filter @zcode/contracts --filter @zcode/dynamic-workflow --filter @zcode/dynamic-workflow-runtime --filter @zcode/core --filter @zcode/adapters --filter @zcode/i18n --filter @zcode/telemetry --filter @zcode/bootstrap build && pnpm --filter @zcode/cli build:desktop-agent`
  (verify exact package names against package.json if filters error).

## 3. Pitfalls (symptom → cause → fix)

1. **JSON env value corrupted ("Bad escaped character in JSON at position 5",
   surfaced as `database_startup_disk`/`app_startup_failed` in the packaged
   host).** The ZCode session tool channel eats backslash escapes inside
   command strings: `\\` arrives as `\`, making `ZCODE_AGENT_SERVER_ARGS_JSON`
   unparseable. Fix: use **forward slashes in every path inside env values**
   (Windows accepts them); never rely on backslash escaping surviving the
   tool channel. Same defect class as Qiven's recorded heredoc/escape-eating law.
2. **Host-app prepared env silently overrides scratch isolation.** Shells and
   children inherit `ZCODE_DATA_BASE_DIR`, `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`,
   `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` (and more) from the RUNNING Desktop that
   hosts the session (values pointing at the real data root). Pin all three
   explicitly on every run. `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` must point at
   the repo's shipped `apps/zcode-cli/packages/cli/dist/provider/zcode-builtin.json`
   — pointing it at a personal config fails startup with
   "Bundled 与 Active ZCode Built-in Release 均不可用".
3. **Custom mock provider config shape (else "Model creation failed")**: a
   manual model entry needs `optionSpecs` including a `reasoningLevel` spec
   (values + map); the provider entry needs `personalModelIds` listing the
   model; `defaultModelSelection` must set `options.reasoningLevel`. Working
   example lives at `<scratch>/scratch-home/.zcode/v2/provider_config.json`
   (openai-chat-completions against `http://127.0.0.1:8931/v1`, SSE works).
4. **Desktop single-instance lock**: a second instance with the same
   application name / userData just activates the running instance and exits 0
   (your env goes nowhere). Isolate with `ZCODE_DESKTOP_APPLICATION_NAME=<distinct>`
   + `ZCODE_DESKTOP_USER_DATA_DIR=<scratch>`.
5. **Packaged-Desktop business root overrides env**: `<homedir>/.zcode/v2/setting.json`
   (`dataBaseDir`) is read early (`desktopDataBaseDirBootstrap.ts`) and wins
   over `ZCODE_DATA_BASE_DIR`. Isolate by pointing `USERPROFILE` (and `HOME`)
   at a scratch profile so that file is absent.
6. **Scratch profile must pre-exist with standard structure**: without
   `<scratch-profile>/AppData/Roaming` the ARMS RUM SDK dies at module init
   ("Failed to get 'userData' path") before anything else logs.
7. **RESOLVED via dev mode — packaged-app isolated instance still open.** The
   isolated PACKAGED instance exits cleanly (exit 0, no crash entry) after
   early init + renderer/GPU init, before spawning an agent (undocumented
   cause; keep the scratch-profile/USERPROFILE recipe above if retried).
   The WORKING route for a Desktop-chain trial is the repository's own dev
   entry: `pnpm dev:desktop:test` (builds the patched agent fresh, then starts
   Electron dev as "ZCode Dev" — separate app identity, no single-instance
   collision). Under the same scratch env pinning, the dev Desktop spawned
   the patched agent (`electron.exe` as Node running
   `apps/zcode-cli/packages/cli/dist/zcode.cjs app-server --stdio --surface
   desktop`), and one GUI-sent message produced the full evidence chain:
   `logical` (operation=agent_step, actorKind=main, msgCount=6, toolCount=33
   on the desktop surface) then `final-permit` (attempt=1, msgCount=4,
   projectionDigest) then the mock wire hit (stream, msgCount=4) — the same
   two-phase projection change as the CLI run. Recipe: export the isolation
   envs of section 5 + `QIVEN_POC*`, run `pnpm dev:desktop:test` in background,
   click a new chat in the "ZCode Dev" window (never log in a real account),
   pick `poc-mock-model` if prompted, send `hello`.
8. **An agent process only spawns when a workspace session opens in the GUI** —
   a Desktop-originated model call is never headless. Plan Desktop-chain trials
   accordingly (loading proof vs full-chain proof are different claims).
8a. **External browsers opened from an env-isolated app inherit the isolation**
   (owner-observed 2026-09-26): the dev app's OAuth popup launched the system
   browser with the scratch `USERPROFILE`, so it opened with an empty scratch
   profile and looked like "my browser history is gone". The real browser
   profile on disk was untouched (verified); the fix was closing the isolated
   window and relaunching normally. Corollary of pitfall 7: never complete real
   logins inside isolated trials, and avoid opening external browsers from
   env-overridden apps.
9. **In-session searching**: `grep -r` over this tree trips the Qiven router's
   sweep class (exec-lease). `git grep` reads the index and passes. Builds and
   long steps: harness background bash (`run_in_background`), never polling.
10. **Orphaned task trees**: a Desktop-launch background task can look finished
    (no completion notification) while its bash wrapper and the launched
    app's helper children stay alive for hours. Before closing a session,
    sweep `Win32_Process` by CommandLine match for the scratch paths and
    `taskkill /T /F` the leftovers (observed: wrapper tree + five orphaned
    host helpers from an "exited" instance).
11. **Failed startup is not process exit.** A launched Desktop instance that
    logs `app_startup_failed` may keep running indefinitely with live helper
    children (no window), so its background task legitimately stays "running"
    in the UI and no completion notification arrives. The UI is telling the
    truth; do not assume the instance died because startup failed.
12. **TaskStop needs the FULL task id.** Background task ids carry a UUID
    suffix (`exec_<8hex>-<uuid>`); passing the truncated prefix returns
    "No task found" while the task keeps running. Always copy the complete id
    from the launch result or the notification. (Incident: a truncated stop
    attempt was misread as "devkit exec defect" — it was operator error;
    the harness and the devkit exec subsystem were both behaving correctly.)
13. **TaskStop can leave wrapper stragglers.** After TaskStop of a dev-run
    task, the `sh.exe`/cmd wrapper chain survived with children; sweep by
    CommandLine match and `taskkill /T /F` the root before declaring clean
    (the kill also sweeps job-grouped helpers of the stopped app).

## Toolchain ruling (owner, 2026-09-26)

The portable Node 24.14.0/pnpm scratch environment stays OUT of
qiven-toolchain-win: that Node version is ZCode-specific (pinned by ZCode's
own mise.toml). If Qiven later has a concrete cross-repository need for a
pinned Node, the promotion should be a general-purpose Node tool entry
decided on its own merits, not a ZCI-specific pin inherited from this PoC.

## 4. Measured facts worth remembering

- Clone HEAD == pinned `29628c9` == tag `v3.14.3`; but the INSTALLED running
  build self-reports `ZCODE_BUILD_COMMIT_ID=ab4d5e6b` — version parity is not
  binary equivalence; bind the reported build commit in any trial packet.
- Smoke event pair: `logical` msgCount 6 vs `final-permit` msgCount 4 — the
  executor-to-send projection changes content; a logical-layer guard cannot
  attest the sent payload (the empirical basis for the two-phase design).
- Pre-send deny: zero wire traffic; exactly 1 attempt of an 11-attempt budget;
  telemetry records `model_request_failed`, `exceptionType` preserved,
  `errorPhase: "prepare"`, `retryable: false` — upstream already classifies
  local pre-send throws as nonretryable; no custom retry suppression needed.
- Headless `-p` one-shot uses the STREAM path only (`runner: "stream"`); the
  non-stream generate seam is compiled but not exercised by this scenario.
- Update posture: shipped update feed is an inert localhost placeholder even
  though settings enable auto-update — no remote wipe risk on this version;
  still record the feed as a preflight input.

## 5. Reproduction cookbook (smoke + deny)

```bash
export PATH="/d/<scratch>/env/node-v24.14.0-win-x64:$PATH"
# build (section 2), then start mock (zero-dep server, port 8931) in background
node /d/<scratch>/mock-provider.mjs &
QIVEN_POC=1 QIVEN_POC_LOG=/d/<scratch>/logs/events.jsonl \
ZCODE_DATA_BASE_DIR=D:/<scratch>/scratch-home \
ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=D:/<scratch>/scratch-home/.zcode/v2/provider_config.json \
ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=D:/<work>/ZCode/apps/zcode-cli/packages/cli/dist/provider/zcode-builtin.json \
node apps/zcode-cli/packages/cli/dist/zcode.cjs -p "Reply with exactly this text and nothing else: MOCK-OK" --output-format json
# deny variant: add QIVEN_POC_PERMIT=deny ; expect exit 1 and zero mock hits
```

## 6. Pointers

- Evidence record + claims: qiven-docs PR #3, `proposal/2026-09-25/05-poc-feasibility-evidence.md`.
- Scratch layout: `zcode-poc/{env,logs,scratch-home,scratch-profile,desktop-userdata,mock-provider.mjs,seam-events.patch}`.
- Attribution: commits on this branch carry `LLM: <model> reasoning <level>` trailers per Qiven convention; this clone is disposable local material — never push it.
