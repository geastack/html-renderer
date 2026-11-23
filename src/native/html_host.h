#pragma once
#include <string>
#include "ui/node.h"

std::string htmlInput();
std::string htmlRead(const std::string &path);
std::string htmlResolve(const std::string &source, const std::string &relative);
void htmlRule(const std::string &selector, const std::string &property, const std::string &value);
void htmlBeginRules();
void htmlEndRules();
void htmlFont(const std::string &family, const std::string &path);
[[noreturn]] void htmlFail(const std::string &message);
void htmlMarkText(gea::embedded::ui::NodeHandle node);
void htmlMount(gea::embedded::ui::NodeHandle root);
void htmlInline(gea::embedded::ui::NodeHandle element, const std::string &property, const std::string &value);
