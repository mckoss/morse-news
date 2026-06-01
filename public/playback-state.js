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

export function resolveCompletedHeadlineIndex(saved, headlines, fetchedAt) {
  if (!saved || !Array.isArray(headlines) || headlines.length === 0) return -1;

  const savedKey = String(saved.lastCompletedHeadlineKey || '');
  const completedIndex = savedKey
    ? headlines.findIndex((headline) => headlineKey(headline) === savedKey)
    : -1;

  if (completedIndex >= 0) return completedIndex;

  if (saved.fetchedAt === fetchedAt) {
    const savedIndex = Number(saved.lastCompletedHeadlineIndex);
    if (Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < headlines.length) {
      return savedIndex;
    }
  }

  return -1;
}
