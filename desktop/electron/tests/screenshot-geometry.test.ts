import {expect, it} from 'vitest';
import {cropRegion} from '../screenshot/geometry';
it('uses actual thumbnail dimensions for Retina and mixed-DPI monitors', () => {
  expect(cropRegion({x: 100, y: 50, width: 400, height: 200}, {width: 1920, height: 1080}, {width: 3840, height: 2160}))
    .toEqual({x: 200, y: 100, width: 800, height: 400});
  expect(cropRegion({x: 100.5, y: 50.5, width: 400, height: 200}, {width: 1920, height: 1080}, {width: 2400, height: 1350}))
    .toEqual({x: 125, y: 63, width: 501, height: 251});
});
it('rejects malformed, offscreen and tiny regions before cropping', () => {
  for (const region of [null, {}, {x: NaN, y: 0, width: 20, height: 20}, {x: -1, y: 0, width: 20, height: 20},
    {x: 0, y: 0, width: 5, height: 20}, {x: 1910, y: 0, width: 30, height: 20}])
    expect(() => cropRegion(region, {width: 1920, height: 1080}, {width: 3840, height: 2160})).toThrow();
});
