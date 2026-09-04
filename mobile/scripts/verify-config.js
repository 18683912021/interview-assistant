const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

const packageJson = JSON.parse(read('package.json'));
const appJson = JSON.parse(read('app.json'));
const gradleWrapper = read(
  'android/gradle/wrapper/gradle-wrapper.properties',
);
const gradleProperties = read('android/gradle.properties');
const appGradle = read('android/app/build.gradle');
const mainActivity = read(
  'android/app/src/main/java/com/poc/audiocapture/MainActivity.kt',
);
const mainManifest = read('android/app/src/main/AndroidManifest.xml');
const debugManifest = read('android/app/src/debug/AndroidManifest.xml');

assert(process.versions.node.startsWith('22.'), 'Node.js must be version 22.x');
assert(packageJson.dependencies.react === '19.0.0', 'React must be pinned to 19.0.0');
assert(
  packageJson.dependencies['react-native'] === '0.78.3',
  'React Native must be pinned to 0.78.3',
);
assert(
  packageJson.devDependencies['@react-native-community/cli'] === '15.0.1',
  'Community CLI must be pinned to 15.0.1',
);
assert(!packageJson.scripts.postinstall, 'postinstall source patches are forbidden');
assert(
  !Object.keys({...packageJson.dependencies, ...packageJson.devDependencies}).some(
    name => name === 'expo' || name.startsWith('expo-'),
  ),
  'Expo dependencies are forbidden in the RN CLI project',
);
assert(appJson.name === 'AudioCapture', 'app.json name must be AudioCapture');
assert(
  mainActivity.includes('getMainComponentName(): String = "AudioCapture"'),
  'MainActivity component name must match app.json',
);
assert(
  appGradle.includes('namespace "com.poc.audiocapture"') &&
    appGradle.includes('applicationId "com.poc.audiocapture"'),
  'Android namespace/applicationId must be com.poc.audiocapture',
);
assert(
  gradleWrapper.includes('gradle-8.12-all.zip') &&
    gradleWrapper.includes('https\\://services.gradle.org'),
  'Gradle Wrapper must use the official Gradle 8.12 HTTPS distribution',
);
assert(!gradleWrapper.includes('file\\:'), 'Local Gradle distribution URLs are forbidden');
assert(
  gradleProperties.includes('newArchEnabled=false'),
  'New Architecture must remain disabled for the legacy NativeModule baseline',
);
assert(
  gradleProperties.includes('hermesEnabled=true'),
  'Hermes must remain enabled',
);
assert(
  !/release\s*\{\s*signingConfig\s+signingConfigs\.debug/.test(appGradle),
  'Release builds must not use the debug signing key',
);
assert(
  mainManifest.includes('android:usesCleartextTraffic="false"'),
  'Release/main manifest must reject cleartext traffic',
);
assert(
  debugManifest.includes('android:usesCleartextTraffic="true"'),
  'Debug manifest must allow local Metro/WebSocket traffic',
);
assert(!fs.existsSync(path.join(root, 'ios')), 'Android-only project must not contain ios/');

if (failures.length > 0) {
  console.error('Configuration verification failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Configuration verification passed.');
