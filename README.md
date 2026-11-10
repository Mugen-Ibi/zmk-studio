# ZMK Studio

This is Mugen-Ibi's public fork of [zmkfirmware/zmk-studio](https://github.com/zmkfirmware/zmk-studio), based on upstream commit `1bb6bb84a370c8917d8e4db15207087b26b3a844`. It is not an official ZMK Project release.

## Changes in this fork

- Show an explicit unselected option when a behavior parameter does not match its advertised constants. This lets MB1 be selected reliably when a new mouse binding starts at zero.
- Display metadata-defined constant names, including MB1–MB5, on keycaps.
- Isolate RPC queues and cancellation by connection, serialize edit/save/undo operations, and reset session state on disconnect.
- Share native transport handling, acknowledge actual writes, wait for BLE notification readiness, and report recoverable connection errors.
- Validate behavior parameters against firmware metadata, show complete binding summaries, and commit layout changes only after firmware success.
- Test the rendered application with framed Protobuf fake devices, plus browser/native transport contracts and Rust I/O failures.
- Package a separately identified Windows x64 app, **ZMK Studio Mugen-Ibi**, so it can coexist with the official app.

Mouse buttons still require firmware-provided behavior metadata (ZMK PR #2950). This fork does not fabricate metadata or bypass firmware validation. Firmware updates, resets, and device-specific backups are not included in this repository.

## Windows downloads

Download the setup executable from [this fork's releases](https://github.com/Mugen-Ibi/zmk-studio/releases). Builds are unsigned; Windows may display an unknown-publisher warning. WebView2 is required and the installer can download it if missing.

## Development and verification

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run build-storybook -- --disable-telemetry
npm audit --audit-level=low
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo install cargo-audit --locked --version 0.22.2
cargo audit --file src-tauri/Cargo.lock
npm run tauri -- build --bundles nsis -- --locked
```

Use Node >=22.12 and the stable Rust toolchain selected by `rust-toolchain.toml`. Windows builds require MSVC and the Tauri Windows prerequisites. There is no Rust 1.60 compatibility promise: CI builds the current stable compiler with the checked-in lockfiles. The Windows workflow runs on pull requests and main pushes and checks all source, stories, tests, and build configuration.

The regression suites cover the 2026-11-10 technical-debt review as follows:

| Review items | Implementation and regression coverage |
| --- | --- |
| TD-01–05, TD-10–11 | Connection-owned RPC queues; session IDs; native readiness, acknowledged full writes, bounded setup/discovery, cancellation and error propagation. `rpc`, `native-transport`, `web-transport` tests and Rust transport tests. |
| TD-06, TD-08–09 | Session reset, serialized commands, failure-safe history and successful save/discard boundaries. `undo-redo` and `app-session` tests. |
| TD-12–18 | Metadata validation, hidden-parameter normalization, distinct binding labels, layer selection/reorder/delete and atomic layout changes. `ui-regressions`, `app-session` and existing mouse tests. |
| TD-19–20 | Application integration tests exercise real framing and save state; full ESLint/type checks, Storybook and Rust checks run in CI. |
| TD-21–23 | Explicit published assets, accessible controls and modal listener cleanup. `ui-regressions` tests. |
| TD-07, TD-24 | Updated npm/Cargo locks, removed async-std, documented current toolchain, dependency audits in CI. |

Additional cleanup includes rotated layout bounds, configurable hover zoom, immutable metadata sorting, numeric editing of mixed metadata alternatives, typed local-storage parsing, session-scoped notifications, shared native entrypoints, narrowed event permissions, and lazy About/license dialogs. Mixed alternatives use a validated unsigned numeric wire value; only firmware-advertised values are accepted.

Tests use simulated devices and do not establish compatibility with every keyboard, radio or OS driver. Real USB/BLE hardware and macOS/Linux native operation still require device-specific testing. The supported downloadable native package is Windows x64.

As of 2026-11-10, npm audit reports no vulnerabilities and cargo audit reports no vulnerability entries. Cargo still reports informational advisories for Linux-only transitive `glib 0.18` (RUSTSEC-2024-0429, unsound) and `proc-macro-error 1` (RUSTSEC-2024-0370, unmaintained), inherited from Tauri's GTK stack. These are not suppressed; updating that stack requires upstream compatibility work and Linux validation. They are not dependencies of the shipped Windows target.

Scoped npm overrides upgrade `minimatch` under TypeScript ESLint and `glob` under Storybook's docgen plugin to patched majors. Lint and Storybook builds exercise these consumers; remove the overrides when their parents adopt patched ranges.

## Release metadata

`release.json` records the actual published fork tag, release page and available assets. Update it only after those assets exist. The generator validates asset URLs and checks that package.json, Cargo.toml and tauri.conf.json versions agree; it does not infer a fork suffix or advertise unbuilt formats. Source changes do not automatically publish or replace a release.

## License and attribution

The source remains **Apache-2.0**, matching upstream. [LICENSE](LICENSE) and the original [NOTICE](NOTICE) are retained without changes and included in the Windows package. Third-party dependencies retain their own licenses. Source and packaging modifications by Mugen-Ibi are described above; no upstream endorsement is implied.
