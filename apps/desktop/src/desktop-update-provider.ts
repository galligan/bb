export type DesktopReleaseChannel = "latest" | "nightly" | "gg";

export interface DesktopReleaseInfo {
  applicationName: "bb" | "bb Nightly" | "GG";
  channel: DesktopReleaseChannel;
  hostDaemonPort: 38887 | 48887;
  iconFileName: "icon.png" | "icon-nightly.png";
  releaseTag: "desktop-latest" | "desktop-nightly" | "desktop-gg";
  runtimeDataDirectoryName: ".bb" | ".gg";
  serverPort: 38886 | 48886;
  updateChannel: "latest" | "nightly";
  updateReleaseBaseUrl: string;
}

export function createDesktopReleaseInfo(
  channel: DesktopReleaseChannel,
): DesktopReleaseInfo {
  if (channel === "gg") {
    return {
      applicationName: "GG",
      channel,
      hostDaemonPort: 48887,
      iconFileName: "icon-nightly.png",
      releaseTag: "desktop-gg",
      runtimeDataDirectoryName: ".gg",
      serverPort: 48886,
      updateChannel: "latest",
      updateReleaseBaseUrl:
        "https://github.com/galligan/bb/releases/download/desktop-gg/",
    };
  }

  const nightly = channel === "nightly";
  const releaseTag = nightly ? "desktop-nightly" : "desktop-latest";

  return {
    applicationName: nightly ? "bb Nightly" : "bb",
    channel,
    hostDaemonPort: 38887,
    iconFileName: nightly ? "icon-nightly.png" : "icon.png",
    releaseTag,
    runtimeDataDirectoryName: ".bb",
    serverPort: 38886,
    updateChannel: channel,
    updateReleaseBaseUrl: `https://github.com/get-bb/bb/releases/download/${releaseTag}/`,
  };
}

function resolveBuiltDesktopReleaseChannel(
  rawChannel: string | undefined,
): DesktopReleaseChannel {
  if (rawChannel === undefined || rawChannel.length === 0) {
    return "latest";
  }
  if (
    rawChannel === "latest" ||
    rawChannel === "nightly" ||
    rawChannel === "gg"
  ) {
    return rawChannel;
  }

  throw new Error(
    `Built desktop release channel must be latest, nightly, or gg, got ${String(rawChannel)}.`,
  );
}

export const DESKTOP_RELEASE_CHANNEL = resolveBuiltDesktopReleaseChannel(
  process.env.BB_DESKTOP_RELEASE_CHANNEL,
);
export const DESKTOP_RELEASE_INFO = createDesktopReleaseInfo(
  DESKTOP_RELEASE_CHANNEL,
);
export const DESKTOP_UPDATE_RELEASE_BASE_URL =
  DESKTOP_RELEASE_INFO.updateReleaseBaseUrl;
export const DESKTOP_UPDATE_CHANNEL = DESKTOP_RELEASE_INFO.updateChannel;
export const DESKTOP_UPDATE_FEED_URL = `${DESKTOP_UPDATE_RELEASE_BASE_URL}desktop-version.json`;

export interface DesktopAutoUpdateFeedConfig {
  channel: "latest" | "nightly";
  provider: "generic";
  url: string;
}

export const DESKTOP_AUTO_UPDATE_FEED_CONFIG: DesktopAutoUpdateFeedConfig = {
  channel: DESKTOP_UPDATE_CHANNEL,
  provider: "generic",
  url: DESKTOP_UPDATE_RELEASE_BASE_URL,
};
