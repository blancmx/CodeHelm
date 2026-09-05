#include <node_api.h>
#include <windows.h>
#include <string>
#include <vector>
#include <unordered_map>
#include <memory>
#include <mutex>
#include <atomic>
#include <stdexcept>
#include <cwctype>

namespace {
struct HandleCloser { void operator()(void* value) const { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); } };
using UniqueHandle = std::unique_ptr<void, HandleCloser>;
struct FindCloser { void operator()(void* value) const { if (value && value != INVALID_HANDLE_VALUE) FindClose(value); } };
using UniqueFind = std::unique_ptr<void, FindCloser>;
struct Session {
  std::wstring root;
  std::unordered_map<std::wstring, UniqueHandle> directories;
  std::unordered_map<std::wstring, UniqueHandle> files;
  std::mutex mutex;
};
std::mutex registryMutex;
std::unordered_map<std::string, std::shared_ptr<Session>> registry;
std::atomic<unsigned long long> nextId{1};

std::runtime_error WinError(const char* message) {
  return std::runtime_error(std::string(message) + " (Win32 " + std::to_string(GetLastError()) + ")");
}
void Check(napi_env env, napi_status status, const char* message) {
  if (status != napi_ok) { napi_throw_error(env, nullptr, message); throw std::runtime_error(message); }
}
std::wstring StringArg(napi_env env, napi_value value) {
  size_t length = 0; Check(env, napi_get_value_string_utf16(env, value, nullptr, 0, &length), "Expected string");
  std::wstring output(length + 1, L'\0'); Check(env, napi_get_value_string_utf16(env, value, reinterpret_cast<char16_t*>(output.data()), output.size(), &length), "Invalid string");
  output.resize(length);
  return output;
}
std::string Utf8Arg(napi_env env, napi_value value) {
  size_t length = 0; Check(env, napi_get_value_string_utf8(env, value, nullptr, 0, &length), "Expected string");
  std::string output(length + 1, '\0'); Check(env, napi_get_value_string_utf8(env, value, output.data(), output.size(), &length), "Invalid string");
  output.resize(length);
  return output;
}
uint32_t UintArg(napi_env env, napi_value value) { uint32_t out; Check(env, napi_get_value_uint32(env, value, &out), "Expected integer"); return out; }
napi_value Utf8Value(napi_env env, const std::string& text) { napi_value value; Check(env, napi_create_string_utf8(env, text.data(), text.size(), &value), "Cannot create string"); return value; }
napi_value BoolValue(napi_env env, bool input) { napi_value value; Check(env, napi_get_boolean(env, input, &value), "Cannot create boolean"); return value; }

std::wstring FinalPath(HANDLE handle) {
  DWORD length = GetFinalPathNameByHandleW(handle, nullptr, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (!length) throw WinError("Cannot resolve opened path");
  std::wstring path(length, L'\0');
  DWORD written = GetFinalPathNameByHandleW(handle, path.data(), length, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  if (!written || written >= length) throw WinError("Cannot resolve opened path");
  path.resize(written);
  while (path.size() > 4 && (path.back() == L'\\' || path.back() == L'/')) path.pop_back();
  return path;
}
FILE_ATTRIBUTE_TAG_INFO Tag(HANDLE handle) {
  FILE_ATTRIBUTE_TAG_INFO info{};
  if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &info, sizeof(info))) throw WinError("Cannot inspect opened path");
  return info;
}
UniqueHandle OpenDirectory(const std::wstring& path) {
  HANDLE raw = CreateFileW(path.c_str(), FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES,
    FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (raw == INVALID_HANDLE_VALUE) throw WinError("Cannot lock project directory");
  UniqueHandle handle(raw);
  const auto tag = Tag(raw);
  if (!(tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) || (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT))
    throw std::runtime_error("Project path contains a directory reparse point");
  return handle;
}
UniqueHandle OpenRegularFile(const std::wstring& path) {
  HANDLE raw = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
    FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
  if (raw == INVALID_HANDLE_VALUE) throw WinError("Cannot lock project file");
  UniqueHandle handle(raw);
  const auto tag = Tag(raw);
  if ((tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) || (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT))
    throw std::runtime_error("Project file is not a regular non-reparse file");
  BY_HANDLE_FILE_INFORMATION identity{};
  if (!GetFileInformationByHandle(raw, &identity)) throw WinError("Cannot inspect project file identity");
  if (identity.nNumberOfLinks != 1) throw std::runtime_error("Project file has multiple hard links");
  return handle;
}
bool IgnoredDirectory(const std::wstring& value) {
  std::wstring name=value;for(auto& ch:name)ch=static_cast<wchar_t>(std::towlower(ch));
  static const wchar_t* ignored[]={L".git",L"node_modules",L".venv",L"venv",L"site-packages",L"dist",L"build",L"out",L"target",L".next",L".nuxt",L".turbo",L"coverage",L".cache",L".pytest_cache",L"__pycache__",L"bin",L"obj",L"vendor",L".vscode",L".idea",L"env",L".output",L"temp",L"tmp"};
  for(const auto* item:ignored)if(name==item)return true;return false;
}
void ValidateName(const std::wstring& name) {
  if (name.empty() || name == L"." || name == L".." || name.find_first_of(L"\\/:\0") != std::wstring::npos)
    throw std::runtime_error("Invalid relative path component");
}
bool MissingPathError(DWORD error) {
  return error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND;
}
void LockPythonVirtualEnvironment(const std::shared_ptr<Session>& session, const std::wstring& relative, uint32_t maxEntries) {
  const auto lockDirectory = [&](const std::wstring& child) -> bool {
    const std::wstring absolute = session->root + L"\\" + child;
    const DWORD attributes = GetFileAttributesW(absolute.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES) {
      const DWORD error = GetLastError(); if (MissingPathError(error)) return false; throw WinError("Cannot inspect Python virtual environment");
    }
    if (!(attributes & FILE_ATTRIBUTE_DIRECTORY) || (attributes & FILE_ATTRIBUTE_REPARSE_POINT))
      throw std::runtime_error("Python virtual environment path is not a regular directory");
    if (session->directories.size() >= maxEntries) throw std::runtime_error("Project directory count exceeds security lock limit");
    session->directories.emplace(child, OpenDirectory(absolute));
    return true;
  };
  const auto lockExecutable = [&](const std::wstring& child) {
    const std::wstring absolute = session->root + L"\\" + child;
    const DWORD attributes = GetFileAttributesW(absolute.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES) {
      const DWORD error = GetLastError(); if (MissingPathError(error)) return; throw WinError("Cannot inspect Python virtual environment executable");
    }
    if ((attributes & FILE_ATTRIBUTE_DIRECTORY) || (attributes & FILE_ATTRIBUTE_REPARSE_POINT))
      throw std::runtime_error("Python virtual environment executable is not a regular file");
    if (session->files.size() >= maxEntries) throw std::runtime_error("Project file count exceeds security lock limit");
    session->files.emplace(child, OpenRegularFile(absolute));
  };

  if (!lockDirectory(relative)) return;
  const std::wstring scripts = relative + L"\\Scripts";
  if (lockDirectory(scripts)) lockExecutable(scripts + L"\\python.exe");
  const std::wstring bin = relative + L"\\bin";
  if (lockDirectory(bin)) lockExecutable(bin + L"\\python");
}
void LockTree(const std::shared_ptr<Session>& session, const std::wstring& relative, uint32_t maxEntries) {
  const std::wstring absolute = relative.empty() ? session->root : session->root + L"\\" + relative;
  WIN32_FIND_DATAW entry{};
  HANDLE rawFind = FindFirstFileExW((absolute + L"\\*").c_str(), FindExInfoBasic, &entry, FindExSearchNameMatch, nullptr, FIND_FIRST_EX_LARGE_FETCH);
  if (rawFind == INVALID_HANDLE_VALUE) {
    if (GetLastError() == ERROR_FILE_NOT_FOUND) return;
    throw WinError("Cannot enumerate project directory");
  }
  UniqueFind find(rawFind);
  do {
    std::wstring name(entry.cFileName); if (name == L"." || name == L"..") continue;
    if (entry.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) continue;
    ValidateName(name);
    std::wstring child = relative.empty() ? name : relative + L"\\" + name;
    if ((entry.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && IgnoredDirectory(name)) {
      std::wstring lowerName=name;for(auto& ch:lowerName)ch=static_cast<wchar_t>(std::towlower(ch));
      if (lowerName == L".venv" || lowerName == L"venv") LockPythonVirtualEnvironment(session, child, maxEntries);
      continue;
    }
    if (entry.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      if (session->directories.size() >= maxEntries) throw std::runtime_error("Project directory count exceeds security lock limit");
      auto handle = OpenDirectory(session->root + L"\\" + child);
      std::wstring finalPath = FinalPath(static_cast<HANDLE>(handle.get()));
      std::wstring expectedPrefix = session->root + L"\\";
      if (_wcsnicmp(finalPath.c_str(), expectedPrefix.c_str(), expectedPrefix.size()) != 0) throw std::runtime_error("Project directory escaped locked root");
      session->directories.emplace(child, std::move(handle));
      LockTree(session, child, maxEntries);
    } else {
      if (session->files.size() >= maxEntries) throw std::runtime_error("Project file count exceeds security lock limit");
      session->files.emplace(child, OpenRegularFile(session->root + L"\\" + child));
    }
  } while (FindNextFileW(rawFind, &entry));
  if (GetLastError() != ERROR_NO_MORE_FILES) throw WinError("Cannot enumerate project directory");
}
std::vector<std::wstring> RelativeParts(const std::wstring& relative) {
  if (relative.empty() || relative.front() == L'\\' || relative.front() == L'/' || (relative.size() > 1 && relative[1] == L':')) throw std::runtime_error("Invalid relative file path");
  std::vector<std::wstring> parts; std::wstring current;
  for (wchar_t value : relative) {
    if (value == L'\\' || value == L'/') { ValidateName(current); parts.push_back(current); current.clear(); }
    else current.push_back(value);
  }
  ValidateName(current); parts.push_back(current); return parts;
}
std::shared_ptr<Session> GetSession(const std::string& id) {
  std::lock_guard<std::mutex> lock(registryMutex); auto found = registry.find(id);
  if (found == registry.end()) throw std::runtime_error("Safe project root session is closed or unknown"); return found->second;
}
void Throw(napi_env env, const std::exception& error) { napi_throw_error(env, "CODEHELM_PATH_BOUNDARY", error.what()); }

napi_value OpenRoot(napi_env env, napi_callback_info info) {
  try {
    size_t argc = 2; napi_value argv[2]; Check(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "Invalid arguments"); if (argc != 2) throw std::runtime_error("openRoot requires rootPath and maxDirectories");
    std::wstring input = StringArg(env, argv[0]); uint32_t maxDirectories = UintArg(env, argv[1]); if (!maxDirectories) throw std::runtime_error("Invalid directory lock limit");
    auto rootHandle = OpenDirectory(input); auto session = std::make_shared<Session>(); session->root = FinalPath(static_cast<HANDLE>(rootHandle.get()));
    session->directories.emplace(L"", std::move(rootHandle)); LockTree(session, L"", maxDirectories);
    std::string id = std::to_string(GetCurrentProcessId()) + "-" + std::to_string(nextId.fetch_add(1));
    { std::lock_guard<std::mutex> lock(registryMutex); registry.emplace(id, session); }
    return Utf8Value(env, id);
  } catch (const std::exception& error) { Throw(env, error); return nullptr; }
}
napi_value CloseRoot(napi_env env, napi_callback_info info) {
  try { size_t argc=1; napi_value argv[1]; Check(env,napi_get_cb_info(env,info,&argc,argv,nullptr,nullptr),"Invalid arguments"); if(argc!=1)throw std::runtime_error("closeRoot requires sessionId");
    std::string id=Utf8Arg(env,argv[0]); std::lock_guard<std::mutex> lock(registryMutex); registry.erase(id); napi_value out; napi_get_undefined(env,&out); return out;
  } catch(const std::exception& error){Throw(env,error);return nullptr;}
}
napi_value ReadFile(napi_env env, napi_callback_info info) {
  try {
    size_t argc=3; napi_value argv[3]; Check(env,napi_get_cb_info(env,info,&argc,argv,nullptr,nullptr),"Invalid arguments"); if(argc!=3)throw std::runtime_error("readFile requires sessionId, relativePath and maxBytes");
    auto session=GetSession(Utf8Arg(env,argv[0])); auto parts=RelativeParts(StringArg(env,argv[1])); uint32_t maxBytes=UintArg(env,argv[2]); if(!maxBytes)throw std::runtime_error("Invalid file byte limit");
    std::lock_guard<std::mutex> lock(session->mutex); std::wstring parent;
    for(size_t i=0;i+1<parts.size();++i){ parent=parent.empty()?parts[i]:parent+L"\\"+parts[i]; if(!session->directories.count(parent))throw std::runtime_error("Project directory appeared after task root was locked"); }
    std::wstring relative;for(size_t i=0;i<parts.size();++i)relative+= (i?L"\\":L"")+parts[i];
    auto found=session->files.find(relative);if(found==session->files.end())throw std::runtime_error("Project file was not present when task root was locked");HANDLE raw=static_cast<HANDLE>(found->second.get());
    LARGE_INTEGER beginning{};if(!SetFilePointerEx(raw,beginning,nullptr,FILE_BEGIN))throw WinError("Cannot rewind project file");
    LARGE_INTEGER size{};if(!GetFileSizeEx(raw,&size))throw WinError("Cannot size project file");if(size.QuadPart<0||static_cast<unsigned long long>(size.QuadPart)>maxBytes)throw std::runtime_error("Analyzer file exceeds the byte limit");
    std::vector<unsigned char> bytes(static_cast<size_t>(size.QuadPart)); DWORD total=0;
    while(total<bytes.size()){DWORD chunk=0;if(!::ReadFile(raw,bytes.data()+total,static_cast<DWORD>(bytes.size()-total),&chunk,nullptr))throw WinError("Cannot read project file");if(!chunk)break;total+=chunk;}
    void* copy=nullptr;napi_value buffer;Check(env,napi_create_buffer_copy(env,total,bytes.data(),&copy,&buffer),"Cannot create read buffer");return buffer;
  }catch(const std::exception& error){Throw(env,error);return nullptr;}
}
napi_value FileExists(napi_env env, napi_callback_info info) {
  try {
    size_t argc=2; napi_value argv[2]; Check(env,napi_get_cb_info(env,info,&argc,argv,nullptr,nullptr),"Invalid arguments"); if(argc!=2)throw std::runtime_error("fileExists requires sessionId and relativePath");
    auto session=GetSession(Utf8Arg(env,argv[0])); auto parts=RelativeParts(StringArg(env,argv[1]));
    std::lock_guard<std::mutex> lock(session->mutex); std::wstring parent;
    for(size_t i=0;i+1<parts.size();++i){ parent=parent.empty()?parts[i]:parent+L"\\"+parts[i]; if(!session->directories.count(parent))throw std::runtime_error("Project directory appeared after task root was locked"); }
    std::wstring relative;for(size_t i=0;i<parts.size();++i)relative+=(i?L"\\":L"")+parts[i];return BoolValue(env,session->files.count(relative)>0);
  }catch(const std::exception& error){Throw(env,error);return nullptr;}
}
napi_value Init(napi_env env,napi_value exports){
  napi_property_descriptor properties[]={
    {"openRoot",nullptr,OpenRoot,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"closeRoot",nullptr,CloseRoot,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"readFile",nullptr,ReadFile,nullptr,nullptr,nullptr,napi_default,nullptr},
    {"fileExists",nullptr,FileExists,nullptr,nullptr,nullptr,napi_default,nullptr},
  };Check(env,napi_define_properties(env,exports,4,properties),"Cannot expose safe fs");return exports;
}
} NAPI_MODULE(NODE_GYP_MODULE_NAME,Init)
