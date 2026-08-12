export type DesktopReleaseChannel = "latest" | "nightly" | "gg";

export interface DesktopReleaseConfig {
  appId: "dev.bb.desktop" | "dev.bb.desktop.nightly" | "dev.outfitter.gg";
  applicationName: "bb" | "bb Nightly" | "GG";
  artifactName: string;
  iconFileName: "icon.png" | "icon-nightly.png";
  macIconPath: "assets/icon.icns" | "assets/icon-nightly.icns";
  releaseRepository: "get-bb/bb" | "galligan/bb";
  releaseTag: "desktop-latest" | "desktop-nightly" | "desktop-gg";
  updateChannel: "latest" | "nightly";
  updateMetadataFileName: "latest-mac.yml" | "nightly-mac.yml";
}

export const DESKTOP_RELEASE_CHANNEL_ENV_NAME: "BB_DESKTOP_RELEASE_CHANNEL";

export function resolveDesktopReleaseChannel(
  env: NodeJS.ProcessEnv,
): DesktopReleaseChannel;

export function createDesktopReleaseConfig(
  channel: DesktopReleaseChannel,
): DesktopReleaseConfig;

export function createDesktopUpdateReleaseBaseUrl(
  releaseRepository: DesktopReleaseConfig["releaseRepository"],
  releaseTag: DesktopReleaseConfig["releaseTag"],
): string;
