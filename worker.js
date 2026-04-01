"use strict";
exports.__esModule = true;
var moment = require("moment");
var needle = require("needle");
var _a = require("telegraf"), Router = _a.Router, Markup = _a.Markup, Extra = _a.Extra;
var config = require("./classes/config.js");
var postgres = require("./classes/postgres.js");
var telegram = require("./classes/telegram.js");
var bot = telegram.bot;
var userState = new Map();
function getState(ctx) {
    var _a, _b, _c, _d, _e;
    var userId = (_d = (_c = (_b = (_a = ctx.update) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.from) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : (_e = ctx.from) === null || _e === void 0 ? void 0 : _e.id;
    if (!userId)
        throw new Error("No user id in context");
    var state = userState.get(userId);
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
function ensureUserRegistered(ctx) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    var from = (_c = (_b = (_a = ctx.update) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.from) !== null && _c !== void 0 ? _c : ctx.from;
    if (!from)
        return;
    var userId = from.id;
    var chatId = (_g = (_f = (_e = (_d = ctx.update) === null || _d === void 0 ? void 0 : _d.message) === null || _e === void 0 ? void 0 : _e.chat) === null || _f === void 0 ? void 0 : _f.id) !== null && _g !== void 0 ? _g : (_h = ctx.chat) === null || _h === void 0 ? void 0 : _h.id;
    if (chatId == null)
        return;
    var username = (_j = from.username) !== null && _j !== void 0 ? _j : null;
    console.log("ensureUserRegistered for user", userId, "in chat", chatId, "username", username);
    postgres.client.query({
        text: "INSERT INTO users (user_id, chat_id, username, updated_at) VALUES ($1, $2, $3, NOW()) " +
            "ON CONFLICT (user_id) DO UPDATE SET chat_id = $2, username = $3, updated_at = NOW()",
        values: [userId, chatId, username]
    }, function (err) {
        if (err)
            console.error("ensureUserRegistered", err);
    });
}
initBot();
function roundNumberExactly(number, decimals) {
    return (Math.round(number * Math.pow(10, decimals)) / Math.pow(10, decimals)).toFixed(decimals);
}
function getButtonText(number, questionObject) {
    var emojiNumber = {
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
function printGraph(key, ctx, numberOfRecentValuesToPrint, additionalValue, skipImage) {
    var _a, _b, _c, _d, _e;
    var userId = (_d = (_c = (_b = (_a = ctx.update) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.from) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : (_e = ctx.from) === null || _e === void 0 ? void 0 : _e.id;
    if (!userId)
        return;
    postgres.client.query({
        text: "SELECT * FROM raw_data WHERE user_id = $1 AND key = $2 ORDER BY timestamp DESC LIMIT 300",
        values: [userId, key]
    }, function (err, res) {
        if (err) {
            console.error(err);
            ctx.reply(err);
            return;
        }
        var rows = res.rows;
        console.log("Rows: " + rows.length);
        var allValues = [];
        var allTimes = [];
        var rawText = [];
        var minimum = 10000;
        var maximum = 0;
        for (var i = 0; i < rows.length; i++) {
            var time = moment(Number(rows[i].timestamp));
            var value = Number(rows[i].value);
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
            rawText.push(moment().format("YYYY-MM-DD") +
                ": " +
                Number(additionalValue).toFixed(2));
        }
        if (numberOfRecentValuesToPrint > 2) {
            ctx.reply(rawText.join("\n") + "\nMinimum: " + minimum + "\nMaximum: " + maximum);
        }
        if (numberOfRecentValuesToPrint > 0) {
            var queryToUse = "SELECT";
            var weekTimestamp = moment()
                .subtract(7, "days")
                .unix() * 1000;
            var monthTimestamp = moment()
                .subtract(30, "days")
                .unix() * 1000;
            var quarterTimestamp = moment()
                .subtract(90, "days")
                .unix() * 1000;
            var yearTimestamp = moment()
                .subtract(365, "days")
                .unix() * 1000;
            var athTimestamp = moment("2019-04-12").unix() * 1000;
            if (key == "mood") {
                athTimestamp = moment("2018-02-01").unix() * 1000;
            }
            queryToUse += "(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = " + userId + " AND timestamp > " + weekTimestamp + " AND key='" + key + "') as " + key + "Week,";
            queryToUse += "(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = " + userId + " AND timestamp > " + monthTimestamp + " AND key='" + key + "') as " + key + "Month,";
            queryToUse += "(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = " + userId + " AND timestamp > " + quarterTimestamp + " AND key='" + key + "') as " + key + "Quarter,";
            queryToUse += "(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = " + userId + " AND timestamp > " + yearTimestamp + " AND key='" + key + "') as " + key + "Year,";
            queryToUse += "(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = " + userId + " AND timestamp > " + athTimestamp + " AND key='" + key + "') as " + key + "AllTime,";
            queryToUse += "(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = " + userId + " AND id != (SELECT id FROM raw_data WHERE user_id = " + userId + " AND key='" + key + "' ORDER BY id DESC LIMIT 1) AND timestamp > " + weekTimestamp + " AND key='" + key + "') as " + key + "WeekOld,";
            queryToUse += "(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = " + userId + " AND id != (SELECT id FROM raw_data WHERE user_id = " + userId + " AND key='" + key + "' ORDER BY id DESC LIMIT 1) AND timestamp > " + monthTimestamp + " AND key='" + key + "') as " + key + "MonthOld,";
            queryToUse += "(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = " + userId + " AND id != (SELECT id FROM raw_data WHERE user_id = " + userId + " AND key='" + key + "' ORDER BY id DESC LIMIT 1) AND timestamp > " + quarterTimestamp + " AND key='" + key + "') as " + key + "QuarterOld,";
            queryToUse += "(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = " + userId + " AND id != (SELECT id FROM raw_data WHERE user_id = " + userId + " AND key='" + key + "' ORDER BY id DESC LIMIT 1) AND timestamp > " + yearTimestamp + " AND key='" + key + "') as " + key + "YearOld,";
            queryToUse += "(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = " + userId + " AND id != (SELECT id FROM raw_data WHERE user_id = " + userId + " AND key='" + key + "' ORDER BY id DESC LIMIT 1) AND timestamp > " + athTimestamp + " AND key='" + key + "') as " + key + "AllTimeOld,";
            var previousYearStart = moment()
                .subtract(365 * 2, "days")
                .unix() * 1000;
            var previousYearEnd = moment()
                .subtract(365, "days")
                .unix() * 1000;
            queryToUse += "(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = " + userId + " AND timestamp > " + previousYearStart + " AND timestamp < " + previousYearEnd + " AND key='" + key + "') as " + key + "PreviousYear,";
            queryToUse += "(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = " + userId + " AND timestamp < " + previousYearEnd + " AND key='" + key + "') as " + key + "BeforeLastYear,";
            var previousQuarterStart = moment()
                .subtract(90 * 2, "days")
                .unix() * 1000;
            var previousQuarterEnd = moment()
                .subtract(90, "days")
                .unix() * 1000;
            queryToUse += "(SELECT ROUND(AVG(value::numeric), 4) FROM raw_data WHERE user_id = " + userId + " AND timestamp > " + previousQuarterStart + " AND timestamp < " + previousQuarterEnd + " AND key='" + key + "') as " + key + "PreviousQuarter";
            console.log(queryToUse);
            postgres.client.query({
                text: queryToUse
            }, function (err, res) {
                var rows = ["week", "month", "quarter", "year", "alltime"];
                var c = res.rows[0];
                console.log(c);
                var finalText = ["Moving averages for " + key];
                for (var i = 0; i < rows.length; i++) {
                    var newValue = c[key.toLowerCase() + rows[i]];
                    var oldValue = c[key.toLowerCase() + rows[i] + "old"];
                    var stringToPush = roundNumberExactly(newValue, 2) +
                        " - " +
                        rows[i] +
                        " (" +
                        (newValue - oldValue > 0 ? "+" : "") +
                        roundNumberExactly(newValue - oldValue, 2) +
                        ")";
                    if (rows[i] == "quarter") {
                        var newQuarterValue = c[key.toLowerCase() + "previousquarter"];
                        stringToPush +=
                            "\n   " +
                                roundNumberExactly(newQuarterValue, 2) +
                                " - Previous Quarter (" +
                                (newValue - newQuarterValue > 0 ? "+" : "") +
                                roundNumberExactly(newValue - newQuarterValue, 2) +
                                ")";
                    }
                    if (rows[i] == "year") {
                        var newYearValue = c[key.toLowerCase() + "previousyear"];
                        stringToPush +=
                            "\n   " +
                                roundNumberExactly(newYearValue, 2) +
                                " - Previous Year (" +
                                (newValue - newYearValue > 0 ? "+" : "") +
                                roundNumberExactly(newValue - newYearValue, 2) +
                                ")";
                        var newBeforeLastYearValue = c[key.toLowerCase() + "beforelastyear"];
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
            });
        }
    });
}
function triggerNextQuestionFromQueue(ctx) {
    var state = getState(ctx);
    var keyboard = Extra.markup(function (m) { return m.removeKeyboard(); });
    var questionAppendix = "";
    state.currentlyAskedQuestionObject = state.currentlyAskedQuestionQueue.shift();
    if (state.currentlyAskedQuestionObject == null) {
        ctx.reply("All done for now, let's do this 💪", keyboard);
        return;
    }
    var currentQuestion = state.currentlyAskedQuestionObject;
    if (currentQuestion.question == null) {
        console.error("No text defined for");
        console.error(currentQuestion);
    }
    if (currentQuestion.type == "header") {
        ctx
            .reply(currentQuestion.question, keyboard)
            .then(function () {
            triggerNextQuestionFromQueue(ctx);
        });
        return;
    }
    if (currentQuestion.type == "range") {
        var allButtons = [
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
    }
    else if (currentQuestion.type == "boolean") {
        keyboard = Markup.keyboard([["1: Yes"], ["0: No"]])
            .oneTime()
            .extra();
    }
    else if (currentQuestion.type == "text") {
        questionAppendix +=
            "You can use a Bear note, and then paste the deep link to the note here";
    }
    else if (currentQuestion.type == "location") {
        keyboard = Extra.markup(function (markup) {
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
    var question = currentQuestion.question + " (" + questionAppendix + ")";
    ctx.reply(question, keyboard).then(function (_a) {
        var message_id = _a.message_id;
        state.currentlyAskedQuestionMessageId = message_id;
    });
    if (currentQuestion.type == "number" ||
        currentQuestion.type == "range" ||
        currentQuestion.type == "boolean") {
        printGraph(currentQuestion.key, ctx, 0, null, false);
    }
}
function shuffleArray(array) {
    var _a;
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        _a = [array[j], array[i]], array[i] = _a[0], array[j] = _a[1];
    }
}
function insertNewValue(parsedUserValue, ctx, key, type, fakeDate) {
    var _a, _b, _c, _d, _e;
    if (fakeDate === void 0) { fakeDate = null; }
    console.log("Inserting value '" + parsedUserValue + "' for key " + key);
    var userId = (_d = (_c = (_b = (_a = ctx.update) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.from) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : (_e = ctx.from) === null || _e === void 0 ? void 0 : _e.id;
    if (!userId)
        return;
    var dateToAdd;
    if (fakeDate) {
        dateToAdd = fakeDate;
    }
    else {
        dateToAdd = moment(ctx.update.message.date * 1000);
    }
    var state = getState(ctx);
    var questionText = null;
    if (state.currentlyAskedQuestionObject) {
        questionText = state.currentlyAskedQuestionObject.question;
    }
    var row = {
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
    var keys = Object.keys(row);
    var reserved = ["key", "type", "value", "year", "month", "day", "hour", "minute"];
    var quotedKeys = keys.map(function (k) { return (reserved.indexOf(k) >= 0 ? '"' + k + '"' : k); });
    var placeholders = keys.map(function (_, i) { return "$" + (i + 1); }).join(", ");
    postgres.client.query({
        text: "INSERT INTO raw_data (" +
            quotedKeys.join(", ") +
            ") VALUES (" + placeholders + ")",
        values: Object.values(row)
    }, function (err, res) {
        if (err) {
            ctx.reply("Error saving value: " + err);
            console.log(err.stack);
        }
        else {
        }
    });
    if (ctx) {
    }
}
function parseUserInput(ctx, text) {
    if (text === void 0) { text = null; }
    var state = getState(ctx);
    if (state.currentlyAskedQuestionMessageId == null) {
        ctx
            .reply("Sorry, I forgot the question I asked, this usually means it took too long for you to respond, please trigger the question again by running the `/` command")
            .then(function () {
            sendAvailableCommands(ctx);
        });
        return;
    }
    var userValue;
    if (text != null) {
        userValue = text;
    }
    else {
        userValue = ctx.match[1];
    }
    var parsedUserValue = null;
    var currentQuestion = state.currentlyAskedQuestionObject;
    if (!currentQuestion)
        return;
    if (currentQuestion.type != "text") {
        if (currentQuestion.type == "range" ||
            currentQuestion.type == "boolean") {
            var tryToParseNumber = parseInt(userValue[0]);
            if (!isNaN(tryToParseNumber)) {
                parsedUserValue = tryToParseNumber;
            }
            else {
                ctx.reply("Sorry, looks like your input is invalid, please enter a valid number from the selection", Extra.inReplyTo(ctx.update.message.message_id));
            }
        }
        if (parsedUserValue == null) {
            var match = userValue.match(/^(\d+(\.\d+)?)$/);
            if (match == null) {
                ctx.reply("Sorry, looks like you entered an invalid number, please try again", Extra.inReplyTo(ctx.update.message.message_id));
                return;
            }
            parsedUserValue = match[1];
        }
    }
    else {
        parsedUserValue = userValue;
    }
    if (currentQuestion.type == "range") {
        if (parsedUserValue < 0 || parsedUserValue > 6) {
            ctx.reply("Please enter a value from 0 to 6", Extra.inReplyTo(ctx.update.message.message_id));
            return;
        }
    }
    if (currentQuestion.type == "number" ||
        currentQuestion.type == "range" ||
        currentQuestion.type == "boolean") {
        printGraph(currentQuestion.key, ctx, 2, parsedUserValue, true);
    }
    console.log("Got a new value: " +
        parsedUserValue +
        " for question " +
        currentQuestion.key);
    if (currentQuestion.replies &&
        currentQuestion.replies[parsedUserValue]) {
        ctx.reply(currentQuestion.replies[parsedUserValue], Extra.inReplyTo(ctx.update.message.message_id));
    }
    insertNewValue(parsedUserValue, ctx, currentQuestion.key, currentQuestion.type);
    setTimeout(function () {
        triggerNextQuestionFromQueue(ctx);
    }, 50);
}
function sendAvailableCommands(ctx) {
    ctx.reply("Available commands:").then(function (_a) {
        var message_id = _a.message_id;
        ctx.reply("\n\n/skip\n/report\n\n/" + Object.keys(config.userConfig).join("\n/"));
    });
}
function saveLastRun(ctx, command) {
    var _a, _b, _c, _d, _e;
    var userId = (_d = (_c = (_b = (_a = ctx.update) === null || _a === void 0 ? void 0 : _a.message) === null || _b === void 0 ? void 0 : _b.from) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : (_e = ctx.from) === null || _e === void 0 ? void 0 : _e.id;
    if (!userId)
        return;
    postgres.client.query({
        text: "INSERT INTO last_run (user_id, command, last_run) VALUES ($1, $2, $3) " +
            "ON CONFLICT (user_id, command) DO UPDATE SET last_run = $3",
        values: [userId, command, moment().valueOf()]
    }, function (err, res) {
        if (err) {
            console.log(err.stack);
        }
        else {
            console.log("Stored timestamp of last run for " + command + " user " + userId);
        }
    });
}
function initBot() {
    console.log("Launching up Telegram bot...");
    bot.hears(/^([^\/].*)$/, function (ctx) {
        ensureUserRegistered(ctx);
        parseUserInput(ctx);
    });
    bot.hears("/skip", function (ctx) {
        ensureUserRegistered(ctx);
        console.log("user is skipping this question");
        ctx.reply("Okay, skipping question. If you see yourself skipping a question too often, maybe it's time to rephrase or remove it");
        triggerNextQuestionFromQueue(ctx);
    });
    bot.hears("/skip_all", function (ctx) {
        ensureUserRegistered(ctx);
        var state = getState(ctx);
        state.currentlyAskedQuestionQueue = [];
        triggerNextQuestionFromQueue(ctx);
        ctx.reply("Okay, removing all questions that are currently in the queue");
    });
    bot.hears(/\/track (\w+)/, function (ctx) {
        ensureUserRegistered(ctx);
        var toTrack = ctx.match[1];
        console.log("User wants to track a specific value, without the whole survey: " +
            toTrack);
        var questionToAsk = null;
        Object.keys(config.userConfig).forEach(function (key) {
            var survey = config.userConfig[key];
            for (var i = 0; i < survey.questions.length; i++) {
                var currentQuestion = survey.questions[i];
                if (currentQuestion.key == toTrack) {
                    questionToAsk = currentQuestion;
                    return;
                }
            }
        });
        if (questionToAsk) {
            var state = getState(ctx);
            state.currentlyAskedQuestionQueue = state.currentlyAskedQuestionQueue.concat(questionToAsk);
            triggerNextQuestionFromQueue(ctx);
        }
        else {
            ctx.reply("Sorry, I couldn't find the key `" +
                toTrack +
                "`, please make sure it's not mispelled");
        }
    });
    bot.hears(/\/graph (\w+)/, function (ctx) {
        ensureUserRegistered(ctx);
        var key = ctx.match[1];
        console.log("User wants to graph a specific value " + key);
        printGraph(key, ctx, 100, null, false);
    });
    bot.on("location", function (ctx) {
        ensureUserRegistered(ctx);
        var state = getState(ctx);
        if (state.currentlyAskedQuestionMessageId == null) {
            ctx
                .reply("Sorry, I forgot the question I asked, this usually means it took too long for you to respond, please trigger the question again by running the `/` command")
                .then(function (_a) {
                var message_id = _a.message_id;
                sendAvailableCommands(ctx);
            });
            return;
        }
        var location = ctx.update.message.location;
        var lat = location.latitude;
        var lng = location.longitude;
        insertNewValue(lat, ctx, "locationLat", "number");
        insertNewValue(lng, ctx, "locationLng", "number");
        triggerNextQuestionFromQueue(ctx);
    });
    bot.hears(/\/(\w+)/, function (ctx) {
        ensureUserRegistered(ctx);
        var command = ctx.match[1];
        var matchingCommandObject = config.userConfig[command];
        var state = getState(ctx);
        if (matchingCommandObject && matchingCommandObject.questions) {
            console.log("User wants to run: " + command);
            saveLastRun(ctx, command);
            if (state.currentlyAskedQuestionQueue.length > 0 &&
                state.currentlyAskedQuestionMessageId) {
                ctx.reply("^ Okay, but please answer my previous question also, thanks ^", Extra.inReplyTo(state.currentlyAskedQuestionMessageId));
            }
            state.currentlyAskedQuestionQueue = state.currentlyAskedQuestionQueue.concat(matchingCommandObject.questions.slice(0));
            if (state.currentlyAskedQuestionObject == null) {
                triggerNextQuestionFromQueue(ctx);
            }
        }
        else {
            ctx
                .reply("Sorry, I don't know how to run `/" + command)
                .then(function (_a) {
                var message_id = _a.message_id;
                sendAvailableCommands(ctx);
            });
        }
    });
    bot.start(function (ctx) {
        ensureUserRegistered(ctx);
        ctx.reply("Welcome to LifeSheet! Use / to see available commands.");
    });
    bot.help(function (ctx) {
        return ctx.reply("No in-bot help right now, for now please visit https://github.com/KrauseFx/FxLifeSheet");
    });
    bot.on("sticker", function (ctx) { return ctx.reply("Sorry, I don't support stickers"); });
    bot.hears("hi", function (ctx) { return ctx.reply("Hey there"); });
    bot.launch();
}
//# sourceMappingURL=worker.js.map