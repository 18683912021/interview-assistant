// Pure system audio: no ScreenCaptureKit, display enumeration or video buffers.
// Uses the public Core Audio process-tap API (macOS 14.2+).
#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#include <node_api.h>
#include <atomic>
#include <vector>
#include <string>
#include <cstring>
#include <algorithm>

static std::atomic<unsigned> pendingStarts{0};
struct Packet { std::vector<float> samples; bool overflow = false; };
struct Capture {
  AudioObjectID tap = 0, device = 0;
  AudioDeviceIOProcID proc = nullptr;
  AudioStreamBasicDescription format = {};
  napi_threadsafe_function callback = nullptr;
  std::atomic<bool> active{false}, overflow{false}, starting{false};
  void stop() {
    active = false;
    // The pending worker owns HAL resources until its completion callback.
    if (starting) return;
    if (proc && device) {
      AudioDeviceStop(device, proc);
      AudioDeviceDestroyIOProcID(device, proc);
      proc = nullptr;
    }
    if (callback) { napi_release_threadsafe_function(callback, napi_tsfn_abort); callback = nullptr; }
    if (device) { AudioHardwareDestroyAggregateDevice(device); device = 0; }
    if (tap) { AudioHardwareDestroyProcessTap(tap); tap = 0; }
  }
};
static void cleanup(void* data) { static_cast<Capture*>(data)->stop(); }
static void finalize(napi_env env, void* data, void*) {
  napi_remove_env_cleanup_hook(env, cleanup, data);
  cleanup(data); delete static_cast<Capture*>(data);
}
static napi_value fail(napi_env env, const char* stage, OSStatus status = 0) {
  std::string text = std::string("系统音频") + stage + "失败（Core Audio " + std::to_string(status) +
    "）。请在隐私与安全性中允许本应用录制系统音频；更新授权后退出并重新打开应用。";
  napi_throw_error(env, "E_COREAUDIO", text.c_str()); return nullptr;
}
static void deliver(napi_env env, napi_value fn, void*, void* data) {
  auto* packet = static_cast<Packet*>(data);
  if (env && fn) {
    napi_value args[2], receiver;
    napi_get_undefined(env, &receiver); napi_get_null(env, &args[0]); napi_get_null(env, &args[1]);
    if (packet->overflow) {
      napi_value message; napi_create_string_utf8(env, "系统音频处理过慢，采集已暂停，请重试。", NAPI_AUTO_LENGTH, &message);
      napi_create_error(env, nullptr, message, &args[0]);
    } else {
      napi_create_buffer_copy(env, packet->samples.size() * sizeof(float), packet->samples.data(), nullptr, &args[1]);
    }
    napi_value result; napi_call_function(env, receiver, fn, 2, args, &result);
  }
  delete packet;
}
static OSStatus input(AudioObjectID, const AudioTimeStamp*, const AudioBufferList* buffers,
  const AudioTimeStamp*, AudioBufferList*, const AudioTimeStamp*, void* context) {
  auto* c = static_cast<Capture*>(context);
  if (!c->active || !buffers || !buffers->mNumberBuffers) return noErr;
  const auto channels = c->format.mChannelsPerFrame;
  UInt32 frames = UINT32_MAX, channelTotal = 0;
  for (UInt32 i = 0; i < buffers->mNumberBuffers; ++i) {
    const auto& b = buffers->mBuffers[i];
    if (!b.mData || !b.mNumberChannels) return noErr;
    frames = std::min(frames, b.mDataByteSize / (UInt32)(sizeof(float) * b.mNumberChannels));
    channelTotal += b.mNumberChannels;
  }
  if (!frames || frames > 32768 || channelTotal != channels) return noErr;
  auto* p = new Packet();
  p->overflow = c->overflow.exchange(false);
  if (!p->overflow) {
    p->samples.resize(frames * channels);
    UInt32 offset = 0;
    for (UInt32 i = 0; i < buffers->mNumberBuffers; ++i) {
      const auto& b = buffers->mBuffers[i]; const auto* src = static_cast<const float*>(b.mData);
      for (UInt32 f = 0; f < frames; ++f)
        for (UInt32 ch = 0; ch < b.mNumberChannels; ++ch)
          p->samples[f * channels + offset + ch] = src[f * b.mNumberChannels + ch];
      offset += b.mNumberChannels;
    }
  }
  if (napi_call_threadsafe_function(c->callback, p, napi_tsfn_nonblocking) != napi_ok) {
    c->overflow = true; delete p;
  }
  return noErr;
}
static Capture* unwrap(napi_env env, napi_callback_info info, size_t* argc, napi_value* argv) {
  napi_value self; napi_get_cb_info(env, info, argc, argv, &self, nullptr);
  Capture* c = nullptr; napi_unwrap(env, self, reinterpret_cast<void**>(&c)); return c;
}
struct StartWork {
  Capture* capture;
  napi_async_work work = nullptr;
  napi_ref self, callback;
  OSStatus status = noErr;
};
static void startBackground(napi_env, void* data) {
  auto* w = static_cast<StartWork*>(data); auto* c = w->capture;
  @autoreleasepool {
    if (!c->active) return;
    w->status = AudioDeviceCreateIOProcID(c->device, input, c, &c->proc);
    if (!w->status && c->active) w->status = AudioDeviceStart(c->device, c->proc);
  }
}
static void startComplete(napi_env env, napi_status status, void* data) {
  auto* w = static_cast<StartWork*>(data); auto* c = w->capture;
  c->starting = false; --pendingStarts;
  const bool report = c->active && (w->status || status != napi_ok);
  if (!c->active || report) c->stop();
  if (report) {
    napi_value fn, receiver, message, args[2], ignored;
    napi_get_reference_value(env, w->callback, &fn); napi_get_undefined(env, &receiver);
    std::string text = "系统音频启动失败（Core Audio " + std::to_string(w->status) + "）。请允许系统音频录制，退出并重新打开应用后重试。";
    napi_create_string_utf8(env, text.c_str(), NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, nullptr, message, &args[0]); napi_get_null(env, &args[1]);
    napi_call_function(env, receiver, fn, 2, args, &ignored);
  }
  napi_delete_reference(env, w->callback); napi_delete_reference(env, w->self);
  napi_delete_async_work(env, w->work); delete w;
}
static napi_value start(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value fn, self;
  napi_get_cb_info(env, info, &count, &fn, &self, nullptr);
  Capture* c = nullptr; napi_unwrap(env, self, reinterpret_cast<void**>(&c));
  napi_valuetype type; if (count != 1 || napi_typeof(env, fn, &type) != napi_ok || type != napi_function) {
    napi_throw_type_error(env, nullptr, "Audio callback required"); return nullptr;
  }
  if (!c || !c->device || c->active || c->starting) return fail(env, "启动状态无效");
  napi_value name; napi_create_string_utf8(env, "CoreAudioTap", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, fn, nullptr, name, 64, 1, nullptr, nullptr, nullptr, deliver, &c->callback) != napi_ok)
    return fail(env, "回调初始化");
  auto* w = new StartWork(); w->capture = c;
  napi_create_reference(env, self, 1, &w->self); napi_create_reference(env, fn, 1, &w->callback);
  // HAL may synchronously wait for TCC approval. Never block Electron's UI thread.
  c->active = true; c->starting = true; ++pendingStarts;
  if (napi_create_async_work(env, nullptr, name, startBackground, startComplete, w, &w->work) != napi_ok ||
      napi_queue_async_work(env, w->work) != napi_ok) {
    c->starting = false; --pendingStarts; c->stop();
    napi_delete_reference(env, w->callback); napi_delete_reference(env, w->self);
    if (w->work) napi_delete_async_work(env, w->work);
    delete w; return fail(env, "后台启动");
  }
  napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value stop(napi_env env, napi_callback_info info) {
  size_t count = 0; Capture* c = unwrap(env, info, &count, nullptr); if (c) c->stop();
  napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value create(napi_env env, napi_callback_info) {
  @autoreleasepool {
    if (@available(macOS 14.2, *)) {
      if (pendingStarts) {
        napi_throw_error(env, "E_COREAUDIO_PENDING", "系统音频仍在等待 macOS 授权，请完成系统授权并退出应用后重试。");
        return nullptr;
      }
      auto* c = new Capture();
      CATapDescription* desc = [[CATapDescription alloc] initStereoGlobalTapButExcludeProcesses:@[]];
      desc.name = @"AI面试助手系统音频"; desc.privateTap = YES; desc.muteBehavior = CATapUnmuted;
      OSStatus status = AudioHardwareCreateProcessTap(desc, &c->tap);
      if (status) { delete c; return fail(env, "创建", status); }
      AudioObjectPropertyAddress address = {kAudioTapPropertyFormat, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
      UInt32 size = sizeof(c->format);
      status = AudioObjectGetPropertyData(c->tap, &address, 0, nullptr, &size, &c->format);
      if (status || c->format.mFormatID != kAudioFormatLinearPCM ||
          !(c->format.mFormatFlags & kAudioFormatFlagIsFloat) || c->format.mBitsPerChannel != 32 ||
          c->format.mChannelsPerFrame < 1 || c->format.mChannelsPerFrame > 32) {
        c->stop(); delete c; return fail(env, "格式检测", status);
      }
      NSDictionary* device = @{
        @kAudioAggregateDeviceNameKey: @"AI面试助手音频输入",
        @kAudioAggregateDeviceUIDKey: NSUUID.UUID.UUIDString,
        @kAudioAggregateDeviceIsPrivateKey: @YES,
        @kAudioAggregateDeviceTapAutoStartKey: @YES,
        @kAudioAggregateDeviceTapListKey: @[@{@kAudioSubTapUIDKey: desc.UUID.UUIDString,
          @kAudioSubTapDriftCompensationKey: @YES}]
      };
      status = AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)device, &c->device);
      if (status) { c->stop(); delete c; return fail(env, "设备初始化", status); }
      napi_value result, value; napi_create_object(env, &result);
      napi_wrap(env, result, c, finalize, nullptr, nullptr);
      napi_add_env_cleanup_hook(env, cleanup, c);
      napi_create_double(env, c->format.mSampleRate, &value); napi_set_named_property(env, result, "sampleRate", value);
      napi_create_uint32(env, c->format.mChannelsPerFrame, &value); napi_set_named_property(env, result, "channels", value);
      napi_create_uint32(env, 32, &value); napi_set_named_property(env, result, "bitsPerSample", value);
      napi_get_boolean(env, true, &value); napi_set_named_property(env, result, "isFloat", value);
      napi_property_descriptor methods[] = {
        {"start", nullptr, start, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"stop", nullptr, stop, nullptr, nullptr, nullptr, napi_default, nullptr}
      };
      napi_define_properties(env, result, 2, methods); return result;
    }
    return fail(env, "需要 macOS 14.2 或更新版本");
  }
}
static napi_value init(napi_env env, napi_value exports) {
  napi_value fn; napi_create_function(env, "createCapture", NAPI_AUTO_LENGTH, create, nullptr, &fn);
  napi_set_named_property(env, exports, "createCapture", fn); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
