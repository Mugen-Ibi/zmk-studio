# ZMK Studio

This is Mugen-Ibi's public fork of [zmkfirmware/zmk-studio](https://github.com/zmkfirmware/zmk-studio), based on upstream commit `1bb6bb84a370c8917d8e4db15207087b26b3a844`. It is not an official ZMK Project release.

## Changes in this fork

- Show an explicit unselected option when a behavior parameter does not match its advertised constants. This lets MB1 be selected reliably when a new mouse binding starts at zero.
- Display metadata-defined constant names, including MB1–MB5, on keycaps.
- Add 11 mock tests, including the real RPC client and Protobuf codecs, covering every mouse button's edit/save/reconnect round trip and ordinary key/modifier/layer regressions.
- Package a separately identified Windows x64 app, **ZMK Studio Mugen-Ibi**, so it can coexist with the official app.

Mouse buttons still require firmware-provided behavior metadata (ZMK PR #2950). This fork does not fabricate metadata or bypass firmware validation. Firmware updates, resets, and device-specific backups are not included in this repository.

## Windows downloads

Download the setup executable from [this fork's releases](https://github.com/Mugen-Ibi/zmk-studio/releases). Builds are unsigned; Windows may display an unknown-publisher warning. WebView2 is required and the installer can download it if missing.

## Development and verification

```sh
npm ci
npm test
npm run build
npm run tauri -- build --bundles nsis
```

The Windows build requires Rust/MSVC and the Tauri Windows prerequisites. CI uses the checked-in Cargo and npm lockfiles. The existing repository-wide `npm run lint` reports 121 errors and 22 warnings at the upstream baseline; changed frontend files and new tests pass targeted lint. See the Windows workflow for the exact checks.

## License and attribution

The source remains **Apache-2.0**, matching upstream. [LICENSE](LICENSE) and the original [NOTICE](NOTICE) are retained without changes and included in the Windows package. Third-party dependencies retain their own licenses. Source and packaging modifications by Mugen-Ibi are described above; no upstream endorsement is implied.
