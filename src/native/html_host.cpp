#include "html_host.h"
#include "ui/style.h"
#include "ui/tree_internal.h"
#include "ui/document.h"
#include "platform/prerender_video.h"
#include "image.h"
#include "video_pipe.h"

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <memory>
#include <vector>
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

static fs::path assetRoot;

void htmlSetAssetRoot(const std::string &root)
{
    assetRoot = pathFromUtf8(root);
}

static void checkAssetPath(const fs::path &path)
{
    if (assetRoot.empty()) return;
    const auto normalized = path.lexically_normal();
    const auto relative = normalized.lexically_relative(assetRoot);
    if (relative.empty() || relative.has_root_path() || *relative.begin() == "..") {
        htmlFail("Asset is outside the uploaded bundle");
    }
}

std::string htmlRead(const std::string &path)
{
    constexpr std::uintmax_t limit = 4 * 1024 * 1024;
    std::error_code error;
    const auto file = pathFromUtf8(path);
    checkAssetPath(file);
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
    const auto path = (pathFromUtf8(source).parent_path() / pathFromUtf8(relative)).lexically_normal();
    checkAssetPath(path);
    return utf8Path(path);
}

namespace {
using gea::embedded::ui::NodeHandle;
using gea::framework::graphics::ImageStore;
namespace pixel = gea::framework::graphics::pixel;
namespace prerender = gea::platform::prerender;

struct Video {
    NodeHandle node;
    std::string path;
    std::unique_ptr<VideoPipe> decoder;
    std::vector<unsigned char> rgb;
    pixel::native_t *pixels = nullptr;
    int width = 0;
    int height = 0;
    std::int64_t frame = -1;
    bool ended = false;

    Video(NodeHandle element, std::string source) : node(element), path(std::move(source)) {}

    void advance(int timeMs)
    {
        if (ended) return;
        const auto target = (static_cast<std::int64_t>(timeMs) * prerender::videoFps + 500) / 1000;
        bool updated = false;
        while (frame < target) {
            auto *stream = decoder->stream();
            const int magic = std::fgetc(stream);
            if (magic == EOF) {
                if (!decoder->finishedSuccessfully() || frame < 0) htmlFail("Cannot decode video: " + path);
                ended = true;
                break;
            }

            int w = 0, h = 0, range = 0;
            if (magic != 'P' || std::fgetc(stream) != '6' ||
                std::fscanf(stream, "%d%d%d", &w, &h, &range) != 3 ||
                std::fgetc(stream) != '\n' || range != 255 || w < 1 || h < 1 || w > 8192 || h > 8192) {
                htmlFail("Invalid decoded video frame: " + path);
            }
            if (!pixels) {
                const auto count = static_cast<std::size_t>(w) * h;
                rgb.resize(count * 3);
                auto *buffer = static_cast<pixel::native_t *>(std::calloc(count, sizeof(pixel::native_t)));
                if (!buffer) htmlFail("Could not allocate video pixels");
                const int id = ImageStore::instance().registerBuffer(buffer, w, h, -1, true);
                if (id < 0) {
                    std::free(buffer);
                    htmlFail("Could not register video pixels");
                }
                pixels = buffer;
                width = w;
                height = h;
                node.style().imageId(id);
            }
            if (w != width || h != height || std::fread(rgb.data(), 1, rgb.size(), stream) != rgb.size())
                htmlFail("Incomplete or resized video frame: " + path);
            ++frame;
            updated = true;
        }
        if (updated) {
            for (std::size_t i = 0; i < rgb.size() / 3; ++i)
                pixels[i] = pixel::packNative8(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
            auto &tree = gea::embedded::ui::Tree::instance();
            const int id = node.id();
            tree.nodes()[id].render.dirty = 1;
#if GEA_CSS_SCROLLING
            tree.nodes()[id].render.non_scroll_dirty = 1;
#endif
            tree.markNodeDisplayCommandsDirty(id);
            tree.markDisplayListContentDirty();
        }
    }
};

std::vector<Video> videos;
}

void htmlVideo(NodeHandle node, const std::string &document, const std::string &media)
{
    if (prerender::videoFps == 0) return;
    for (const auto &video : videos) {
        if (video.node.id() == node.id()) return;
    }

    auto path = htmlResolve(document, media);
    const auto file = pathFromUtf8(path);
    std::error_code error;
    if (!fs::is_regular_file(file, error)) htmlFail("Video is not a local file: " + path);

    Video video(node, path);
    video.decoder = std::make_unique<VideoPipe>(std::vector<std::string>{
        "-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "file",
        "-threads", "1", "-max_pixels", "67108864", "-i", path, "-map", "0:v:0", "-vf", "fps=" + std::to_string(prerender::videoFps) + ":start_time=0",
        "-an", "-threads", "1", "-c:v", "ppm", "-f", "image2pipe", "pipe:1",
    });
    videos.push_back(std::move(video));
    prerender::videoTick = [](int timeMs) {
        for (auto &video : videos) video.advance(timeMs);
    };
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

void htmlKeyframe(const std::string &name, double offset, const std::string &property, const std::string &value)
{
    StyleSheet::instance().registerKeyframeRule(name, static_cast<int>(offset), property, value);
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
