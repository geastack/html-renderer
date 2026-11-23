#include "html_host.h"
#include "ui/style.h"
#include "ui/tree_internal.h"
#include "ui/document.h"

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <stdexcept>
#include <string_view>

namespace fs = std::filesystem;
using gea::embedded::ui::StyleSheet;

#if defined(__linux__)
#include "platform/prerender_fonts.h"
#elif defined(_WIN32)
extern "C" void gea_windows_begin_runtime_fonts();
extern "C" void gea_windows_commit_runtime_fonts();
extern "C" bool gea_windows_register_runtime_font(const char *, const char *);
#elif defined(__APPLE__)
extern "C" void gea_macos_begin_runtime_fonts();
extern "C" void gea_macos_commit_runtime_fonts();
extern "C" bool gea_macos_register_runtime_font(const char *, const char *);
#else
#error "The HTML renderer needs a native runtime font provider"
#endif

static fs::path pathFromUtf8(std::string_view value)
{
    return fs::path(std::u8string(value.begin(), value.end()));
}

static std::string utf8Path(const fs::path &path)
{
    const auto value = path.generic_u8string();
    return std::string(value.begin(), value.end());
}

void htmlFail(const std::string &message)
{
    throw std::runtime_error("HTML render: " + message);
}

std::string htmlInput()
{
    const char *input = std::getenv("GEA_PRERENDER_INPUT");
    if (!input) input = std::getenv("GEA_HTML_INPUT");
    if (!input || !*input) htmlFail("No input path");
    return utf8Path(fs::absolute(pathFromUtf8(input)).lexically_normal());
}

std::string htmlRead(const std::string &path)
{
    constexpr std::uintmax_t limit = 4 * 1024 * 1024;
    std::error_code error;
    const auto file = pathFromUtf8(path);
    const auto size = fs::file_size(file, error);
    if (error || size > limit) htmlFail("Cannot read file: " + path);
    std::ifstream stream(file, std::ios::binary);
    std::string contents(size, '\0');
    if (!stream || !stream.read(contents.data(), contents.size())) {
        htmlFail("Cannot read file: " + path);
    }
    return contents;
}

std::string htmlResolve(const std::string &source, const std::string &relative)
{
    if (relative.empty() || relative.find(':') != std::string::npos ||
        relative.rfind("//", 0) == 0 || pathFromUtf8(relative).has_root_path()) {
        htmlFail("Expected a relative local asset path: " + relative);
    }
    return utf8Path((pathFromUtf8(source).parent_path() / pathFromUtf8(relative)).lexically_normal());
}

static bool simpleName(const std::string &text, std::size_t start)
{
    if (start >= text.size()) return false;
    for (auto i = start; i < text.size(); ++i) {
        const unsigned char c = text[i];
        if (!std::isalnum(c) && c != '-' && c != '_') return false;
    }
    return true;
}

void htmlRule(const std::string &selector, const std::string &property, const std::string &value)
{
    auto &sheet = StyleSheet::instance();
    if (simpleName(selector, 0)) sheet.registerElementRule(selector, property, value);
    else if (selector.front() == '.' && simpleName(selector, 1)) sheet.registerRule(selector.substr(1), property, value);
    else sheet.registerSelectorRule(selector, property, value);
}

void htmlBeginRules()
{
#if defined(__linux__)
    gea::platform::prerender::beginRuntimeFonts();
#elif defined(_WIN32)
    gea_windows_begin_runtime_fonts();
#else
    gea_macos_begin_runtime_fonts();
#endif
    auto &sheet = StyleSheet::instance();
    sheet.clear();
    sheet.beginRuleRegistrationBatch();
}

void htmlEndRules()
{
#ifdef _WIN32
    gea_windows_commit_runtime_fonts();
#elif defined(__APPLE__)
    gea_macos_commit_runtime_fonts();
#endif
    StyleSheet::instance().endRuleRegistrationBatch();
}

void htmlFont(const std::string &family, const std::string &path)
{
#if defined(__linux__)
    const bool loaded = gea::platform::prerender::registerRuntimeFont(path.c_str(), family.c_str());
#elif defined(_WIN32)
    const bool loaded = gea_windows_register_runtime_font(path.c_str(), family.c_str());
#else
    const bool loaded = gea_macos_register_runtime_font(path.c_str(), family.c_str());
#endif
    if (!loaded) {
        htmlFail("Cannot load font " + family + " from " + path);
    }
}

void htmlMarkText(gea::embedded::ui::NodeHandle node)
{
    gea::embedded::ui::Tree::instance().setTagName(node.id(), "#text");
}

void htmlMount(gea::embedded::ui::NodeHandle root)
{
    using gea::embedded::ui::Document;
    Document::instance().mount(root, Document::preferredMountWidth(), Document::preferredMountHeight());
}

void htmlInline(gea::embedded::ui::NodeHandle element, const std::string &property, const std::string &value)
{
    element.style().setProperty(property, value);
}
