var cron = require("node-cron");
var moment = require("moment");
var config = require("./classes/config.js");
var postgres = require("./classes/postgres.js");
var telegram = require("./classes/telegram.js");

cron.schedule(`0 * * * *`, async () => {
  console.log("Checking if we need to send a reminder to users...");

  setTimeout(function() {
    postgres.client.query(
      {
        text:
          "SELECT l.*, u.chat_id, u.preferred_question_list, u.preferred_question_yaml_url " +
          "FROM last_run l " +
          "JOIN users u ON l.user_id = u.user_id",
      },
      function(err, res) {
        if (err) {
          console.error(err);
          return;
        }
        var rows = res.rows;
        function reminderForRow(i) {
          if (i >= rows.length) {
            console.log("Reminder check done");
            return;
          }
          var currentRow = rows[i];
          var userId = currentRow.user_id;
          var chatId = currentRow.chat_id;
          var command = currentRow.command;
          var lastRun = moment(Number(currentRow.last_run));
          var pl = currentRow.preferred_question_list;
          var listId = pl == null || pl === "" ? null : String(pl);
          var yu = currentRow.preferred_question_yaml_url;
          var yamlUrl = yu == null || yu === "" ? null : String(yu);
          config.resolveQuestionCommands(listId, yamlUrl, function (err, userCmds) {
            var cmds = err ? config.getCommandsForList(null) : userCmds;
            if (cmds[command] == null) {
              console.error(
                "Error, command not found, means it's not on the last run sheet, probably due to renaming a command: " +
                  command
              );
              reminderForRow(i + 1);
              return;
            }
            var scheduleType = cmds[command].schedule;
            var timeDifferenceHours = moment().diff(moment(lastRun), "hours");
            var shouldRemindUser = false;
            if (scheduleType == "eightTimesADay") {
              if (timeDifferenceHours >= 24 / 8) {
                shouldRemindUser = true;
              }
            } else if (scheduleType == "daily") {
              if (timeDifferenceHours >= 24 * 0.95) {
                shouldRemindUser = true;
              }
            } else if (scheduleType == "weekly") {
              if (timeDifferenceHours >= 24 * 7 * 1.05) {
                shouldRemindUser = true;
              }
            } else if (scheduleType == "monthly") {
              if (timeDifferenceHours >= 24 * 30 * 1.05) {
                shouldRemindUser = true;
              }
            } else if (scheduleType == "manual") {
            } else {
              console.error("Unknown schedule type " + scheduleType);
            }
            var didJustSendMessage = false;
            if (currentRow.last_message != null) {
              var lastMessageSent = moment(Number(currentRow.last_message));
              if (moment().diff(lastMessageSent, "hours") < 8) {
                didJustSendMessage = true;
              }
            }
            console.log(
              "user " + userId + " " + command +
                ": " +
                lastRun.format() +
                " should remind? " +
                shouldRemindUser +
                " time diff in h " +
                timeDifferenceHours +
                " didJustSendMessage " +
                didJustSendMessage
            );
            if (shouldRemindUser && !didJustSendMessage) {
              console.log("Reminding user " + userId + " to run " + command + " again...");
              var textToSend =
                "Please run /" +
                command +
                " again, it's been " +
                timeDifferenceHours +
                " hours since you last filled it out";
              telegram.bot.telegram.sendMessage(chatId, textToSend);
              postgres.client.query(
                {
                  text:
                    "UPDATE last_run SET last_message = $1 WHERE user_id = $2 AND command = $3",
                  values: [moment().valueOf(), userId, command],
                },
                function(err, res) {
                  if (err) {
                    console.log(err);
                  }
                }
              );
            }
            reminderForRow(i + 1);
          });
        }
        reminderForRow(0);
      }
    );
  }, 2000);
});
