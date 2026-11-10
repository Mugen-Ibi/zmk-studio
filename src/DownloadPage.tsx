import { useState } from "react";
import releaseData from "./data/release-data.json";
const formats = [
  { label: "Windows (exe)", platform: "windows", pattern: /\.exe$/i },
  { label: "Windows (msi)", platform: "windows", pattern: /\.msi$/i },
  { label: "macOS", platform: "mac", pattern: /\.dmg$/i },
  { label: "Linux (AppImage)", platform: "linux", pattern: /\.AppImage$/i },
  { label: "Linux (deb)", platform: "linux", pattern: /\.deb$/i },
];
export const Download = () => {
  const ua = navigator.userAgent.toLowerCase();
  const platform = /android|iphone|ipad|ipod/.test(ua)
    ? "mobile"
    : ua.includes("win")
      ? "windows"
      : ua.includes("mac")
        ? "mac"
        : ua.includes("linux")
          ? "linux"
          : "unknown";
  const downloads = releaseData.assets.flatMap((asset) => {
    const format = formats.find((f) =>
      f.pattern.test(asset.browser_download_url),
    );
    return format ? [{ ...format, url: asset.browser_download_url }] : [];
  });
  const available = downloads.filter((d) => d.platform === platform);
  const [showAll, setShowAll] = useState(available.length === 0);
  const shown = showAll ? downloads : available;
  return (
    <div className="bg-base-200 text-base-content min-h-full w-full flex flex-col justify-center items-center p-10 pb-48">
      <img src="/zmk-mac-app-icon.webp" alt="ZMK Studio" className="w-64" />
      <h1 className="text-3xl mb-1">ZMK Studio</h1>
      <p className="opacity-70">{releaseData.tag_name}</p>
      <div className="bg-base-100 p-8 max-w-md w-full m-2 rounded-lg shadow-lg">
        {available.length === 0 && (
          <p className="mb-3">
            This release does not provide an installer for your platform.
            Available downloads:
          </p>
        )}
        <div className="flex flex-col gap-3">
          {shown.map((d) => (
            <a
              key={d.url}
              href={d.url}
              className="p-3 bg-primary text-primary-content rounded-lg"
            >
              Download for {d.label}
            </a>
          ))}
        </div>
        {available.length > 0 && (
          <button
            className="mt-3 text-primary"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? "Hide" : "Show"} all downloads
          </button>
        )}
      </div>
      <a href={releaseData.html_url} className="hover:underline">
        See GitHub Releases →
      </a>
    </div>
  );
};
