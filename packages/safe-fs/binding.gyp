{
  "targets": [{
    "target_name": "codehelm_safe_fs",
    "sources": ["src/addon.cc"],
    "defines": ["UNICODE", "_UNICODE", "NOMINMAX"],
    "msvs_settings": { "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17"] } }
  }]
}
