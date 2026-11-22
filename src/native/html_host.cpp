#include "html_host.h"
#include "ui/style.h"
#include "ui/document.h"

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <stdexcept>

namespace fs = std::filesystem;
using gea::embedded::ui::StyleSheet;

extern "C" void gea_macos_begin_runtime_fonts();
extern "C" void gea_macos_commit_runtime_fonts();
extern "C" bool gea_macos_register_runtime_font(const char *, const char *);

void htmlFail(const std::string &message)
{
    throw std::runtime_error("HTML render: " + message);
}

std::string htmlInput()
{
    const char *input = std::getenv("GEA_PRERENDER_INPUT");
    if (!input) input = std::getenv("GEA_HTML_INPUT");
    if (!input || !*input) htmlFail("No input path");
    return fs::absolute(input).lexically_normal().string();
}

std::string htmlRead(const std::string &path)
{
    constexpr std::uintmax_t limit = 4 * 1024 * 1024;
    std::error_code error;
    const auto size = fs::file_size(path, error);
    if (error || size > limit) htmlFail("Cannot read file: " + path);
    std::ifstream stream(path, std::ios::binary);
    std::string contents(size, '\0');
    if (!stream || !stream.read(contents.data(), contents.size())) {
        htmlFail("Cannot read file: " + path);
    }
    return contents;
}

std::string htmlResolve(const std::string &source, const std::string &relative)
{
    if (relative.empty() || relative.find(':') != std::string::npos ||
        relative.rfind("//", 0) == 0 || fs::path(relative).is_absolute()) {
        htmlFail("Expected a relative local asset path: " + relative);
    }
    return (fs::path(source).parent_path() / relative).lexically_normal().string();
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
    gea_macos_begin_runtime_fonts();
    auto &sheet = StyleSheet::instance();
    sheet.clear();
    sheet.beginRuleRegistrationBatch();
}

void htmlEndRules()
{
    gea_macos_commit_runtime_fonts();
    StyleSheet::instance().endRuleRegistrationBatch();
}

void htmlFont(const std::string &family, const std::string &path)
{
    if (!gea_macos_register_runtime_font(path.c_str(), family.c_str())) {
        htmlFail("Cannot load font " + family + " from " + path);
    }
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
