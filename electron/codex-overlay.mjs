export const CODEX_VERSION_OVERLAY_SIZE = Object.freeze({ width: 178, height: 26 });

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function selectCodexOverlayTarget(windows) {
  const candidates = (Array.isArray(windows) ? windows : [])
    .filter((item) => item && item.visible !== false && item.minimized !== true)
    .filter((item) => numberOr(item.right) > numberOr(item.left) + 320 && numberOr(item.bottom) > numberOr(item.top) + 120)
    .sort((left, right) => Number(right.foreground === true) - Number(left.foreground === true));
  return candidates.find((item) => item.foreground === true) || null;
}

export function codexOverlayBounds(target, size = CODEX_VERSION_OVERLAY_SIZE, scale = 1) {
  const factor = Math.max(0.5, numberOr(scale, 1));
  const width = Math.max(Math.round(140 * factor), Math.round(numberOr(size.width, CODEX_VERSION_OVERLAY_SIZE.width) * factor));
  const height = Math.max(Math.round(24 * factor), Math.round(numberOr(size.height, CODEX_VERSION_OVERLAY_SIZE.height) * factor));
  const left = Math.round(numberOr(target?.clientLeft, target?.left));
  const top = Math.round(numberOr(target?.clientTop, target?.top));
  const right = Math.round(numberOr(target?.clientRight, numberOr(target?.right, left + width + 24)));
  const outerTop = Math.round(numberOr(target?.top, top));
  const reservedRight = Math.round(220 * factor);
  const horizontalInset = Math.round(12 * factor);
  const leftGuard = Math.round(8 * factor);
  const x = Math.max(left + leftGuard, right - reservedRight - width - horizontalInset);
  const y = top - outerTop < Math.round(8 * factor) ? outerTop + Math.round(10 * factor) : top + leftGuard;
  return { x, y, width, height };
}
