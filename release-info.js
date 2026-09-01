const REPOSITORY = "https://github.com/guanjingyang0015/Codex-Galaxy";

const RELEASES = [
  {
    version: "1.9.1",
    tag: "v1.9.1",
    commit: "e43ce460a8bdcfbdd5fad76979740da29639c4a5",
    actionsRun: "33490869449",
    url: `${REPOSITORY}/releases/tag/v1.9.1`,
  },
];

export function releaseHistory() {
  return RELEASES.map((release) => ({ ...release }));
}
