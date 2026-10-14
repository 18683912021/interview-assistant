export type Region = {x: number; y: number; width: number; height: number};

/** Selection coordinates are local CSS pixels; thumbnail dimensions may differ from display scaling. */
export function cropRegion(value: unknown, display: {width: number; height: number}, image: {width: number; height: number}): Region {
  const rect = value as Region;
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
      rect.x < 0 || rect.y < 0 || rect.width < 12 || rect.height < 12 ||
      rect.x + rect.width > display.width + 1 || rect.y + rect.height > display.height + 1 ||
      display.width <= 0 || display.height <= 0 || image.width <= 0 || image.height <= 0)
    throw new Error('请拖动框选题目，选区至少 12 × 12 像素。');
  const x = Math.floor(rect.x * image.width / display.width);
  const y = Math.floor(rect.y * image.height / display.height);
  const right = Math.min(image.width, Math.ceil((rect.x + rect.width) * image.width / display.width));
  const bottom = Math.min(image.height, Math.ceil((rect.y + rect.height) * image.height / display.height));
  return {x, y, width: right - x, height: bottom - y};
}
