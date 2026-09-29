{
  "targets": [
    {
      "target_name": "tela_native",
      "sources": ["src/addon.cpp"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "_WIN32_WINNT=0x0A00"],
      "msvs_settings": {
        "VCCLCompilerTool": { "ExceptionHandling": 1 }
      },
      "libraries": ["Mmdevapi.lib", "ole32.lib", "Propsys.lib", "runtimeobject.lib"]
    }
  ]
}
