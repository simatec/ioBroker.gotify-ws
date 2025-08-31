"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var import_ws = __toESM(require("ws"));
var utils = __toESM(require("@iobroker/adapter-core"));
class GotifyWs extends utils.Adapter {
  systemLang = "de";
  ws;
  timer = void 0;
  stopNow = false;
  constructor(options = {}) {
    super({
      ...options,
      name: "gotify-ws"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    const sysLang = await this.getForeignObjectAsync("system.config");
    if (sysLang && sysLang.common && sysLang.common.language) {
      this.systemLang = sysLang.common.language;
    }
    await this.setState("info.connection", false, true);
    this.connectWebSocket();
  }
  async onUnload(callback) {
    await this.setState("info.connection", false, true);
    try {
      if (this.ws) {
        this.stopNow = true;
        this.ws.close();
        this.ws.terminate();
        this.clearTimeout(this.timer);
        this.timer = null;
      }
      callback();
    } catch (e) {
      callback();
    }
  }
  async onMessage(obj) {
    switch (obj == null ? void 0 : obj.command) {
      case "sendToInstance":
        if (obj && obj.command === "sendToInstance" && obj.message && obj.message.type) {
          const resultInstances = [];
          const instances = await this.getObjectViewAsync("system", "instance", {
            startkey: `system.adapter.${obj.message.type}.`,
            endkey: `system.adapter.${obj.message.type}.\u9999`
          }).catch((err) => this.log.error(err));
          if (instances && instances.rows && instances.rows.length != 0) {
            instances.rows.forEach((row) => {
              resultInstances.push({
                label: row.id.replace("system.adapter.", ""),
                value: row.id.replace("system.adapter.", "")
              });
            });
          } else {
            resultInstances.push({
              label: this._("none", this.systemLang),
              value: "none"
            });
          }
          this.log.debug(`sendToInstance - ${JSON.stringify(obj)}`);
          this.sendTo(obj.from, obj.command, resultInstances, obj.callback);
        }
        break;
      case "sendToTelegramUser": {
        let useUsername = false;
        if (obj && obj.command === "sendToTelegramUser" && obj.message && obj.message.instance) {
          const inst = obj.message.instance ? obj.message.instance : this.config.telegramInstance;
          const userList = await this.getForeignStateAsync(`${inst}.communicate.users`);
          const configTelegram = await this.getForeignObjectAsync(`system.adapter.${inst}`);
          if (configTelegram && configTelegram.native) {
            const native = configTelegram.native;
            useUsername = native.useUsername;
          }
          const resultUser = [{ label: this._("All Receiver", this.systemLang), value: "allTelegramUsers" }];
          if (userList && (userList == null ? void 0 : userList.val)) {
            const users = JSON.parse(userList == null ? void 0 : userList.val);
            for (const i in users) {
              resultUser.push({
                label: useUsername === true ? users[i].userName : users[i].firstName,
                value: useUsername === true ? users[i].userName : users[i].firstName
              });
            }
            try {
              this.sendTo(obj.from, obj.command, resultUser, obj.callback);
            } catch (err) {
              this.log.error(`Cannot parse stored user IDs from Telegram: ${err}`);
            }
          }
        }
        break;
      }
      case "sendToDiscordTarget":
        if (obj && obj.command === "sendToDiscordTarget" && obj.message && obj.message.instance) {
          const resultTarget = [{ label: this._("none", this.systemLang), value: "none" }];
          const targetList = await this.sendToAsync(obj.message.instance, "getNotificationTargets", {});
          if (Array.isArray(targetList)) {
            for (const i in targetList) {
              resultTarget.push({
                label: targetList[i].value,
                value: targetList[i].value
              });
            }
          }
          try {
            this.sendTo(obj.from, obj.command, resultTarget, obj.callback);
          } catch (err) {
            this.log.error(`Cannot parse stored user IDs from Discord: ${err}`);
          }
        } else if (obj && obj.command === "sendToDiscordTarget") {
          const resultTarget = [{ label: this._("none", this.systemLang), value: "none" }];
          try {
            this.sendTo(obj.from, obj.command, resultTarget, obj.callback);
          } catch (err) {
            this.log.error(`Cannot parse stored user IDs from Discord: ${err}`);
          }
        }
        break;
    }
  }
  connectWebSocket() {
    if (this.config.ip && this.config.port) {
      const uri = `ws://${this.config.ip}:${this.config.port}/stream`;
      this.ws = new import_ws.default(uri, {
        headers: {
          "X-Gotify-Key": this.config.token
        }
      });
      this.ws.on("open", async () => {
        await this.setState("info.connection", true, true);
        this.log.info("WebSocket connected");
      });
      this.ws.on("message", async (data) => {
        if (typeof data !== "string" && !Buffer.isBuffer(data)) {
          this.log.warn("Unexpected WebSocket message format");
          return;
        }
        const message = typeof data === "string" ? data : data.toString("utf-8");
        const line = JSON.parse(message);
        await this.pushMessage(line);
      });
      this.ws.on("close", async () => {
        await this.setState("info.connection", false, true);
        this.log.info("WebSocket closed");
        if (this.stopNow === false) {
          this.timer = this.setTimeout(this.connectWebSocket, 5e3);
        }
      });
      this.ws.on("error", async (err) => {
        await this.setState("info.connection", false, true);
        this.log.error(`WebSocket error: ${err}`);
      });
    } else {
      this.log.error("WebSocket error: Please check your Configuration");
    }
  }
  async pushMessage(line) {
    if (this.config.notificationType) {
      switch (this.config.notificationType) {
        case "telegram":
          if (this.config.telegramUser && this.config.telegramUser === "allTelegramUsers" && this.config.telegramInstance) {
            const formatMessage = line.message.replace(/[`]/g, "").replace(/[']/g, '"');
            const title = line.title != "" ? `<b>${line.title.replace(/[`]/g, "")}</b>` : "<b>Gotifi WS Message</b>";
            try {
              await this.sendToAsync(this.config.telegramInstance, "send", {
                parse_mode: "HTML",
                text: `${title != "" ? `${title}
` : ""}${formatMessage}`
              });
            } catch (err) {
              this.log.warn(`Error sending Telegram message: ${err}`);
            }
          } else if (this.config.telegramUser && this.config.telegramUser != "allTelegramUsers" && this.config.telegramInstance) {
            const formatMessage = line.message.replace(/[`]/g, "").replace(/[']/g, '"');
            const title = line.title != "" ? `<b>${line.title.replace(/[`]/g, "")}</b>` : "<b>Gotifi WS Message</b>";
            try {
              await this.sendToAsync(this.config.telegramInstance, "send", {
                user: this.config.telegramUser,
                parse_mode: "HTML",
                text: `${title != "" ? `${title}
` : ""}${formatMessage}`
              });
            } catch (err) {
              this.log.warn(`Error sending Telegram message: ${err}`);
            }
          }
          break;
        case "email":
          if (this.config.emailInstance && this.config.emailReceiver && this.config.emailSender) {
            const formatMessage = line.message.replace(/[`]/g, "").replace(/[']/g, '"');
            const title = line.title != "" ? line.title.replace(/[`]/g, "") : "Gotifi WS Message";
            try {
              await this.sendToAsync(this.config.emailInstance, "send", {
                text: formatMessage,
                to: this.config.emailReceiver,
                subject: title,
                from: this.config.emailSender
              });
            } catch (err) {
              this.log.warn(`Error sending E-Mail message: ${err}`);
            }
          }
          break;
        case "pushover":
          if (this.config.pushoverSilentNotice === true && this.config.pushoverInstance && this.config.pushoverDeviceID) {
            const formatMessage = line.message.replace(/[`]/g, "").replace(/[']/g, '"');
            const title = line.title != "" ? `<b>${line.title.replace(/[`]/g, "")}</b>` : "<b>Gotifi WS Message</b>";
            try {
              await this.sendToAsync(this.config.pushoverInstance, "send", {
                message: `${title != "" ? `${title}
` : ""}${formatMessage}`,
                sound: "",
                priority: -1,
                title,
                device: this.config.pushoverDeviceID,
                html: 1
              });
            } catch (err) {
              this.log.warn(`Error sending Pushover message: ${err}`);
            }
          } else if (this.config.pushoverInstance && this.config.pushoverDeviceID) {
            const formatMessage = line.message.replace(/[`]/g, "").replace(/[']/g, '"');
            const title = line.title != "" ? `<b>${line.title.replace(/[`]/g, "")}</b>` : "<b>Gotifi WS Message</b>";
            try {
              await this.sendToAsync(this.config.pushoverInstance, "send", {
                message: `${title != "" ? `${title}
` : ""}${formatMessage}`,
                sound: "",
                title,
                device: this.config.pushoverDeviceID,
                html: 1
              });
            } catch (err) {
              this.log.warn(`Error sending Pushover message: ${err}`);
            }
          }
          break;
        case "whatsapp-cmb":
          if (this.config.whatsappInstance) {
            const formatMessage = line.message.replace(/[`]/g, "").replace(/[']/g, '"');
            const title = line.title != "" ? `*${line.title.replace(/[`]/g, "")}*` : "*Gotifi WS Message*";
            try {
              await this.sendToAsync(this.config.whatsappInstance, "send", {
                text: `${title != "" ? `${title}
` : ""}${formatMessage}`
              });
            } catch (err) {
              this.log.warn(`Error sending WhatsApp message: ${err}`);
            }
          }
          break;
        case "notification-manager":
          if (this.config.notificationManagerInstance) {
            const formatMessage = line.message.replace(/[`]/g, "").replace(/[']/g, '"');
            const title = line.title != "" ? `<b>${line.title.replace(/[`]/g, "")}</b>` : "<b>Gotifi WS Message</b>";
            try {
              await this.sendToAsync(
                this.config.notificationManagerInstance,
                "registerUserNotification",
                {
                  category: "notify",
                  message: `${title != "" ? `${title}
` : ""}${formatMessage}`
                }
              );
            } catch (err) {
              this.log.warn(`Error sending Notification-Manager message: ${err}`);
            }
          }
          break;
        case "signal-cmb":
          if (this.config.signalInstance) {
            const formatMessage = line.message.replace(/[`]/g, "").replace(/[']/g, '"');
            const title = line.title != "" ? line.title.replace(/[`]/g, "") : "Gotifi WS Message";
            try {
              await this.sendToAsync(this.config.signalInstance, "send", {
                text: `${title != "" ? `${title}
` : ""}${formatMessage}`
              });
            } catch (err) {
              this.log.warn(`Error sending Signal message: ${err}`);
            }
          }
          break;
        case "matrix-org":
          if (this.config.matrixInstance) {
            const formatMessage = line.message.replace(/[`]/g, "").replace(/[']/g, '"');
            const title = line.title != "" ? `<b>${line.title.replace(/[`]/g, "")}</b>` : "<b>Gotifi WS Message</b>";
            try {
              await this.sendToAsync(this.config.matrixInstance, {
                html: `${title != "" ? `${title}
` : ""}${formatMessage}`
              });
            } catch (err) {
              this.log.warn(`Error sending Matrix message: ${err}`);
            }
          }
          break;
        case "discord":
          if (this.config.discordInstance && this.config.discordTarget) {
            const formatMessage = line.message.replace(/[`]/g, "").replace(/[']/g, '"');
            const title = line.title != "" ? `<b>${line.title.replace(/[`]/g, "")}</b>` : "Gotifi WS Message";
            if (this.config.discordTarget.match(/^\d+$/)) {
              try {
                await this.sendToAsync(this.config.discordInstance, "sendMessage", {
                  userId: this.config.discordTarget,
                  content: `${title != "" ? `${title}
` : ""}${formatMessage}`
                });
              } catch (err) {
                this.log.warn(`Error sending Discord message: ${err}`);
              }
            } else if (this.config.discordTarget.match(/^\d+\/\d+$/)) {
              const [serverId, channelId] = this.config.discordTarget.split("/");
              try {
                await this.sendToAsync(this.config.discordInstance, "sendMessage", {
                  serverId,
                  channelId,
                  content: `${title != "" ? `${title}
` : ""}${formatMessage}`
                });
              } catch (err) {
                this.log.warn(`Error sending Discord message: ${err}`);
              }
            }
          }
          break;
      }
    } else {
      this.log.error("Push-Message error: Please check your Configuration");
    }
  }
  async _(word, systemLang) {
    return new Promise((resolve) => {
      void (async () => {
        const translations = await Promise.resolve().then(() => __toESM(require(`../admin/i18n/${systemLang ? systemLang : "en"}/translations.json`)));
        if (translations[word]) {
          resolve(translations[word]);
        } else {
          this.log.debug(`Please translate in translations.json: ${word}`);
          resolve(word);
        }
      })();
    });
  }
}
if (require.main !== module) {
  module.exports = (options) => new GotifyWs(options);
} else {
  (() => new GotifyWs())();
}
//# sourceMappingURL=main.js.map
