declare var require: any;

// Telegram setup
const https = require("https");
const Telegraf = require("telegraf");
const { Telegram } = require("telegraf");

// Telegraf 3 never sets a timeout on its HTTP requests and reuses keep-alive
// sockets. After a network hiccup a request can sit on a dead socket forever:
// for getUpdates that means the polling loop never continues and the bot goes
// silent. Use our own agent so we can drop all sockets, and put a hard
// deadline on every API call.
const agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  // Close idle keep-alive sockets before NATs/load balancers silently drop them
  timeout: 60000
});

// getUpdates long-polls for up to 30s (Telegraf's default), so give it a
// grace period on top of that. Other calls get a generous fixed limit.
const GET_UPDATES_DEADLINE_MS = 45000;
const API_CALL_DEADLINE_MS = 60000;

const originalCallApi = Telegram.prototype.callApi;
// Patch the prototype: Telegraf creates a new Telegram instance per update
// (ctx.telegram / ctx.reply), so patching bot.telegram alone isn't enough.
Telegram.prototype.callApi = function(method: string, data?: any) {
  const deadlineMs = String(method).indexOf("getUpdates") === 0
    ? GET_UPDATES_DEADLINE_MS
    : API_CALL_DEADLINE_MS;
  const request = originalCallApi.call(this, method, data);
  let timer: any;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      // Kill every socket so the hung request is torn down and the next
      // request opens a fresh connection.
      agent.destroy();
      reject(
        new Error(
          `Telegram API call ${String(method).split("?")[0]} timed out after ${deadlineMs}ms`
        )
      );
    }, deadlineMs);
  });
  // The losing promise may still reject later (e.g. after agent.destroy());
  // swallow that so it doesn't become an unhandled rejection.
  request.catch(() => {});
  return Promise.race([request, deadline]).then(
    (result: any) => {
      clearTimeout(timer);
      return result;
    },
    (err: any) => {
      clearTimeout(timer);
      throw err;
    }
  );
};

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {
  telegram: { agent }
});

// Telegraf 3's default error handler rethrows, which makes the polling loop
// log "Failed to process updates." and stop polling for good. Log instead.
bot.catch((err: any, ctx: any) => {
  console.error(
    "Error while handling update",
    ctx && ctx.update ? ctx.update.update_id : "",
    err
  );
});

module.exports.bot = bot;
export {};
