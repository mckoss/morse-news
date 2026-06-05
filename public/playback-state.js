export function headlineKey(item) {
  return [
    item?.title ?? '',
    item?.source ?? '',
    item?.category ?? '',
    item?.link ?? '',
  ].map((value) => String(value).trim().toLowerCase()).join('|');
}

export function nextHeadlineIndex(lastCompletedHeadlineIndex, headlineCount) {
  if (headlineCount <= 0) return 0;
  return (lastCompletedHeadlineIndex + 1 + headlineCount) % headlineCount;
}

export function headlineSetKey(headlines, fetchedAt = '') {
  if (!Array.isArray(headlines) || headlines.length === 0) return String(fetchedAt || 'empty');
  const identity = headlines.map(headlineKey).join('\n');
  return `${String(fetchedAt || 'unknown')}|${hashString(identity)}`;
}

export function resolveCompletedHeadlineIndex(saved, headlines, fetchedAt) {
  if (!saved || !Array.isArray(headlines) || headlines.length === 0) return -1;

  const setProgress = saved.setProgress?.[headlineSetKey(headlines, fetchedAt)];
  if (setProgress) {
    const savedIndex = Number(setProgress.lastCompletedHeadlineIndex);
    if (Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < headlines.length) {
      return savedIndex;
    }
  }

  if (saved.fetchedAt !== fetchedAt) return -1;

  const savedKey = String(saved.lastCompletedHeadlineKey || '');
  const completedIndex = savedKey
    ? headlines.findIndex((headline) => headlineKey(headline) === savedKey)
    : -1;
  if (completedIndex >= 0) return completedIndex;

  const savedIndex = Number(saved.lastCompletedHeadlineIndex);
  if (Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < headlines.length) {
    return savedIndex;
  }

  return -1;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
