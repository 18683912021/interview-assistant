# macOS system audio

The default route uses public Core Audio process taps (macOS 14.2+), inside the main app process. It creates a private audio tap and aggregate audio device, copies float PCM through a bounded N-API queue, and reuses the streaming resampler / 40 ms transport frames. It never enumerates a display, creates a video track, saves video, or calls ScreenCaptureKit.

`coreaudio-tap.mm` follows Apple's process tap and aggregate device APIs:
https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps

Build with `node scripts/ensure-macos-audio.cjs`. Xcode Command Line Tools and official Node headers are required. The script normally finds headers beside the Node executable; otherwise set `NODE_INCLUDE_DIR`. N-API v8 avoids tying the module to one Electron/V8 ABI. The packaging hook compiles for the requested architecture and unpacks the native module before signing. Windows builds skip this component entirely.

## Permissions and lifecycle

- `NSAudioCaptureUsageDescription` is required. No private TCC API is used. System audio recording indicators are owned by macOS and must not be suppressed.
- The Core Audio IO procedure is created / started in a background worker: HAL can wait for OS authorization. Stop during startup marks cancellation; when HAL returns, the completion callback tears down every native resource. Concurrent pending startups are rejected.
- A short local probe precedes interview creation; it opens no backend connection. After native startup completes, the probe automatically plays a one-second local WAV and observes PCM for three seconds. It removes the temporary file and stops playback/capture on success, failure or cancellation. A null callback payload marks native startup readiness; live capture ignores that control event. Silent PCM is reported separately from verified playback, never as proof of permission. Users do not need to play their own audio.
- Ad-hoc updates may invalidate existing TCC code requirements. An enabled old entry does not prove the installed build is authorized. Re-authorize the installed application and restart it; do not reset permissions for other applications.
- `__screen_capture__` is an explicit fallback route. Only that choice requests `getDisplayMedia`; it displays the system screen-sharing indicator. A virtual input remains a separate user-selected route.
- Renderer system frames are ignored while native capture owns the system track. Generation guards discard callbacks from stopped interviews.

## Sharing UI

`WindowTooltip` renders hints in the protected window's DOM. Do not add native HTML `title` tooltips, native tray tooltips, OS notifications, or detached popup windows for routine feedback. Main and answer windows request content protection before showing. System permission dialogs, file pickers, menu-bar/tray menus, and OS indicators are outside that protection; capture software may also ignore the OS protection request. Validate in the actual meeting preview rather than claiming universal invisibility.
