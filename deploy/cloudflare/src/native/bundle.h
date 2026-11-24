// SPDX-License-Identifier: Apache-2.0
#pragma once

#include "gea_runtime.h"
#include "html_host.h"

#include <archive.h>
#include <archive_entry.h>
#include <algorithm>
#include <array>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
namespace fs = std::filesystem;
constexpr std::size_t maxArchiveBytes = 8 * 1024 * 1024;
constexpr std::size_t maxExtractedBytes = 24 * 1024 * 1024;

struct Bundle {
	fs::path directory;
	std::vector<std::uint8_t> data;
	std::size_t fileCount = 0;
	bool matches = false;

	~Bundle()
	{
		std::error_code ignored;
		fs::remove_all(directory, ignored);
	}
};

std::unique_ptr<Bundle> bundle;
std::unique_ptr<Bundle> uploadedFiles;

std::unique_ptr<Bundle> makeBundle()
{
	auto next = std::make_unique<Bundle>();
	char directory[] = "/tmp/gea-render-XXXXXX";
	if (!mkdtemp(directory)) throw std::runtime_error("Could not create bundle directory");
	next->directory = directory;
	return next;
}

std::string selectBundle(const Bundle &selected)
{
	htmlSetAssetRoot(selected.directory.string());
	return (selected.directory / "index.html").string();
}

}

static bool benchmarkFixturesEnabled()
{
	return std::getenv("GEA_RENDER_BENCHMARK") != nullptr;
}

static std::string openBundle(const gea::TypedArray<std::uint8_t> &input)
{
	const auto size = static_cast<std::size_t>(input.byteLength());
	if (size == 0 || size > maxArchiveBytes) throw std::runtime_error("Invalid ZIP size");

	const auto *bytes = input.buffer()->data() + static_cast<std::size_t>(input.byteOffset());
	if (!bundle || bundle->data.size() != size || std::memcmp(bundle->data.data(), bytes, size) != 0) {
		auto next = makeBundle();

		std::unique_ptr<archive, decltype(&archive_read_free)> zip(archive_read_new(), &archive_read_free);
		if (!zip || archive_read_support_format_zip(zip.get()) != ARCHIVE_OK ||
			archive_read_open_memory(zip.get(), bytes, size) != ARCHIVE_OK) {
			throw std::runtime_error("Invalid ZIP");
		}

		std::array<char, 65536> chunk;
		std::size_t entries = 0;
		std::size_t total = 0;
		archive_entry *entry = nullptr;
		int status;
		while ((status = archive_read_next_header(zip.get(), &entry)) == ARCHIVE_OK) {
			const char *name = archive_entry_pathname(entry);
			const fs::path path = name ? name : "";
			if (++entries > 256 || path.empty() || path.has_root_path() ||
				path.string().find_first_of("\\:") != std::string::npos ||
				std::find(path.begin(), path.end(), "..") != path.end() ||
				archive_entry_hardlink(entry) || archive_entry_symlink(entry)) {
				throw std::runtime_error("Invalid ZIP entry");
			}

			const auto output = next->directory / path;
			const auto type = archive_entry_filetype(entry);
			if (type == AE_IFDIR) {
				fs::create_directories(output);
				continue;
			}

			if (type != AE_IFREG || fs::exists(output)) throw std::runtime_error("Invalid ZIP file");
			fs::create_directories(output.parent_path());
			std::ofstream file(output, std::ios::binary);
			la_ssize_t count;
			while ((count = archive_read_data(zip.get(), chunk.data(), chunk.size())) > 0) {
				total += static_cast<std::size_t>(count);
				if (total > maxExtractedBytes) throw std::runtime_error("ZIP is too large after extraction");
				file.write(chunk.data(), count);
			}

			file.close();
			if (count < 0 || !file) throw std::runtime_error("Could not extract ZIP entry");
		}

		if (status != ARCHIVE_EOF || !fs::is_regular_file(next->directory / "index.html")) {
			throw std::runtime_error("ZIP must have an index.html at its root");
		}

		next->data.assign(bytes, bytes + size);
		bundle = std::move(next);
	}

	return selectBundle(*bundle);
}

static void beginFileBundle()
{
	uploadedFiles = makeBundle();
	uploadedFiles->matches = bundle && bundle->data.empty();
}

static void writeBundleFile(const std::string &name, const gea::TypedArray<std::uint8_t> &input)
{
	const fs::path path(name);
	if (name.empty() || name == "." || name == ".." || name.find_first_of("/\\:") != std::string::npos ||
		name.find('\0') != std::string::npos || path.has_root_path()) {
		throw std::runtime_error("Invalid multipart filename");
	}

	const auto output = uploadedFiles->directory / path;
	if (fs::exists(output)) throw std::runtime_error("Duplicate multipart filename");
	const auto size = static_cast<std::size_t>(input.byteLength());
	const char *bytes = reinterpret_cast<const char *>(input.buffer()->data() +
		static_cast<std::size_t>(input.byteOffset()));
	++uploadedFiles->fileCount;
	if (uploadedFiles->matches) {
		std::error_code error;
		const auto previous = bundle->directory / path;
		if (fs::file_size(previous, error) == size && !error) {
			std::ifstream file(previous, std::ios::binary);
			uploadedFiles->matches = std::equal(bytes, bytes + size, std::istreambuf_iterator<char>(file),
				std::istreambuf_iterator<char>());
		} else {
			uploadedFiles->matches = false;
		}
	}

	std::ofstream file(output, std::ios::binary);
	if (size > 0) file.write(bytes, size);
	file.close();
	if (!file) throw std::runtime_error("Could not write multipart file");
}

static std::string finishFileBundle()
{
	if (!fs::is_regular_file(uploadedFiles->directory / "index.html")) {
		throw std::runtime_error("Multipart upload needs index.html");
	}

	if (uploadedFiles->matches && uploadedFiles->fileCount == bundle->fileCount) {
		uploadedFiles.reset();
	} else {
		bundle = std::move(uploadedFiles);
	}

	return selectBundle(*bundle);
}

static void discardFileBundle()
{
	uploadedFiles.reset();
}
