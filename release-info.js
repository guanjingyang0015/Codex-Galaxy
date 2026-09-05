const REPOSITORY = "https://github.com/guanjingyang0015/Codex-Galaxy";

const RELEASES = [
  {
    version: "1.10.1",
    tag: "v1.10.1",
    commit: null,
    actionsRun: null,
    url: `${REPOSITORY}/releases/tag/v1.10.1`,
  },
  {
    version: "1.9.9",
    tag: "v1.9.9",
    commit: null,
    actionsRun: null,
    url: `${REPOSITORY}/releases/tag/v1.9.9`,
  },
  {
    version: "1.9.8",
    tag: "v1.9.8",
    commit: null,
    actionsRun: null,
    url: `${REPOSITORY}/releases/tag/v1.9.8`,
  },
  {
    version: "1.9.7",
    tag: "v1.9.7",
    commit: null,
    actionsRun: null,
    url: `${REPOSITORY}/releases/tag/v1.9.7`,
  },
  {
    version: "1.9.6",
    tag: "v1.9.6",
    commit: "0d69c41086b50e8c6998f0e1ee5ed68b844dc378",
    actionsRun: "33596691391",
    url: `${REPOSITORY}/releases/tag/v1.9.6`,
  },
  {
    version: "1.9.5",
    tag: "v1.9.5",
    commit: "bd79c97537d3b445cf90e699032fee748d61ec68",
    actionsRun: "33575164593",
    url: `${REPOSITORY}/releases/tag/v1.9.5`,
  },
  {
    version: "1.9.4",
    tag: "v1.9.4",
    commit: "c7e0034525e895bbd0f855cc5edd229098e1f938",
    actionsRun: "33521136697",
    url: `${REPOSITORY}/releases/tag/v1.9.4`,
  },
  {
    version: "1.9.3",
    tag: "v1.9.3",
    commit: "94c9a78fa6b5688e90994b628666e615c727dea5",
    actionsRun: "33519336408",
    url: `${REPOSITORY}/releases/tag/v1.9.3`,
  },
  {
    version: "1.9.2",
    tag: "v1.9.2",
    commit: "e3e61a5b51e6f903394302b3eeb2437c94d7d318",
    actionsRun: "33505366436",
    url: `${REPOSITORY}/releases/tag/v1.9.2`,
  },
  {
    version: "1.9.1",
    tag: "v1.9.1",
    commit: "e43ce460a8bdcfbdd5fad76979740da29639c4a5",
    actionsRun: "33490869449",
    url: `${REPOSITORY}/releases/tag/v1.9.1`,
  },
];

export function releaseHistory(currentVersion = null) {
  const normalizedVersion = String(currentVersion || "").trim().replace(/^v/i, "");
  if (!normalizedVersion) return RELEASES.map((release) => ({ ...release }));
  const current = RELEASES.find((release) => release.version === normalizedVersion);
  if (current) return [current, ...RELEASES.filter((release) => release !== current)].map((release) => ({ ...release }));
  return [
    {
      version: normalizedVersion,
      tag: `v${normalizedVersion}`,
      commit: null,
      actionsRun: null,
      url: `${REPOSITORY}/releases/tag/v${normalizedVersion}`,
    },
    ...RELEASES,
  ].map((release) => ({ ...release }));
}
