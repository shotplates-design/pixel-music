export function nextIndex(index, length) {
  if (!Number.isInteger(length) || length <= 0) return -1;
  if (!Number.isInteger(index) || index < 0 || index + 1 >= length) return -1;
  return index + 1;
}

export function previousAction(index, length, currentTime, threshold = 3) {
  if (!Number.isInteger(length) || length <= 0 || !Number.isInteger(index) || index < 0 || index >= length) {
    return { type: "none", index: -1 };
  }
  if (Number.isFinite(currentTime) && currentTime > threshold) {
    return { type: "restart", index };
  }
  if (index > 0) return { type: "goto", index: index - 1 };
  return { type: "restart", index };
}
