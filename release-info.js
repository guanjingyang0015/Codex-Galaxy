const REPOSITORY = "https://github.com/guanjingyang0015/Codex-Galaxy";

const RELEASES = [
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

export function releaseHistory() {
  return RELEASES.map((release) => ({ ...release }));
}
