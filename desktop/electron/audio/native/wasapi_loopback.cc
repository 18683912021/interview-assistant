/**
 * Windows WASAPI render-endpoint loopback. Build with pnpm ensure:native on Windows.
 *
 * No COM audio interfaces cross apartments: the constructor only probes the format;
 * the capture worker opens, starts, reads, stops and releases its own interfaces.
 * Source changes are fatal so the UI can pause and ask the user to select/continue.
 */
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <napi.h>
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <initguid.h>
#include <ks.h>
#include <ksmedia.h>
#include <functiondiscoverykeys_devpkey.h>
#include <wrl/client.h>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <exception>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#pragma comment(lib, "ole32.lib")

using Microsoft::WRL::ComPtr;

namespace {

struct Failure {
  std::string code;
  std::string message;
  explicit operator bool() const { return !message.empty(); }
};

Failure WindowsFailure(const char* operation, HRESULT hr) {
  char hex[16];
  std::snprintf(hex, sizeof(hex), "0x%08lX", static_cast<unsigned long>(hr));
  const bool unavailable = hr == AUDCLNT_E_DEVICE_INVALIDATED ||
    hr == AUDCLNT_E_SERVICE_NOT_RUNNING || hr == AUDCLNT_E_RESOURCES_INVALIDATED ||
    hr == HRESULT_FROM_WIN32(ERROR_NOT_FOUND);
  return {
    unavailable ? "WASAPI_DEVICE_UNAVAILABLE" : "WASAPI_CAPTURE_FAILED",
    std::string(unavailable ? "系统音频设备已不可用，请检查输出设备后继续。" :
      "系统音频采集失败，请检查输出设备后重试。") + " (" + operation + ": " + hex + ")"
  };
}

void ThrowFailure(Napi::Env env, const Failure& failure) {
  auto error = Napi::Error::New(env, failure.message);
  error.Set("code", failure.code);
  error.ThrowAsJavaScriptException();
}

class ComApartment {
public:
  ComApartment() : result(CoInitializeEx(nullptr, COINIT_MULTITHREADED)) {}
  ~ComApartment() {
    // S_FALSE also increments COM's initialization count. Chromium's existing STA
    // returns RPC_E_CHANGED_MODE and must not be uninitialized by this addon.
    if (SUCCEEDED(result)) CoUninitialize();
  }
  HRESULT result;
};

struct CoTaskDeleter {
  void operator()(void* pointer) const { CoTaskMemFree(pointer); }
};
using MixFormat = std::unique_ptr<WAVEFORMATEX, CoTaskDeleter>;

struct Format {
  DWORD rate = 0;
  WORD channels = 0;
  WORD bits = 0;
  WORD blockAlign = 0;
  WORD validBits = 0;
  bool isFloat = false;

  bool operator==(const Format& other) const {
    return rate == other.rate && channels == other.channels && bits == other.bits &&
      blockAlign == other.blockAlign && validBits == other.validBits && isFloat == other.isFloat;
  }
};

Failure ReadFormat(const WAVEFORMATEX* wave, Format& format) {
  if (!wave) return {"WASAPI_UNSUPPORTED_FORMAT", "系统音频设备未提供可用的混音格式。"};
  bool pcm = wave->wFormatTag == WAVE_FORMAT_PCM;
  bool floating = wave->wFormatTag == WAVE_FORMAT_IEEE_FLOAT;
  WORD validBits = wave->wBitsPerSample;
  if (wave->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
    if (wave->cbSize < sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX)) {
      return {"WASAPI_UNSUPPORTED_FORMAT", "系统音频设备返回了不完整的扩展混音格式。"};
    }
    const auto* extended = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(wave);
    pcm = IsEqualGUID(extended->SubFormat, KSDATAFORMAT_SUBTYPE_PCM);
    floating = IsEqualGUID(extended->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
    validBits = extended->Samples.wValidBitsPerSample;
  }
  const bool supportedBits = floating ? wave->wBitsPerSample == 32 :
    pcm && (wave->wBitsPerSample == 16 || wave->wBitsPerSample == 24 || wave->wBitsPerSample == 32);
  if (!supportedBits || !validBits || validBits > wave->wBitsPerSample ||
      (floating && validBits != 32) || wave->nSamplesPerSec < 8000 ||
      wave->nSamplesPerSec > 384000 || !wave->nChannels || wave->nChannels > 32 ||
      wave->nBlockAlign != wave->nChannels * (wave->wBitsPerSample / 8)) {
    return {"WASAPI_UNSUPPORTED_FORMAT",
      "系统音频格式不受支持，请在 Windows 声音设置中选择 16/24/32 位 PCM 或 32 位浮点格式。"};
  }
  format = {wave->nSamplesPerSec, wave->nChannels, wave->wBitsPerSample,
    wave->nBlockAlign, validBits, floating};
  return {};
}

HRESULT DeviceId(IMMDevice* device, std::wstring& result) {
  LPWSTR raw = nullptr;
  const HRESULT hr = device->GetId(&raw);
  std::unique_ptr<wchar_t, CoTaskDeleter> id(raw);
  if (SUCCEEDED(hr) && raw) result.assign(raw);
  return SUCCEEDED(hr) && !raw ? E_POINTER : hr;
}

Napi::String JsWideString(Napi::Env env, const std::wstring& value) {
  return Napi::String::New(env, reinterpret_cast<const char16_t*>(value.data()), value.size());
}

struct Stream {
  ComPtr<IMMDeviceEnumerator> enumerator;
  ComPtr<IMMDevice> device;
  ComPtr<IAudioClient> client;
  ComPtr<IAudioCaptureClient> capture;
  MixFormat wave;
  bool started = false;
  ~Stream() {
    if (started) client->Stop();
    // Explicitly release capture before client, all on the GetService thread.
    capture.Reset();
    client.Reset();
  }
};

Failure OpenStream(const std::wstring& requestedId, Stream& stream,
                   std::wstring& resolvedId, Format& format) {
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
    IID_PPV_ARGS(stream.enumerator.GetAddressOf()));
  if (FAILED(hr)) return WindowsFailure("MMDeviceEnumerator", hr);
  hr = requestedId.empty() ?
    stream.enumerator->GetDefaultAudioEndpoint(eRender, eConsole, stream.device.GetAddressOf()) :
    stream.enumerator->GetDevice(requestedId.c_str(), stream.device.GetAddressOf());
  if (FAILED(hr)) return WindowsFailure("GetAudioEndpoint", hr);

  ComPtr<IMMEndpoint> endpoint;
  hr = stream.device.As(&endpoint);
  if (FAILED(hr)) return WindowsFailure("IMMEndpoint", hr);
  EDataFlow flow;
  hr = endpoint->GetDataFlow(&flow);
  if (FAILED(hr)) return WindowsFailure("GetDataFlow", hr);
  DWORD state = 0;
  hr = stream.device->GetState(&state);
  if (FAILED(hr)) return WindowsFailure("GetState", hr);
  if (flow != eRender || !(state & DEVICE_STATE_ACTIVE)) {
    return {"WASAPI_DEVICE_UNAVAILABLE", "所选系统音频输出设备不可用，请重新选择扬声器或耳机。"};
  }
  hr = DeviceId(stream.device.Get(), resolvedId);
  if (FAILED(hr)) return WindowsFailure("GetId", hr);
  hr = stream.device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
    reinterpret_cast<void**>(stream.client.GetAddressOf()));
  if (FAILED(hr)) return WindowsFailure("Activate IAudioClient", hr);
  WAVEFORMATEX* wave = nullptr;
  hr = stream.client->GetMixFormat(&wave);
  stream.wave.reset(wave);
  if (FAILED(hr)) return WindowsFailure("GetMixFormat", hr);
  return ReadFormat(stream.wave.get(), format);
}

Napi::Value EnumerateDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ComApartment com;
  if (FAILED(com.result) && com.result != RPC_E_CHANGED_MODE) {
    ThrowFailure(env, WindowsFailure("CoInitializeEx", com.result));
    return env.Undefined();
  }
  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
    IID_PPV_ARGS(enumerator.GetAddressOf()));
  if (FAILED(hr)) {
    ThrowFailure(env, WindowsFailure("MMDeviceEnumerator", hr));
    return env.Undefined();
  }
  std::wstring defaultId;
  ComPtr<IMMDevice> defaultDevice;
  if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, defaultDevice.GetAddressOf()))) {
    DeviceId(defaultDevice.Get(), defaultId);
  }
  ComPtr<IMMDeviceCollection> collection;
  hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, collection.GetAddressOf());
  if (FAILED(hr)) {
    ThrowFailure(env, WindowsFailure("EnumAudioEndpoints", hr));
    return env.Undefined();
  }
  UINT count = 0;
  hr = collection->GetCount(&count);
  if (FAILED(hr)) {
    ThrowFailure(env, WindowsFailure("GetCount", hr));
    return env.Undefined();
  }
  auto result = Napi::Array::New(env);
  uint32_t index = 0;
  for (UINT i = 0; i < count; ++i) {
    ComPtr<IMMDevice> device;
    std::wstring id;
    if (FAILED(collection->Item(i, device.GetAddressOf())) || FAILED(DeviceId(device.Get(), id))) continue;
    std::wstring name = id;
    ComPtr<IPropertyStore> properties;
    if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, properties.GetAddressOf()))) {
      PROPVARIANT value;
      PropVariantInit(&value);
      if (SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName, &value)) &&
          value.vt == VT_LPWSTR && value.pwszVal) name = value.pwszVal;
      PropVariantClear(&value);
    }
    auto item = Napi::Object::New(env);
    item.Set("id", JsWideString(env, id));
    item.Set("name", JsWideString(env, name));
    item.Set("isDefault", id == defaultId);
    result.Set(index++, item);
  }
  return result;
}

// Bound memory ourselves, leaving one guaranteed TSFN slot for a fatal error.
// A full JS queue stops capture rather than silently losing speech/timestamps.
struct Delivery {
  std::atomic<bool> active{true};
  std::atomic<size_t> pending{0};
};

} // namespace

class WasapiLoopback : public Napi::ObjectWrap<WasapiLoopback> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  explicit WasapiLoopback(const Napi::CallbackInfo& info);
  ~WasapiLoopback() override;

private:
  Napi::Value Start(const Napi::CallbackInfo& info);
  Napi::Value Stop(const Napi::CallbackInfo& info);
  Napi::Value GetSampleRate(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), _format.rate);
  }
  Napi::Value GetChannels(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), _format.channels);
  }
  Napi::Value GetBitsPerSample(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), _format.bits);
  }
  Napi::Value GetIsFloat(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), _format.isFloat);
  }
  void Shutdown();
  void CaptureWorker();
  void SignalStart(Failure failure);
  Failure CheckDevice(Stream& stream);
  bool Deliver(std::vector<uint8_t>&& pcm);
  void DeliverFailure(const Failure& failure);
  static void CleanupEnvironment(void* data);

  std::wstring _requestedId;
  std::wstring _resolvedId;
  Format _format;
  std::thread _worker;
  std::atomic<bool> _stopRequested{false};
  std::atomic<bool> _running{false};
  std::mutex _startMutex;
  std::condition_variable _startCondition;
  bool _startDone = false;
  Failure _startFailure;
  Napi::ThreadSafeFunction _tsfn;
  bool _tsfnCreated = false;
  std::shared_ptr<Delivery> _delivery;
  napi_env _env;
  bool _cleanupRegistered = false;
};

Napi::Object WasapiLoopback::Init(Napi::Env env, Napi::Object exports) {
  exports.Set("WasapiLoopback", DefineClass(env, "WasapiLoopback", {
    InstanceMethod("start", &WasapiLoopback::Start),
    InstanceMethod("stop", &WasapiLoopback::Stop),
    InstanceAccessor("sampleRate", &WasapiLoopback::GetSampleRate, nullptr),
    InstanceAccessor("channels", &WasapiLoopback::GetChannels, nullptr),
    InstanceAccessor("bitsPerSample", &WasapiLoopback::GetBitsPerSample, nullptr),
    InstanceAccessor("isFloat", &WasapiLoopback::GetIsFloat, nullptr),
  }));
  exports.Set("enumerateDevices", Napi::Function::New(env, EnumerateDevices));
  return exports;
}

WasapiLoopback::WasapiLoopback(const Napi::CallbackInfo& info)
  : Napi::ObjectWrap<WasapiLoopback>(info), _env(info.Env()) {
  if (info.Length() > 0 && !info[0].IsUndefined() && !info[0].IsString()) {
    Napi::TypeError::New(info.Env(), "deviceId must be a string").ThrowAsJavaScriptException();
    return;
  }
  if (info.Length() && info[0].IsString()) {
    const auto id = info[0].As<Napi::String>().Utf16Value();
    _requestedId.assign(id.begin(), id.end());
    if (_requestedId.find(L'\0') != std::wstring::npos) {
      Napi::TypeError::New(info.Env(), "deviceId must not contain null characters").ThrowAsJavaScriptException();
      return;
    }
  }
  ComApartment com;
  if (FAILED(com.result) && com.result != RPC_E_CHANGED_MODE) {
    ThrowFailure(info.Env(), WindowsFailure("CoInitializeEx", com.result));
    return;
  }
  Stream probe;
  if (const auto failure = OpenStream(_requestedId, probe, _resolvedId, _format)) {
    ThrowFailure(info.Env(), failure);
    return;
  }
  if (napi_add_env_cleanup_hook(_env, CleanupEnvironment, this) != napi_ok) {
    ThrowFailure(info.Env(), {"WASAPI_CAPTURE_FAILED", "无法注册系统音频退出清理。"});
    return;
  }
  _cleanupRegistered = true;
}

WasapiLoopback::~WasapiLoopback() {
  Shutdown();
  if (_cleanupRegistered) napi_remove_env_cleanup_hook(_env, CleanupEnvironment, this);
}

void WasapiLoopback::CleanupEnvironment(void* data) {
  auto* self = static_cast<WasapiLoopback*>(data);
  self->_cleanupRegistered = false;
  self->Shutdown();
}

void WasapiLoopback::Shutdown() {
  _stopRequested = true;
  if (_delivery) _delivery->active = false;
  // GetNextPacketSize/GetBuffer are non-blocking; no JS call is awaited by the worker.
  // Only the worker calls IAudioClient::Stop, then releases its COM resources.
  if (_worker.joinable()) _worker.join();
  if (_tsfnCreated) {
    _tsfnCreated = false;
    _tsfn.Abort();
  }
  _running = false;
  _delivery.reset();
}

Napi::Value WasapiLoopback::Start(const Napi::CallbackInfo& info) {
  auto env = info.Env();
  if (_running) return Napi::Boolean::New(env, false);
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Expected callback function").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Shutdown();
  _delivery = std::make_shared<Delivery>();
  _tsfn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "WASAPI Callback", 0, 1);
  if (env.IsExceptionPending() || !_tsfn) return env.Undefined();
  _tsfnCreated = true;
  // Re-register after TSFN creation so our hook joins the producer before Node
  // tears down newer asynchronous resources (cleanup hooks run in reverse order).
  if (_cleanupRegistered) napi_remove_env_cleanup_hook(_env, CleanupEnvironment, this);
  _cleanupRegistered = napi_add_env_cleanup_hook(_env, CleanupEnvironment, this) == napi_ok;
  if (!_cleanupRegistered) {
    Shutdown();
    ThrowFailure(env, {"WASAPI_CAPTURE_FAILED", "无法注册系统音频退出清理。"});
    return env.Undefined();
  }
  _stopRequested = false;
  _startDone = false;
  _startFailure = {};
  try {
    _worker = std::thread(&WasapiLoopback::CaptureWorker, this);
  } catch (const std::exception& exception) {
    Shutdown();
    ThrowFailure(env, {"WASAPI_CAPTURE_FAILED", std::string("无法启动系统音频线程：") + exception.what()});
    return env.Undefined();
  }
  {
    std::unique_lock<std::mutex> lock(_startMutex);
    _startCondition.wait(lock, [this] { return _startDone; });
  }
  if (_startFailure) {
    Shutdown();
    ThrowFailure(env, _startFailure);
    return env.Undefined();
  }
  return Napi::Boolean::New(env, true);
}

Napi::Value WasapiLoopback::Stop(const Napi::CallbackInfo& info) {
  Shutdown();
  return Napi::Boolean::New(info.Env(), true);
}

void WasapiLoopback::SignalStart(Failure failure) {
  {
    std::lock_guard<std::mutex> lock(_startMutex);
    _startFailure = std::move(failure);
    _startDone = true;
  }
  _startCondition.notify_one();
}

Failure WasapiLoopback::CheckDevice(Stream& stream) {
  DWORD state = 0;
  HRESULT hr = stream.device->GetState(&state);
  if (FAILED(hr)) return WindowsFailure("GetState", hr);
  if (!(state & DEVICE_STATE_ACTIVE)) {
    return {"WASAPI_DEVICE_UNAVAILABLE", "系统音频输出设备已断开或被禁用，请重新选择后继续。"};
  }
  if (_requestedId.empty()) {
    ComPtr<IMMDevice> current;
    hr = stream.enumerator->GetDefaultAudioEndpoint(eRender, eConsole, current.GetAddressOf());
    if (FAILED(hr)) return WindowsFailure("GetDefaultAudioEndpoint", hr);
    std::wstring id;
    hr = DeviceId(current.Get(), id);
    if (FAILED(hr)) return WindowsFailure("GetId", hr);
    if (id != _resolvedId) {
      return {"WASAPI_DEFAULT_DEVICE_CHANGED", "Windows 默认输出设备已切换，采集已暂停。确认输出设备后继续。"};
    }
  }
  return {};
}

void WasapiLoopback::DeliverFailure(const Failure& failure) {
  const auto delivery = _delivery;
  _tsfn.NonBlockingCall([delivery, failure](Napi::Env env, Napi::Function callback) {
    if (!env || callback.IsEmpty() || !delivery->active) return;
    auto error = Napi::Error::New(env, failure.message);
    error.Set("code", failure.code);
    callback.Call({error.Value(), env.Null()});
  });
}

bool WasapiLoopback::Deliver(std::vector<uint8_t>&& pcm) {
  const auto delivery = _delivery;
  if (delivery->pending.fetch_add(1) >= 128) {
    delivery->pending.fetch_sub(1);
    DeliverFailure({"WASAPI_QUEUE_OVERFLOW", "系统音频处理积压，采集已暂停，请稍后继续。"});
    return false;
  }
  const auto status = _tsfn.NonBlockingCall(
    [delivery, pcm = std::move(pcm)](Napi::Env env, Napi::Function callback) {
      delivery->pending.fetch_sub(1);
      if (!env || callback.IsEmpty() || !delivery->active) return;
      auto buffer = Napi::Buffer<uint8_t>::Copy(env, pcm.data(), pcm.size());
      if (!env.IsExceptionPending()) callback.Call({env.Null(), buffer});
    });
  if (status != napi_ok) delivery->pending.fetch_sub(1);
  return status == napi_ok;
}

void WasapiLoopback::CaptureWorker() {
  bool signalled = false;
  try {
    ComApartment com;
    Stream stream;
    Failure failure;
    if (FAILED(com.result)) failure = WindowsFailure("CoInitializeEx worker", com.result);
    Format currentFormat;
    std::wstring currentId;
    if (!failure) failure = OpenStream(_resolvedId, stream, currentId, currentFormat);
    if (!failure && !(currentFormat == _format)) {
      failure = {"WASAPI_FORMAT_CHANGED", "系统音频格式已变化，请重新开始采集。"};
    }
    if (!failure) failure = CheckDevice(stream);
    if (!failure) {
      HRESULT hr = stream.client->Initialize(AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK, 1000000, 0, stream.wave.get(), nullptr); // 100 ms
      if (FAILED(hr)) failure = WindowsFailure("IAudioClient::Initialize", hr);
    }
    if (!failure) {
      HRESULT hr = stream.client->GetService(__uuidof(IAudioCaptureClient),
        reinterpret_cast<void**>(stream.capture.GetAddressOf()));
      if (FAILED(hr)) failure = WindowsFailure("GetService IAudioCaptureClient", hr);
    }
    if (!failure) {
      HRESULT hr = stream.client->Start();
      if (FAILED(hr)) failure = WindowsFailure("IAudioClient::Start", hr);
      else stream.started = true;
    }
    _running = !failure;
    SignalStart(failure);
    signalled = true;
    if (failure) return;

    auto nextDeviceCheck = std::chrono::steady_clock::now();
    while (!_stopRequested && !failure) {
      if (std::chrono::steady_clock::now() >= nextDeviceCheck) {
        failure = CheckDevice(stream);
        nextDeviceCheck = std::chrono::steady_clock::now() + std::chrono::milliseconds(200);
        if (failure) break;
      }
      UINT32 packetFrames = 0;
      HRESULT hr = stream.capture->GetNextPacketSize(&packetFrames);
      if (FAILED(hr)) { failure = WindowsFailure("GetNextPacketSize", hr); break; }
      if (!packetFrames) { Sleep(10); continue; }
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      hr = stream.capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (FAILED(hr)) { failure = WindowsFailure("GetBuffer", hr); break; }
      if (hr == AUDCLNT_S_BUFFER_EMPTY) { Sleep(1); continue; }
      if (!frames) {
        // The documented empty-packet status owns no buffer. A successful
        // zero-length packet is also legal to release; avoid holding it/spinning.
        hr = stream.capture->ReleaseBuffer(0);
        if (FAILED(hr)) failure = WindowsFailure("ReleaseBuffer empty", hr);
        Sleep(1);
        continue;
      }
      // SILENT packets may have a null data pointer. Forward zeros of equal length
      // so ASR sees the actual pause and can finalize the previous utterance.
      const size_t bytes = static_cast<size_t>(frames) * _format.blockAlign;
      std::vector<uint8_t> pcm(bytes, 0);
      if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT)) {
        if (data) std::memcpy(pcm.data(), data, bytes);
        else failure = {"WASAPI_CAPTURE_FAILED", "系统音频设备返回了无效的音频包。"};
      }
      hr = stream.capture->ReleaseBuffer(frames);
      if (FAILED(hr)) failure = WindowsFailure("ReleaseBuffer", hr);
      if (!failure && !_stopRequested && !Deliver(std::move(pcm))) break;
    }
    if (failure && !_stopRequested) DeliverFailure(failure);
  } catch (const std::exception& exception) {
    const Failure failure{"WASAPI_CAPTURE_FAILED", std::string("系统音频采集异常：") + exception.what()};
    if (!signalled) SignalStart(failure);
    else if (!_stopRequested) DeliverFailure(failure);
  }
  _running = false;
}

Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
  return WasapiLoopback::Init(env, exports);
}

NODE_API_MODULE(wasapi_loopback, InitModule)
