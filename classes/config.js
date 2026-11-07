"use strict";
exports.__esModule = true;
var needle = require("needle");
var yaml = require("js-yaml");
var fs = require("fs");
var path = require("path");
var urlMod = require("url");
var YAML_URL_CACHE_MS = 5 * 60 * 1000;
var yamlUrlCache = {};
function normalizeLoadedConfig(raw) {
    if (raw &&
        typeof raw === "object" &&
        raw.lists &&
        typeof raw.lists === "object" &&
        !Array.isArray(raw.lists)) {
        return raw.lists;
    }
    return { "default": raw };
}
var questionLists = {};
function getCommandsForList(listId) {
    var effective = listId == null || listId === "" || listId === "default" ? "default" : listId;
    var cfg = questionLists[effective];
    if (cfg)
        return cfg;
    if (effective !== "default") {
        console.warn('Unknown question list "' + listId + '", falling back to default');
    }
    return questionLists["default"] || {};
}
function defaultCommandsFromParsedConfig(parsed) {
    var lists = normalizeLoadedConfig(parsed);
    return lists["default"] || {};
}
function isLocalConfigPath(ref) {
    if (ref.startsWith("file://")) {
        return true;
    }
    return path.isAbsolute(ref);
}
function readLocalConfigText(ref, cb) {
    var filePath;
    if (ref.startsWith("file://")) {
        try {
            filePath = urlMod.fileURLToPath(ref);
        }
        catch (e) {
            cb(e, null);
            return;
        }
    }
    else {
        filePath = ref;
    }
    fs.readFile(filePath, "utf8", cb);
}
function parseConfigTextToCommands(text, cacheKey, now, cb) {
    var parsed;
    try {
        parsed = yaml.load(text);
    }
    catch (e) {
        cb(e, null);
        return;
    }
    if (parsed == null || typeof parsed !== "object") {
        cb(new Error("Config must be a YAML/JSON object"), null);
        return;
    }
    var commands = defaultCommandsFromParsedConfig(parsed);
    yamlUrlCache[cacheKey] = { commands: commands, expiresAt: now + YAML_URL_CACHE_MS };
    cb(null, commands);
}
function getCommandsFromYamlUrl(url, cb) {
    var now = Date.now();
    var hit = yamlUrlCache[url];
    if (hit && hit.expiresAt > now) {
        cb(null, hit.commands);
        return;
    }
    if (isLocalConfigPath(url)) {
        readLocalConfigText(url, function (err, text) {
            if (err) {
                cb(err, null);
                return;
            }
            parseConfigTextToCommands(text, url, now, cb);
        });
        return;
    }
    needle.get(url, { parse_response: false }, function (error, response, body) {
        if (error) {
            cb(error, null);
            return;
        }
        if (response.statusCode && response.statusCode >= 400) {
            cb(new Error("HTTP " + response.statusCode), null);
            return;
        }
        var text = typeof body === "string" ? body : String(body);
        parseConfigTextToCommands(text, url, now, cb);
    });
}
function resolveQuestionCommands(listId, yamlUrl, cb) {
    var trimmed = yamlUrl == null ? "" : String(yamlUrl).trim();
    if (trimmed !== "") {
        getCommandsFromYamlUrl(trimmed, function (err, cmds) {
            if (err || !cmds) {
                if (err)
                    console.warn("preferred_question_yaml_url fetch/parse failed, using default list:", trimmed, err.message || err);
                cb(null, getCommandsForList(listId));
            }
            else {
                cb(null, cmds);
            }
        });
    }
    else {
        cb(null, getCommandsForList(listId));
    }
}
function applyLoadedConfig(raw) {
    questionLists = normalizeLoadedConfig(raw);
    module.exports.questionLists = questionLists;
    module.exports.userConfig = getCommandsForList(null);
}
var url = process.env.LIFESHEET_JSON_URL;
if (url) {
    console.log("Loading remote JSON config...");
    needle.get(url, function (error, response, body) {
        if (error) {
            console.error("Failed to load remote user config", error);
            return;
        }
        applyLoadedConfig(body);
        console.log("Successfully loaded remote user config");
    });
}
else {
    applyLoadedConfig(require("../lifesheet.json"));
    console.log("Successfully loaded user config");
}
module.exports.questionLists = questionLists;
module.exports.userConfig = getCommandsForList(null);
module.exports.getCommandsForList = getCommandsForList;
module.exports.getCommandsFromYamlUrl = getCommandsFromYamlUrl;
module.exports.resolveQuestionCommands = resolveQuestionCommands;
//# sourceMappingURL=config.js.map