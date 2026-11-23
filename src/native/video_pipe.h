// SPDX-License-Identifier: Apache-2.0
#pragma once

#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#else
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>
extern char **environ;
#endif

class VideoPipe {
public:
    explicit VideoPipe(std::vector<std::string> arguments)
    {
#ifdef _WIN32
        auto command = commandLine(arguments);
        SECURITY_ATTRIBUTES security{sizeof(security), nullptr, TRUE};
        HANDLE reader, writer;
        if (!CreatePipe(&reader, &writer, &security, 0))
            throw std::runtime_error("Could not create the video decoder pipe");
        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdOutput = writer;
        startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
        startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        PROCESS_INFORMATION information{};
        const bool started = SetHandleInformation(reader, HANDLE_FLAG_INHERIT, 0) &&
            CreateProcessW(nullptr, command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
                           nullptr, nullptr, &startup, &information);
        CloseHandle(writer);
        if (!started) {
            CloseHandle(reader);
            throw std::runtime_error("Could not start the FFmpeg video decoder");
        }
        CloseHandle(information.hThread);
        child_ = information.hProcess;
        const int fd = _open_osfhandle(reinterpret_cast<intptr_t>(reader), _O_BINARY | _O_RDONLY);
        if (fd < 0) CloseHandle(reader);
        else if (!(stream_ = _fdopen(fd, "rb"))) _close(fd);
#else
        const char *configured = std::getenv("GEA_FFMPEG");
        arguments.insert(arguments.begin(), configured && *configured ? configured : "ffmpeg");
        std::vector<char *> argv;
        for (auto &argument : arguments) argv.push_back(argument.data());
        argv.push_back(nullptr);
        int pipeFds[2];
        if (pipe(pipeFds) != 0) throw std::runtime_error("Could not create the video decoder pipe");
        posix_spawn_file_actions_t actions;
        const int initialized = posix_spawn_file_actions_init(&actions);
        bool started = false;
        if (!initialized) {
            started = fcntl(pipeFds[0], F_SETFD, FD_CLOEXEC) == 0 &&
                fcntl(pipeFds[1], F_SETFD, FD_CLOEXEC) == 0 &&
                posix_spawn_file_actions_adddup2(&actions, pipeFds[1], STDOUT_FILENO) == 0 &&
                posix_spawnp(&child_, argv[0], &actions, nullptr, argv.data(), environ) == 0;
            posix_spawn_file_actions_destroy(&actions);
        }
        close(pipeFds[1]);
        if (!started) {
            close(pipeFds[0]);
            throw std::runtime_error("Could not start the FFmpeg video decoder");
        }
        stream_ = fdopen(pipeFds[0], "rb");
        if (!stream_) close(pipeFds[0]);
#endif
        if (!stream_) {
            stop();
            throw std::runtime_error("Could not open the FFmpeg video decoder pipe");
        }
    }

    VideoPipe(const VideoPipe &) = delete;
    VideoPipe &operator=(const VideoPipe &) = delete;
    ~VideoPipe() { stop(); }

    FILE *stream() const { return stream_; }

    bool finishedSuccessfully()
    {
        std::fclose(stream_);
        stream_ = nullptr;
#ifdef _WIN32
        DWORD code = 1;
        WaitForSingleObject(child_, INFINITE);
        GetExitCodeProcess(child_, &code);
        CloseHandle(child_);
        child_ = nullptr;
        return code == 0;
#else
        int status = 0;
        pid_t result;
        do { result = waitpid(child_, &status, 0); } while (result < 0 && errno == EINTR);
        child_ = -1;
        return result > 0 && WIFEXITED(status) && WEXITSTATUS(status) == 0;
#endif
    }

private:
    FILE *stream_ = nullptr;
#ifdef _WIN32
    HANDLE child_ = nullptr;

    static void appendArgument(std::wstring &command, const std::wstring &argument)
    {
        if (!command.empty()) command += L' ';
        command += L'"';
        std::size_t backslashes = 0;
        for (const auto ch : argument) {
            if (ch == L'\\') {
                ++backslashes;
                continue;
            }
            command.append(ch == L'"' ? 2 * backslashes + 1 : backslashes, L'\\');
            command += ch;
            backslashes = 0;
        }
        command.append(2 * backslashes, L'\\');
        command += L'"';
    }

    static std::wstring commandLine(const std::vector<std::string> &arguments)
    {
        const wchar_t *configured = _wgetenv(L"GEA_FFMPEG");
        std::wstring command;
        appendArgument(command, configured && *configured ? configured : L"ffmpeg");
        for (const auto &argument : arguments) {
            const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, argument.c_str(), -1, nullptr, 0);
            if (length <= 0) throw std::runtime_error("Invalid UTF-8 in a video decoder argument");
            std::wstring wide(length, L'\0');
            MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, argument.c_str(), -1, wide.data(), length);
            wide.pop_back();
            appendArgument(command, wide);
        }
        return command;
    }

#else
    pid_t child_ = -1;
#endif

    void stop()
    {
#ifdef _WIN32
        if (child_) TerminateProcess(child_, 1);
#else
        if (child_ > 0) kill(child_, SIGKILL);
#endif
        if (stream_) std::fclose(stream_);
#ifdef _WIN32
        if (child_) {
            WaitForSingleObject(child_, INFINITE);
            CloseHandle(child_);
        }
#else
        if (child_ > 0) {
            while (waitpid(child_, nullptr, 0) < 0 && errno == EINTR) {}
        }
#endif
    }
};
