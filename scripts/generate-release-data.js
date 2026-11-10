// Published downloads are a versioned snapshot, independent of an unreleased build.
import fs from "node:fs/promises";
const root = new URL("../", import.meta.url);
const data = JSON.parse(
  await fs.readFile(new URL("release.json", root), "utf8"),
);
const base = "https://github.com/Mugen-Ibi/zmk-studio/releases/";
if (
  data.html_url !== base + "tag/" + data.tag_name ||
  !data.assets.every((asset) =>
    asset.browser_download_url.startsWith(
      base + "download/" + data.tag_name + "/",
    ),
  )
) {
  throw new Error("release.json must refer to one published fork release");
}
const pkg = JSON.parse(
  await fs.readFile(new URL("package.json", root), "utf8"),
);
const tauri = JSON.parse(
  await fs.readFile(new URL("src-tauri/tauri.conf.json", root), "utf8"),
);
const cargo = await fs.readFile(new URL("src-tauri/Cargo.toml", root), "utf8");
if (
  tauri.version !== pkg.version ||
  cargo.match(/^version = "([^"]+)"/m)?.[1] !== pkg.version
) {
  throw new Error(
    "package.json, Cargo.toml and tauri.conf.json versions must agree",
  );
}
await fs.mkdir(new URL("src/data/", root), { recursive: true });
await fs.writeFile(
  new URL("src/data/release-data.json", root),
  JSON.stringify(data),
);
console.log("Published fork release data generated.");
