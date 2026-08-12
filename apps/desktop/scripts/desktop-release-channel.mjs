export const DESKTOP_RELEASE_CHANNEL_ENV_NAME = "BB_DESKTOP_RELEASE_CHANNEL";

export function resolveDesktopReleaseChannel(env) {
  const rawChannel = env[DESKTOP_RELEASE_CHANNEL_ENV_NAME]?.trim();
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
    `${DESKTOP_RELEASE_CHANNEL_ENV_NAME} must be latest, nightly, or gg, got ${rawChannel}.`,
  );
}

export function createDesktopReleaseConfig(channel) {
  if (channel === "gg") {
    return {
      appId: "dev.outfitter.gg",
      applicationName: "GG",
      artifactName: "gg-${version}-${arch}.${ext}",
      iconFileName: "icon-nightly.png",
      macIconPath: "assets/icon-nightly.icns",
      releaseRepository: "galligan/bb",
      releaseTag: "desktop-gg",
      updateChannel: "latest",
      updateMetadataFileName: "latest-mac.yml",
    };
  }

  if (channel === "nightly") {
    return {
      appId: "dev.bb.desktop.nightly",
      applicationName: "bb Nightly",
      artifactName: "bb-nightly-${version}-${arch}.${ext}",
      iconFileName: "icon-nightly.png",
      macIconPath: "assets/icon-nightly.icns",
      releaseRepository: "get-bb/bb",
      releaseTag: "desktop-nightly",
      updateChannel: "nightly",
      updateMetadataFileName: "nightly-mac.yml",
    };
  }

  return {
    appId: "dev.bb.desktop",
    applicationName: "bb",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    iconFileName: "icon.png",
    macIconPath: "assets/icon.icns",
    releaseRepository: "get-bb/bb",
    releaseTag: "desktop-latest",
    updateChannel: "latest",
    updateMetadataFileName: "latest-mac.yml",
  };
}

export function createDesktopUpdateReleaseBaseUrl(
  releaseRepository,
  releaseTag,
) {
  return `https://github.com/${releaseRepository}/releases/download/${releaseTag}/`;
}
