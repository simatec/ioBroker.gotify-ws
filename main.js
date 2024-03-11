'use strict';

const WebSocket = require('ws');
const utils = require('@iobroker/adapter-core');
const adapterName = require('./package.json').name.split('.').pop();

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
		this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	async onReady() {
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
				clearTimeout(timer);
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
					// eslint-disable-next-line prefer-const
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
							label: 'none',
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

					// eslint-disable-next-line prefer-const
					let resultUser = [{ label: 'All Receiver', value: 'allTelegramUsers' }];

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
		}
	}

	async connectWebSocket() {
		if (this.config.ip && this.config.port) {
			const uri = `ws://${this.config.ip}:${this.config.port}/stream`;

			ws = new WebSocket(uri, {
				headers: {
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
					timer = setTimeout(this.connectWebSocket, 5000);
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
						const message = line.message.replace(/[`]/g, '');
						const formatMessage = message.replace(/[']/g, '"');
						const title =
							line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : 'Gotifi WS Message';

						try {
							this.sendTo(this.config.telegramInstance, 'send', {
								text: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
							});
						} catch (err) {
							this.log.warn(`Error sending Telegram message: ${err}`);
						}
					}
					break;
				case 'email':
					if (this.config.emailInstance && this.config.emailReceiver && this.config.emailSender) {
						const message = line.message.replace(/[`]/g, '');
						const formatMessage = message.replace(/[']/g, '"');
						const title =
							line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : 'Gotifi WS Message';

						try {
							this.sendTo(this.config.emailInstance, 'send', {
								text: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
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
						const message = line.message.replace(/[`]/g, '');
						const formatMessage = message.replace(/[']/g, '"');
						const title =
							line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : 'Gotifi WS Message';

						try {
							this.sendTo(this.config.pushoverInstance, 'send', {
								message: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
								sound: '',
								priority: -1,
								title: title,
								device: this.config.pushoverDeviceID,
							});
						} catch (err) {
							this.log.warn(`Error sending Pushover message: ${err}`);
						}
					} else if (this.config.pushoverInstance && this.config.pushoverDeviceID) {
						const message = line.message.replace(/[`]/g, '');
						const formatMessage = message.replace(/[']/g, '"');
						const title =
							line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : 'Gotifi WS Message';

						try {
							this.sendTo(this.config.pushoverInstance, 'send', {
								message: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
								sound: '',
								title: title,
								device: this.config.pushoverDeviceID,
							});
						} catch (err) {
							this.log.warn(`Error sending Pushover message: ${err}`);
						}
					}
					break;
				case 'whatsapp-cmb':
					if (this.config.whatsappInstance) {
						const message = line.message.replace(/[`]/g, '');
						const formatMessage = message.replace(/[']/g, '"');
						const title = line.title != '' ? `*${line.title.replace(/[`]/g, '')}*` : '*Gotifi WS Message*';

						try {
							this.sendTo(this.config.whatsappInstance, 'send', {
								text: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
							});
						} catch (err) {
							this.log.warn(`Error sending WhatsApp message: ${err}`);
						}
					}
					break;
				case 'signal-cmb':
					if (this.config.signalInstance) {
						const message = line.message.replace(/[`]/g, '');
						const formatMessage = message.replace(/[']/g, '"');
						const title =
							line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : 'Gotifi WS Message';

						try {
							this.sendTo(this.config.signalInstance, 'send', {
								text: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
							});
						} catch (err) {
							this.log.warn(`Error sending Signal message: ${err}`);
						}
					}
					break;
				case 'matrix':
					if (this.config.matrixInstance) {
						const message = line.message.replace(/[`]/g, '');
						const formatMessage = message.replace(/[']/g, '"');
						const title =
							line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : 'Gotifi WS Message';

						try {
							this.sendTo(this.config.matrixInstance, {
								text: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
							});
						} catch (err) {
							this.log.warn(`Error sending Matrix message: ${err}`);
						}
					}
					break;
				case 'discord':
					if (this.config.discordInstance && this.config.discordTarget) {
						const message = line.message.replace(/[`]/g, '');
						const formatMessage = message.replace(/[']/g, '"');
						const title =
							line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : 'Gotifi WS Message';

						if (this.config.discordTarget.match(/^\d+$/)) {
							// send to a single user
							try {
								this.sendTo(this.config.discordInstance, 'sendMessage', {
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
								this.sendTo(this.config.discordInstance, 'sendMessage', {
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
}

if (require.main !== module) {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new GotifyWs(options);
} else {
	new GotifyWs();
}
