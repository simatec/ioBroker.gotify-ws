'use strict';

const WebSocket = require('ws');
const utils = require('@iobroker/adapter-core');
const adapterName = require('./package.json').name.split('.').pop();

let systemLang = 'de'; // system language
let ws = null;
let timer = null;
let stop = false;

class GotifyWs extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			// @ts-ignore
			name: adapterName,
		});
		this.on('ready', this.onReady.bind(this));
		// @ts-ignore
		this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	async onReady() {
		const sysLang = await this.getForeignObjectAsync('system.config');

		if (sysLang && sysLang.common && sysLang.common.language) {
			systemLang = sysLang.common.language;
		}

		this.setState('info.connection', false, true);
		this.connectWebSocket();
	}

	/**
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		this.setState('info.connection', false, true);

		try {
			if (ws) {
				stop = true;
				ws.close();
				ws.terminate();
				this.clearTimeout(timer);
				timer = null;
			}
			callback();
		} catch (e) {
			callback();
		}
	}

	/**
	 * @param {{ command: string; from: string; callback: ioBroker.MessageCallback | ioBroker.MessageCallbackInfo | undefined; }} obj
	 */
	async onMessage(obj) {
		switch (obj.command) {
			case 'sendToInstance':
				// @ts-ignore
				if (obj && obj.command === 'sendToInstance' && obj.message && obj.message.type) {
					let resultInstances = [];

					// @ts-ignore
					const instances = await this.getObjectViewAsync('system', 'instance', {
						// @ts-ignore
						startkey: `system.adapter.${obj.message.type}.`,
						// @ts-ignore
						endkey: `system.adapter.${obj.message.type}.\u9999`,
					}).catch((err) => this.log.error(err));

					if (instances && instances.rows && instances.rows.length != 0) {
						instances.rows.forEach(async (row) => {
							resultInstances.push({
								label: row.id.replace('system.adapter.', ''),
								value: row.id.replace('system.adapter.', ''),
							});
						});
					} else {
						resultInstances.push({
							label: this._('none', systemLang),
							value: 'none',
						});
					}
					this.log.debug(`sendToInstance - ${JSON.stringify(obj)}`);
					this.sendTo(obj.from, obj.command, resultInstances, obj.callback);
				}
				break;

			case 'sendToTelegramUser':
				// eslint-disable-next-line no-case-declarations
				let useUsername = false;

				// @ts-ignore
				if (obj && obj.command === 'sendToTelegramUser' && obj.message && obj.message.instance) {
					// @ts-ignore
					const inst = obj.message.instance ? obj.message.instance : this.config.telegramInstance;
					const userList = await this.getForeignStateAsync(`${inst}.communicate.users`);
					const configTelegram = await this.getForeignObjectAsync(`system.adapter.${inst}`);

					if (configTelegram && configTelegram.native) {
						const native = configTelegram.native;
						useUsername = native.useUsername;
					}

					let resultUser = [{ label: this._('All Receiver', systemLang), value: 'allTelegramUsers' }];

					if (userList && userList.val) {
						// @ts-ignore
						const users = JSON.parse(userList.val);

						for (const i in users) {
							resultUser.push({
								label: useUsername === true ? users[i].userName : users[i].firstName,
								value: useUsername === true ? users[i].userName : users[i].firstName,
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
			case 'sendToDiscordTarget':
				// @ts-ignore
				if (obj && obj.command === 'sendToDiscordTarget' && obj.message && obj.message.instance) {
					let resultTarget = [{ label: this._('none', systemLang), value: 'none' }];
					// @ts-ignore
					const targetList = await this.sendToAsync(obj.message.instance, 'getNotificationTargets', {});

					if (Array.isArray(targetList)) {
						for (const i in targetList) {
							resultTarget.push({
								label: targetList[i].value,
								value: targetList[i].value,
							});
						}
					}

					try {
						this.sendTo(obj.from, obj.command, resultTarget, obj.callback);
					} catch (err) {
						this.log.error(`Cannot parse stored user IDs from Discord: ${err}`);
					}
				} else if (obj && obj.command === 'sendToDiscordTarget') {
					let resultTarget = [{ label: this._('none', systemLang), value: 'none' }];

					try {
						this.sendTo(obj.from, obj.command, resultTarget, obj.callback);
					} catch (err) {
						this.log.error(`Cannot parse stored user IDs from Discord: ${err}`);
					}
				}
				break;
		}
	}

	async connectWebSocket() {
		if (this.config.ip && this.config.port) {
			const uri = `ws://${this.config.ip}:${this.config.port}/stream`;

			ws = new WebSocket(uri, {
				headers: {
					// @ts-ignore
					'X-Gotify-Key': this.config.token,
				},
			});

			ws.on('open', () => {
				this.setState('info.connection', true, true);
				this.log.info('WebSocket connected');
			});

			ws.on('message', async (data) => {
				const line = JSON.parse(data);
				this.pushMessage(line);
			});

			ws.on('close', () => {
				this.setState('info.connection', false, true);
				this.log.info('WebSocket closed');
				if (stop === false) {
					timer = this.setTimeout(this.connectWebSocket, 5000);
				}
			});

			ws.on('error', (err) => {
				this.setState('info.connection', false, true);
				// @ts-ignore
				this.log.error('WebSocket error:', err);
			});
		} else {
			this.log.error('WebSocket error: Please check your Configuration');
		}
	}

	async pushMessage(line) {
		if (this.config.notificationType) {
			switch (this.config.notificationType) {
				case 'telegram':
					if (
						this.config.telegramUser &&
						this.config.telegramUser === 'allTelegramUsers' &&
						this.config.telegramInstance
					) {
						const formatMessage = line.message
							.replace(/[`]/g, '')
							.replace(/[']/g, '"');

						const title = line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : '<b>Gotifi WS Message</b>';

						try {
							await this.sendToAsync(this.config.telegramInstance, 'send', {
								parse_mode: 'HTML',
								text: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
							});
						} catch (err) {
							this.log.warn(`Error sending Telegram message: ${err}`);
						}
					} else if (
						this.config.telegramUser &&
						this.config.telegramUser != 'allTelegramUsers' &&
						this.config.telegramInstance
					) {
						const formatMessage = line.message
							.replace(/[`]/g, '')
							.replace(/[']/g, '"');

						const title = line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : '<b>Gotifi WS Message</b>';

						try {
							await this.sendToAsync(this.config.telegramInstance, 'send', {
								user: this.config.telegramUser,
								parse_mode: 'HTML',
								text: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
							});
						} catch (err) {
							this.log.warn(`Error sending Telegram message: ${err}`);
						}
					}
					break;
				case 'email':
					if (this.config.emailInstance && this.config.emailReceiver && this.config.emailSender) {
						const formatMessage = line.message
							.replace(/[`]/g, '')
							.replace(/[']/g, '"');

						const title = line.title != '' ? line.title.replace(/[`]/g, '') : 'Gotifi WS Message';

						try {
							await this.sendToAsync(this.config.emailInstance, 'send', {
								text: formatMessage,
								to: this.config.emailReceiver,
								subject: title,
								from: this.config.emailSender,
							});
						} catch (err) {
							this.log.warn(`Error sending E-Mail message: ${err}`);
						}
					}
					break;
				case 'pushover':
					if (
						this.config.pushoverSilentNotice === true &&
						this.config.pushoverInstance &&
						this.config.pushoverDeviceID
					) {
						const formatMessage = line.message
							.replace(/[`]/g, '')
							.replace(/[']/g, '"');

						const title = line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : '<b>Gotifi WS Message</b>';

						try {
							await this.sendToAsync(this.config.pushoverInstance, 'send', {
								message: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
								sound: '',
								priority: -1,
								title: title,
								device: this.config.pushoverDeviceID,
								html: 1,
							});
						} catch (err) {
							this.log.warn(`Error sending Pushover message: ${err}`);
						}
					} else if (this.config.pushoverInstance && this.config.pushoverDeviceID) {
						const formatMessage = line.message
							.replace(/[`]/g, '')
							.replace(/[']/g, '"');

						const title = line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : '<b>Gotifi WS Message</b>';

						try {
							await this.sendToAsync(this.config.pushoverInstance, 'send', {
								message: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
								sound: '',
								title: title,
								device: this.config.pushoverDeviceID,
								html: 1,
							});
						} catch (err) {
							this.log.warn(`Error sending Pushover message: ${err}`);
						}
					}
					break;
				case 'whatsapp-cmb':
					if (this.config.whatsappInstance) {
						const formatMessage = line.message
							.replace(/[`]/g, '')
							.replace(/[']/g, '"');

						const title = line.title != '' ? `*${line.title.replace(/[`]/g, '')}*` : '*Gotifi WS Message*';

						try {
							await this.sendToAsync(this.config.whatsappInstance, 'send', {
								text: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
							});
						} catch (err) {
							this.log.warn(`Error sending WhatsApp message: ${err}`);
						}
					}
					break;
				case 'notification-manager':
					if (this.config.notificationManagerInstance) {
						const formatMessage = line.message
							.replace(/[`]/g, '')
							.replace(/[']/g, '"');

						const title = line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : '<b>Gotifi WS Message</b>';

						try {
							await this.sendToAsync(this.config.notificationManagerInstance, 'registerUserNotification', {
								category: 'notify',
								message: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
							});
						} catch (err) {
							this.log.warn(`Error sending Notification-Manager message: ${err}`);
						}
					}
					break;
				case 'signal-cmb':
					if (this.config.signalInstance) {
						const formatMessage = line.message
							.replace(/[`]/g, '')
							.replace(/[']/g, '"');

						const title = line.title != '' ? line.title.replace(/[`]/g, '') : 'Gotifi WS Message';

						try {
							await this.sendToAsync(this.config.signalInstance, 'send', {
								text: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
							});
						} catch (err) {
							this.log.warn(`Error sending Signal message: ${err}`);
						}
					}
					break;
				case 'matrix-org':
					if (this.config.matrixInstance) {
						const formatMessage = line.message
							.replace(/[`]/g, '')
							.replace(/[']/g, '"');

						const title = line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : '<b>Gotifi WS Message</b>';

						try {
							await this.sendToAsync(this.config.matrixInstance, {
								html: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
							});
						} catch (err) {
							this.log.warn(`Error sending Matrix message: ${err}`);
						}
					}
					break;
				case 'discord':
					if (this.config.discordInstance && this.config.discordTarget) {
						const formatMessage = line.message
							.replace(/[`]/g, '')
							.replace(/[']/g, '"');

						const title = line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : 'Gotifi WS Message';

						if (this.config.discordTarget.match(/^\d+$/)) {
							// send to a single user
							try {
								await this.sendToAsync(this.config.discordInstance, 'sendMessage', {
									userId: this.config.discordTarget,
									content: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
								});
							} catch (err) {
								this.log.warn(`Error sending Discord message: ${err}`);
							}
						} else if (this.config.discordTarget.match(/^\d+\/\d+$/)) {
							// send to a server channel
							const [serverId, channelId] = this.config.discordTarget.split('/');
							try {
								await this.sendToAsync(this.config.discordInstance, 'sendMessage', {
									serverId,
									channelId,
									content: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
								});
							} catch (err) {
								this.log.warn(`Error sending Discord message: ${err}`);
							}
						}
					}
					break;
			}
		} else {
			this.log.error('Push-Message error: Please check your Configuration');
		}
	}
	_(word, systemLang) {
		const translations = require(`./admin/i18n/${systemLang ? systemLang : 'en'}/translations.json`);

		if (translations[word]) {
			return translations[word];
		} else {
			this.log.debug(`Please translate in translations.json: ${word}`);
			return word;
		}
	}
}

if (require.main !== module) {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new GotifyWs(options);
} else {
	new GotifyWs();
}
