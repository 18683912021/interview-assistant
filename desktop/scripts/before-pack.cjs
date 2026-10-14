const {ensureMacAudio} = require('./ensure-macos-audio.cjs');
const {ensureNative} = require('./ensure-native.cjs');
const {ensureScreenshot} = require('./ensure-screenshot.cjs');

// Builder Arch enum: ia32=0, x64=1, armv7l=2, arm64=3, universal=4.
// Validate the requested target even when the command was run on macOS.
module.exports = async function beforePack(context) {
  const arch =
    typeof context.arch === 'string'
      ? context.arch
      : ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][context.arch];
  if (!arch) throw new Error(`Unknown packaging architecture: ${context.arch}`);
  ensureMacAudio({root: context.packager.projectDir, platform: context.electronPlatformName, arch});
  ensureNative({
    root: context.packager.projectDir,
    platform: context.electronPlatformName,
    arch,
    electronVersion: context.packager.info.framework.version,
  });
  ensureScreenshot(context.packager.projectDir);
};
