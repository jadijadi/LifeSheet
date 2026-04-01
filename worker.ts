// Third party dependencies
const moment = require("moment");
var needle = require("needle");
const { Router, Markup, Extra } = require("telegraf");

// Internal dependencies
let config = require("./classes/config.js");
let postgres = require("./classes/postgres.js");
let telegram = require("./classes/telegram.js");

import { Command, QuestionToAsk } from "./classes/config.js";

let bot = telegram.bot;

// Per-user conversation state (multi-user)
interface UserState {
  currentlyAskedQuestionObject: QuestionToAsk | null;
  currentlyAskedQuestionMessageId: number | null;
  currentlyAskedQuestionQueue: QuestionToAsk[];
}

const userState = new Map<number, UserState>();

function getState(ctx: any): UserState {
  const userId = ctx.update?.message?.from?.id ?? ctx.from?.id;
  if (!userId) throw new Error("No user id in context");
  let state = userState.get(userId);
  if (!state) {
    state = {
      currentlyAskedQuestionObject: null,
      currentlyAskedQuestionMessageId: null,
      currentlyAskedQuestionQueue: []
    };
    userState.set(userId, state);
  }
  return state;
}

function ensureUserRegistered(ctx: any): void {
  const from = ctx.update?.message?.from ?? ctx.from;
  if (!from) return;
  const userId = from.id;
  const chatId = ctx.update?.message?.chat?.id ?? ctx.chat?.id;
  if (chatId == null) return;
  const username = from.username ?? null;
  console.log(
    "ensureUserRegistered for user",
    userId,
    "in chat",
    chatId,
    "username",
    username
  );
  postgres.client.query(
    {
      text:
        "INSERT INTO users (user_id, chat_id, username, updated_at) VALUES ($1, $2, $3, NOW()) " +
        "ON CONFLICT (user_id) DO UPDATE SET chat_id = $2, username = $3, updated_at = NOW()",
      values: [userId, chatId, username]
    },
    (err: Error) => {
      if (err) console.error("ensureUserRegistered", err);
    }
  );
}

initBot();

function roundNumberExactly(number, decimals) {
  return (
    Math.round(number * Math.pow(10, decimals)) / Math.pow(10, decimals)
  ).toFixed(decimals);
}

function getButtonText(number: string, questionObject: QuestionToAsk): string {
  let emojiNumber = {
    "0": "0️⃣",
    "1": "1️⃣",
    "2": "2️⃣",
    "3": "3️⃣",
    "4": "4️⃣",
    "5": "5️⃣"
  }[number];

  if (questionObject.buttons == null) {
    questionObject.buttons = {
      "0": "Terrible",
      "1": "Bad",
      "2": "Okay",
      "3": "Good",
      "4": "Great",
      "5": "Excellent"
    };
  }

  return emojiNumber + " " + questionObject.buttons[number];
}

function printGraph(
  key: string,
  ctx: any,
  numberOfRecentValuesToPrint: number,
  additionalValue: any,
  skipImage: boolean
) {
  const userId = ctx.update?.message?.from?.id ?? ctx.from?.id;
  if (!userId) return;

  postgres.client.query(
    {
      text:
        "SELECT * FROM raw_data WHERE user_id = $1 AND key = $2 ORDER BY timestamp DESC LIMIT 300",
      values: [userId, key]
    },
    (err, res) => {
      if (err) {
        console.error(err);
        ctx.reply(err);
        return;
      }

      let rows = res.rows;
      console.log("Rows: " + rows.length);

      let allValues = [];
      let allTimes = [];
      let rawText = [];
      let minimum = 10000;
      let maximum = 0;
      for (let i = 0; i < rows.length; i++) {
        let time = moment(Number(rows[i].timestamp));
        let value = Number(rows[i].value);
        allValues.unshift(value);
        allTimes.unshift(time.format("MM-DD"));

        if (i < numberOfRecentValuesToPrint - 1) {
          rawText.unshift(time.format("YYYY-MM-DD") + ": " + value.toFixed(2));
        }

        if (value < minimum) {
          minimum = value;
        }
        if (value > maximum) {
          maximum = value;
        }
      }

      if (additionalValue) {
        allValues.push(additionalValue);
        allTimes.push(moment());

        rawText.push(
          moment().format("YYYY-MM-DD") +
            ": " +
            Number(additionalValue).toFixed(2)
        );
      }

      // Print the raw values
      if (numberOfRecentValuesToPrint > 2) {
        ctx.reply(
          rawText.join("\n") + "\nMinimum: " + minimum + "\nMaximum: " + maximum
        );
      }

      // Generate the graph
      // if (!skipImage) {
      //   minimum -= 2;
      //   maximum += 2;

      //   let url =
      //     "https://chart.googleapis.com/chart?cht=lc&chd=t:" +
      //     allValues.join(",") +
      //     "&chs=800x350&chl=" +
      //     allTimes.join("%7C") +
      //     "&chtt=" +
      //     key +
      //     "&chf=bg,s,e0e0e0&chco=000000,0000FF&chma=30,30,30,30&chds=" +
      //     minimum +
      //     "," +
      //     maximum;
      //   console.log(url);
      //   ctx.replyWithPhoto({
      //     url: url
      //   });
      // }

      if (numberOfRecentValuesToPrint > 0) {
        // Now render the week/month/quarter/year average
        let queryToUse = "SELECT";
        const weekTimestamp =
          moment()
            .subtract(7, "days")
            .unix() * 1000;
        const monthTimestamp =
          moment()
            .subtract(30, "days")
            .unix() * 1000;
        const quarterTimestamp =
          moment()
            .subtract(90, "days")
            .unix() * 1000;
        const yearTimestamp =
          moment()
            .subtract(365, "days")
            .unix() * 1000;

        let athTimestamp = moment("2019-04-12").unix() * 1000;

        if (key == "mood") {
          athTimestamp = moment("2018-02-01").unix() * 1000;
        }
        // After values (all scoped to user_id)
        queryToUse += `(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = ${userId} AND timestamp > ${weekTimestamp} AND key='${key}') as ${key}Week,`;
        queryToUse += `(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = ${userId} AND timestamp > ${monthTimestamp} AND key='${key}') as ${key}Month,`;
        queryToUse += `(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = ${userId} AND timestamp > ${quarterTimestamp} AND key='${key}') as ${key}Quarter,`;
        queryToUse += `(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = ${userId} AND timestamp > ${yearTimestamp} AND key='${key}') as ${key}Year,`;
        queryToUse += `(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = ${userId} AND timestamp > ${athTimestamp} AND key='${key}') as ${key}AllTime,`;

        // Before values
        queryToUse += `(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = ${userId} AND id != (SELECT id FROM raw_data WHERE user_id = ${userId} AND key='${key}' ORDER BY id DESC LIMIT 1) AND timestamp > ${weekTimestamp} AND key='${key}') as ${key}WeekOld,`;
        queryToUse += `(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = ${userId} AND id != (SELECT id FROM raw_data WHERE user_id = ${userId} AND key='${key}' ORDER BY id DESC LIMIT 1) AND timestamp > ${monthTimestamp} AND key='${key}') as ${key}MonthOld,`;
        queryToUse += `(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = ${userId} AND id != (SELECT id FROM raw_data WHERE user_id = ${userId} AND key='${key}' ORDER BY id DESC LIMIT 1) AND timestamp > ${quarterTimestamp} AND key='${key}') as ${key}QuarterOld,`;
        queryToUse += `(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = ${userId} AND id != (SELECT id FROM raw_data WHERE user_id = ${userId} AND key='${key}' ORDER BY id DESC LIMIT 1) AND timestamp > ${yearTimestamp} AND key='${key}') as ${key}YearOld,`;
        queryToUse += `(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = ${userId} AND id != (SELECT id FROM raw_data WHERE user_id = ${userId} AND key='${key}' ORDER BY id DESC LIMIT 1) AND timestamp > ${athTimestamp} AND key='${key}') as ${key}AllTimeOld,`;

        // Previous Year values
        let previousYearStart =
          moment()
            .subtract(365 * 2, "days")
            .unix() * 1000;
        let previousYearEnd =
          moment()
            .subtract(365, "days")
            .unix() * 1000;
        queryToUse += `(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = ${userId} AND timestamp > ${previousYearStart} AND timestamp < ${previousYearEnd} AND key='${key}') as ${key}PreviousYear,`;
        queryToUse += `(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = ${userId} AND timestamp < ${previousYearEnd} AND key='${key}') as ${key}BeforeLastYear,`;

        let previousQuarterStart =
          moment()
            .subtract(90 * 2, "days")
            .unix() * 1000;
        let previousQuarterEnd =
          moment()
            .subtract(90, "days")
            .unix() * 1000;
        queryToUse += `(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = ${userId} AND timestamp > ${previousQuarterStart} AND timestamp < ${previousQuarterEnd} AND key='${key}') as ${key}PreviousQuarter`;

        console.log(queryToUse);

        postgres.client.query(
          {
            text: queryToUse
          },
          (err, res) => {
            const rows = ["week", "month", "quarter", "year", "alltime"];
            let c = res.rows[0];
            console.log(c);
            var finalText = ["Moving averages for " + key];
            for (let i = 0; i < rows.length; i++) {
              let newValue = c[key.toLowerCase() + rows[i]];
              let oldValue = c[key.toLowerCase() + rows[i] + "old"];

              var stringToPush =
                roundNumberExactly(newValue, 2) +
                " - " +
                rows[i] +
                " (" +
                (newValue - oldValue > 0 ? "+" : "") +
                roundNumberExactly(newValue - oldValue, 2) +
                ")";

              // quarter
              if (rows[i] == "quarter") {
                let newQuarterValue = c[key.toLowerCase() + "previousquarter"];
                stringToPush +=
                  "\n   " +
                  roundNumberExactly(newQuarterValue, 2) +
                  " - Previous Quarter (" +
                  (newValue - newQuarterValue > 0 ? "+" : "") +
                  roundNumberExactly(newValue - newQuarterValue, 2) +
                  ")";
              }
              // year
              if (rows[i] == "year") {
                let newYearValue = c[key.toLowerCase() + "previousyear"];
                stringToPush +=
                  "\n   " +
                  roundNumberExactly(newYearValue, 2) +
                  " - Previous Year (" +
                  (newValue - newYearValue > 0 ? "+" : "") +
                  roundNumberExactly(newValue - newYearValue, 2) +
                  ")";
                let newBeforeLastYearValue =
                  c[key.toLowerCase() + "beforelastyear"];
                stringToPush +=
                  "\n   " +
                  roundNumberExactly(newBeforeLastYearValue, 2) +
                  " - Before Last Year (" +
                  (newValue - newBeforeLastYearValue > 0 ? "+" : "") +
                  roundNumberExactly(newValue - newBeforeLastYearValue, 2) +
                  ")";
              }

              finalText.push(stringToPush);
            }
            ctx.reply(finalText.join("\n"));
          }
        );
      }
    }
  );
}

function triggerNextQuestionFromQueue(ctx: any) {
  const state = getState(ctx);
  let keyboard = Extra.markup(m => m.removeKeyboard()); // default keyboard
  let questionAppendix = "";

  state.currentlyAskedQuestionObject = state.currentlyAskedQuestionQueue.shift();

  if (state.currentlyAskedQuestionObject == null) {
    ctx.reply("All done for now, let's do this 💪", keyboard);
    return;
  }

  const currentQuestion = state.currentlyAskedQuestionObject;
  if (currentQuestion.question == null) {
    console.error("No text defined for");
    console.error(currentQuestion);
  }

  if (currentQuestion.type == "header") {
    ctx
      .reply(currentQuestion.question, keyboard)
      .then(() => {
        triggerNextQuestionFromQueue(ctx);
      });
    return;
  }

  if (currentQuestion.type == "range") {
    let allButtons = [
      [getButtonText("5", currentQuestion)],
      [getButtonText("4", currentQuestion)],
      [getButtonText("3", currentQuestion)],
      [getButtonText("2", currentQuestion)],
      [getButtonText("1", currentQuestion)],
      [getButtonText("0", currentQuestion)]
    ];
    shuffleArray(allButtons);
    keyboard = Markup.keyboard(allButtons)
      .oneTime()
      .extra();
  } else if (currentQuestion.type == "boolean") {
    keyboard = Markup.keyboard([["1: Yes"], ["0: No"]])
      .oneTime()
      .extra();
  } else if (currentQuestion.type == "text") {
    questionAppendix +=
      "You can use a Bear note, and then paste the deep link to the note here";
  } else if (currentQuestion.type == "location") {
    keyboard = Extra.markup(markup => {
      return markup.keyboard([
        markup.locationRequestButton("📡 Send location")
      ]);
    });
  }

  questionAppendix = state.currentlyAskedQuestionQueue.length + " more question";
  if (state.currentlyAskedQuestionQueue.length != 1) {
    questionAppendix += "s";
  }
  if (state.currentlyAskedQuestionQueue.length == 0) {
    questionAppendix = "last question";
  }

  let question =
    currentQuestion.question + " (" + questionAppendix + ")";

  ctx.reply(question, keyboard).then(({ message_id }: { message_id: number }) => {
    state.currentlyAskedQuestionMessageId = message_id;
  });

  if (
    currentQuestion.type == "number" ||
    currentQuestion.type == "range" ||
    currentQuestion.type == "boolean"
  ) {
    printGraph(currentQuestion.key, ctx, 0, null, false);
  }
}

// Taken from https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function insertNewValue(parsedUserValue: any, ctx: any, key: string, type: string, fakeDate: any = null) {
  console.log("Inserting value '" + parsedUserValue + "' for key " + key);

  const userId = ctx.update?.message?.from?.id ?? ctx.from?.id;
  if (!userId) return;

  let dateToAdd;
  if (fakeDate) {
    dateToAdd = fakeDate;
  } else {
    dateToAdd = moment(ctx.update.message.date * 1000);
  }
  const state = getState(ctx);
  let questionText: string | null = null;
  if (state.currentlyAskedQuestionObject) {
    questionText = state.currentlyAskedQuestionObject.question;
  }

  const row = {
    user_id: userId,
    timestamp: dateToAdd.valueOf(),
    yearmonth: dateToAdd.format("YYYYMM"),
    yearweek: dateToAdd.format("YYYYWW"),
    year: dateToAdd.year(),
    quarter: dateToAdd.quarter(),
    month: dateToAdd.format("MM"),
    day: dateToAdd.date(),
    hour: dateToAdd.hours(),
    minute: dateToAdd.minutes(),
    week: dateToAdd.week(),
    key: key,
    question: questionText,
    type: type,
    value: String(parsedUserValue),
    source: "telegram",
    importedat: moment(ctx.update.message.date * 1000),
    importid: null
  };

  const keys = Object.keys(row);
  const reserved = ["key", "type", "value", "year", "month", "day", "hour", "minute"];
  const quotedKeys = keys.map(k => (reserved.indexOf(k) >= 0 ? '"' + k + '"' : k));
  const placeholders = keys.map((_, i) => "$" + (i + 1)).join(", ");

  postgres.client.query(
    {
      text:
        "INSERT INTO raw_data (" +
        quotedKeys.join(", ") +
        ") VALUES (" + placeholders + ")",
      values: Object.values(row)
    },
    (err, res) => {
      if (err) {
        ctx.reply("Error saving value: " + err);
        console.log(err.stack);
      } else {
      }
    }
  );

  if (ctx) {
    // we don't use this for location sending as we have many values for that, so that's when `ctx` is nil
    // Show that we saved the value
    // Currently the Telegram API doens't support updating of messages that have a custom keyboard
    // for no good reason, as mentioned here https://github.com/TelegramBots/telegram.bot/issues/176
    //
    // Bad Request: Message can't be edited
    //
    // Please note, that it is currently only possible to edit messages without reply_markup or with inline keyboards
    // ctx.telegram.editMessageText(
    //   ctx.update.message.chat.id,
    //   currentlyAskedQuestionMessageId,
    //   null,
    //   "✅ " + lastQuestionAskedDupe + " ✅"
    // );
  }
}

function parseUserInput(ctx: any, text: string | null = null) {
  const state = getState(ctx);

  if (state.currentlyAskedQuestionMessageId == null) {
    ctx
      .reply(
        "Sorry, I forgot the question I asked, this usually means it took too long for you to respond, please trigger the question again by running the `/` command"
      )
      .then(() => {
        sendAvailableCommands(ctx);
      });
    return;
  }

  let userValue: string;
  if (text != null) {
    userValue = text;
  } else {
    userValue = ctx.match[1];
  }

  let parsedUserValue: any = null;
  const currentQuestion = state.currentlyAskedQuestionObject;
  if (!currentQuestion) return;

  if (currentQuestion.type != "text") {
    // First, see if it starts with emoji number, for which we have to do custom
    // parsing instead
    if (
      currentQuestion.type == "range" ||
      currentQuestion.type == "boolean"
    ) {
      let tryToParseNumber = parseInt(userValue[0]);
      if (!isNaN(tryToParseNumber)) {
        parsedUserValue = tryToParseNumber;
      } else {
        ctx.reply(
          "Sorry, looks like your input is invalid, please enter a valid number from the selection",
          Extra.inReplyTo(ctx.update.message.message_id)
        );
      }
    }

    if (parsedUserValue == null) {
      // parse the int/float, support both ints and floats
      userValue = userValue.match(/^(\d+(\.\d+)?)$/);
      if (userValue == null) {
        ctx.reply(
          "Sorry, looks like you entered an invalid number, please try again",
          Extra.inReplyTo(ctx.update.message.message_id)
        );
        return;
      }
      parsedUserValue = userValue[1];
    }
  } else {
    parsedUserValue = userValue; // raw value is fine
  }

  if (currentQuestion.type == "range") {
    // ensure the input is 0-6
    if (parsedUserValue < 0 || parsedUserValue > 6) {
      ctx.reply(
        "Please enter a value from 0 to 6",
        Extra.inReplyTo(ctx.update.message.message_id)
      );
      return;
    }
  }

  if (
    currentQuestion.type == "number" ||
    currentQuestion.type == "range" ||
    currentQuestion.type == "boolean"
  ) {
    printGraph(currentQuestion.key, ctx, 2, parsedUserValue, true);
  }

  console.log(
    "Got a new value: " +
      parsedUserValue +
      " for question " +
      currentQuestion.key
  );

  if (
    currentQuestion.replies &&
    currentQuestion.replies[parsedUserValue]
  ) {
    ctx.reply(
      currentQuestion.replies[parsedUserValue],
      Extra.inReplyTo(ctx.update.message.message_id)
    );
  }

  insertNewValue(
    parsedUserValue,
    ctx,
    currentQuestion.key,
    currentQuestion.type
  );

  setTimeout(function() {
    triggerNextQuestionFromQueue(ctx);
  }, 50); // timeout just to make sure the order is right
}

function sendAvailableCommands(ctx) {
  ctx.reply("Available commands:").then(({ message_id }) => {
    ctx.reply(
      "\n\n/skip\n/report\n\n/" + Object.keys(config.userConfig).join("\n/")
    );
  });
}

function saveLastRun(ctx: any, command: string) {
  const userId = ctx.update?.message?.from?.id ?? ctx.from?.id;
  if (!userId) return;
  postgres.client.query(
    {
      text:
        "INSERT INTO last_run (user_id, command, last_run) VALUES ($1, $2, $3) " +
        "ON CONFLICT (user_id, command) DO UPDATE SET last_run = $3",
      values: [userId, command, moment().valueOf()]
    },
    (err: Error, res: any) => {
      if (err) {
        console.log(err.stack);
      } else {
        console.log("Stored timestamp of last run for " + command + " user " + userId);
      }
    }
  );
}

function initBot() {
  console.log("Launching up Telegram bot...");

  // parse numeric/text inputs
  bot.hears(/^([^\/].*)$/, ctx => {
    ensureUserRegistered(ctx);
    parseUserInput(ctx);
  });

  //
  // parse one-off commands:
  //
  bot.hears("/skip", ctx => {
    ensureUserRegistered(ctx);
    console.log("user is skipping this question");
    ctx.reply(
      "Okay, skipping question. If you see yourself skipping a question too often, maybe it's time to rephrase or remove it"
    );
    triggerNextQuestionFromQueue(ctx);
  });

  bot.hears("/skip_all", ctx => {
    ensureUserRegistered(ctx);
    const state = getState(ctx);
    state.currentlyAskedQuestionQueue = [];
    triggerNextQuestionFromQueue(ctx);
    ctx.reply("Okay, removing all questions that are currently in the queue");
  });

  bot.hears(/\/track (\w+)/, ctx => {
    ensureUserRegistered(ctx);

    let toTrack = ctx.match[1];
    console.log(
      "User wants to track a specific value, without the whole survey: " +
        toTrack
    );

    let questionToAsk: QuestionToAsk = null;

    Object.keys(config.userConfig).forEach(function(key) {
      var survey = config.userConfig[key];
      for (let i = 0; i < survey.questions.length; i++) {
        let currentQuestion = survey.questions[i];
        if (currentQuestion.key == toTrack) {
          questionToAsk = currentQuestion;
          return;
        }
      }
    });

    if (questionToAsk) {
      const state = getState(ctx);
      state.currentlyAskedQuestionQueue = state.currentlyAskedQuestionQueue.concat(
        questionToAsk
      );
      triggerNextQuestionFromQueue(ctx);
    } else {
      ctx.reply(
        "Sorry, I couldn't find the key `" +
          toTrack +
          "`, please make sure it's not mispelled"
      );
    }
  });

  bot.hears(/\/graph (\w+)/, ctx => {
    ensureUserRegistered(ctx);
    let key = ctx.match[1];
    console.log("User wants to graph a specific value " + key);
    printGraph(key, ctx, 100, null, false);
  });

  bot.on("location", ctx => {
    ensureUserRegistered(ctx);
    const state = getState(ctx);
    if (state.currentlyAskedQuestionMessageId == null) {
      ctx
        .reply(
          "Sorry, I forgot the question I asked, this usually means it took too long for you to respond, please trigger the question again by running the `/` command"
        )
        .then(({ message_id }) => {
          sendAvailableCommands(ctx);
        });
      return;
    }
    let location = ctx.update.message.location;
    let lat = location.latitude;
    let lng = location.longitude;

    insertNewValue(lat, ctx, "locationLat", "number");
    insertNewValue(lng, ctx, "locationLng", "number");
    triggerNextQuestionFromQueue(ctx);
  });

  // parse commands to start a survey
  bot.hears(/\/(\w+)/, ctx => {
    ensureUserRegistered(ctx);

    let command = ctx.match[1];
    let matchingCommandObject = config.userConfig[command];
    const state = getState(ctx);

    if (matchingCommandObject && matchingCommandObject.questions) {
      console.log("User wants to run: " + command);
      saveLastRun(ctx, command);
      if (
        state.currentlyAskedQuestionQueue.length > 0 &&
        state.currentlyAskedQuestionMessageId
      ) {
        ctx.reply(
          "^ Okay, but please answer my previous question also, thanks ^",
          Extra.inReplyTo(state.currentlyAskedQuestionMessageId)
        );
      }

      state.currentlyAskedQuestionQueue = state.currentlyAskedQuestionQueue.concat(
        matchingCommandObject.questions.slice(0)
      );

      if (state.currentlyAskedQuestionObject == null) {
        triggerNextQuestionFromQueue(ctx);
      }
    } else {
      ctx
        .reply("Sorry, I don't know how to run `/" + command)
        .then(({ message_id }) => {
          sendAvailableCommands(ctx);
        });
    }
  });

  bot.start(ctx => {
    ensureUserRegistered(ctx);
    ctx.reply("Welcome to LifeSheet! Use / to see available commands.");
  });
  // bot.on(["voice", "video_note"], ctx => {
  //   if (ctx.update.message.from.username != process.env.TELEGRAM_USER_ID) {
  //     return;
  //   }
  //   let message = ctx.message || ctx.update.channel_post;
  //   let voice =
  //     message.voice || message.document || message.audio || message.video_note;
  //   let fileId = voice.file_id;
  //   let transcribingMessageId = null;

  //   console.log("Received voice with file ID '" + fileId + "'");
  //   ctx
  //     .reply(
  //       "🦄 Received message, transcribing now...",
  //       Extra.inReplyTo(ctx.message.message_id)
  //     )
  //     .then(({ message_id }) => {
  //       transcribingMessageId = message_id;
  //     });

  //   let transcribeURL = "https://bubbles-transcribe.herokuapp.com/transcribe";
  //   transcribeURL += "?file_id=" + fileId;
  //   transcribeURL += "&language=en-US";
  //   transcribeURL += "&telegram_token=" + process.env.TELEGRAM_BOT_TOKEN;

  //   needle.get(transcribeURL, function(error, response, body) {
  //     if (error) {
  //       console.error(error);
  //       ctx.reply("Error: " + error, Extra.inReplyTo(ctx.message.message_id));
  //     }
  //     let text = JSON.parse(body)["text"];

  //     ctx.telegram.editMessageText(
  //       ctx.update.message.chat.id,
  //       transcribingMessageId,
  //       null,
  //       text
  //     );

  //     if (text != null && text.length > 5) {
  //       parseUserInput(ctx, text);
  //     }
  //   });
  // });

  bot.help(ctx =>
    ctx.reply(
      "No in-bot help right now, for now please visit https://github.com/KrauseFx/FxLifeSheet"
    )
  );
  bot.on("sticker", ctx => ctx.reply("Sorry, I don't support stickers"));
  bot.hears("hi", ctx => ctx.reply("Hey there"));

  // has to be last
  bot.launch();
}

export {};
