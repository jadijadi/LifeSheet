declare var require: any;
declare var module: any;
declare var process: any;

var needle = require("needle");
var yaml = require("js-yaml");
var fs = require("fs");
var path = require("path");
var urlMod = require("url");

var YAML_URL_CACHE_MS = 5 * 60 * 1000;
var yamlUrlCache: {
  [url: string]: { commands: { [key: string]: Command }; expiresAt: number };
} = {};

interface Command {
  description: string;
  schedule: string;
  questions: QuestionToAsk[];
}

interface QuestionToAsk {
  key: string;
  question: string;
  type: string;
  buttons: { [key: string]: string };
  replies: { [key: string]: string };
}

function normalizeLoadedConfig(raw: any): { [key: string]: { [key: string]: Command } } {
  if (
    raw &&
    typeof raw === "object" &&
    raw.lists &&
    typeof raw.lists === "object" &&
    !Array.isArray(raw.lists)
  ) {
    return raw.lists;
  }
  return { default: raw };
}

var questionLists: { [key: string]: { [key: string]: Command } } = {};

function getCommandsForList(listId: string | null): { [key: string]: Command } {
  var effective =
    listId == null || listId === "" || listId === "default" ? "default" : listId;
  var cfg = questionLists[effective];
  if (cfg) return cfg;
  if (effective !== "default") {
    console.warn('Unknown question list "' + listId + '", falling back to default');
  }
  return questionLists["default"] || {};
}

function defaultCommandsFromParsedConfig(parsed: any): { [key: string]: Command } {
  var lists = normalizeLoadedConfig(parsed);
  return lists["default"] || {};
}

/** True if this should be read from the local filesystem (not HTTP). */
function isLocalConfigPath(ref: string): boolean {
  if (ref.startsWith("file://")) {
    return true;
  }
  return path.isAbsolute(ref);
}

function readLocalConfigText(ref: string, cb: (err: Error | null, text: string | null) => void): void {
  var filePath: string;
  if (ref.startsWith("file://")) {
    try {
      filePath = urlMod.fileURLToPath(ref);
    } catch (e) {
      cb(e as Error, null);
      return;
    }
  } else {
    filePath = ref;
  }
  fs.readFile(filePath, "utf8", cb);
}

function parseConfigTextToCommands(
  text: string,
  cacheKey: string,
  now: number,
  cb: (err: Error | null, cmds: { [key: string]: Command } | null) => void
): void {
  var parsed: any;
  try {
    parsed = yaml.load(text);
  } catch (e) {
    cb(e as Error, null);
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

/**
 * Loads per-user question config from:
 * - http:// or https:// — HTTP GET (needle)
 * - file:///absolute/path — local file (see url.fileURLToPath)
 * - /absolute/path — local file on this machine (same shape as lifesheet.json / YAML)
 */
function getCommandsFromYamlUrl(
  url: string,
  cb: (err: Error | null, cmds: { [key: string]: Command } | null) => void
): void {
  var now = Date.now();
  var hit = yamlUrlCache[url];
  if (hit && hit.expiresAt > now) {
    cb(null, hit.commands);
    return;
  }
  if (isLocalConfigPath(url)) {
    readLocalConfigText(url, function (err: Error | null, text: string) {
      if (err) {
        cb(err, null);
        return;
      }
      parseConfigTextToCommands(text, url, now, cb);
    });
    return;
  }
  needle.get(url, { parse_response: false }, function (error: any, response: any, body: any) {
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

function resolveQuestionCommands(
  listId: string | null,
  yamlUrl: string | null,
  cb: (err: null, cmds: { [key: string]: Command }) => void
): void {
  var trimmed = yamlUrl == null ? "" : String(yamlUrl).trim();
  if (trimmed !== "") {
    getCommandsFromYamlUrl(trimmed, function (err, cmds) {
      if (err || !cmds) {
        if (err)
          console.warn(
            "preferred_question_yaml_url fetch/parse failed, using default list:",
            trimmed,
            (err as Error).message || err
          );
        cb(null, getCommandsForList(listId));
      } else {
        cb(null, cmds);
      }
    });
  } else {
    cb(null, getCommandsForList(listId));
  }
}

function applyLoadedConfig(raw: any): void {
  questionLists = normalizeLoadedConfig(raw);
  module.exports.questionLists = questionLists;
  module.exports.userConfig = getCommandsForList(null);
}

var url = process.env.LIFESHEET_JSON_URL;
if (url) {
  console.log("Loading remote JSON config...");
  needle.get(url, function (error: any, response: any, body: any) {
    if (error) {
      console.error("Failed to load remote user config", error);
      return;
    }
    applyLoadedConfig(body);
    console.log("Successfully loaded remote user config");
  });
} else {
  applyLoadedConfig(require("../lifesheet.json"));
  console.log("Successfully loaded user config");
}

module.exports.questionLists = questionLists;
module.exports.userConfig = getCommandsForList(null);
module.exports.getCommandsForList = getCommandsForList;
module.exports.getCommandsFromYamlUrl = getCommandsFromYamlUrl;
module.exports.resolveQuestionCommands = resolveQuestionCommands;

export { Command, QuestionToAsk };
