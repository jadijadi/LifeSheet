"use strict";
exports.__esModule = true;
var https = require("https");
var Telegraf = require("telegraf");
var Telegram = require("telegraf").Telegram;
var agent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 10000,
    timeout: 60000
});
var GET_UPDATES_DEADLINE_MS = 45000;
var API_CALL_DEADLINE_MS = 60000;
var originalCallApi = Telegram.prototype.callApi;
Telegram.prototype.callApi = function (method, data) {
    var deadlineMs = String(method).indexOf("getUpdates") === 0
        ? GET_UPDATES_DEADLINE_MS
        : API_CALL_DEADLINE_MS;
    var request = originalCallApi.call(this, method, data);
    var timer;
    var deadline = new Promise(function (_, reject) {
        timer = setTimeout(function () {
            agent.destroy();
            reject(new Error("Telegram API call " + String(method).split("?")[0] + " timed out after " + deadlineMs + "ms"));
        }, deadlineMs);
    });
    request["catch"](function () { });
    return Promise.race([request, deadline]).then(function (result) {
        clearTimeout(timer);
        return result;
    }, function (err) {
        clearTimeout(timer);
        throw err;
    });
};
var bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {
    telegram: { agent: agent }
});
bot["catch"](function (err, ctx) {
    console.error("Error while handling update", ctx && ctx.update ? ctx.update.update_id : "", err);
});
module.exports.bot = bot;
//# sourceMappingURL=telegram.js.map