// Modified by Mugen-Ibi: deterministic fork download links, no upstream API.
import fs from "fs/promises";
const root = new URL("../", import.meta.url);
const { version } = JSON.parse(await fs.readFile(new URL("package.json", root), "utf8"));
const tag = `v${version}-mugenibi.1`;
const filename = `ZMK.Studio.Mugen-Ibi_${version}_x64-setup.exe`;
const data = {
  tag_name: tag,
  html_url: `https://github.com/Mugen-Ibi/zmk-studio/releases/tag/${tag}`,
  assets: [{ browser_download_url: `https://github.com/Mugen-Ibi/zmk-studio/releases/download/${tag}/${filename}` }],
};
await fs.mkdir(new URL("src/data/", root), { recursive: true });
await fs.writeFile(new URL("src/data/release-data.json", root), JSON.stringify(data));
console.log("Fork release data generated.");
