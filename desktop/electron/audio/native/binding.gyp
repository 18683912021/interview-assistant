{
  "targets": [
    {
      "target_name": "wasapi_loopback",
      "sources": ["wasapi_loopback.cc"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": ["/std:c++17", "/utf-8"]
        }
      },
      "conditions": [
        ["OS=='win'", {
          "libraries": [
            "-lole32.lib",
            "-lwinmm.lib"
          ]
        }]
      ]
    }
  ]
}
