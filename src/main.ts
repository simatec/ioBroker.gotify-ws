'use strict';

import WebSocket from 'ws';
import * as utils from '@iobroker/adapter-core';

class GotifyWs extends utils.Adapter {
    private systemLang: string = 'de';
    private ws!: WebSocket;
    private timer: ioBroker.Timeout | undefined = undefined;
    private stopNow: boolean | undefined = false;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'gotify-ws',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        const sysLang = await this.getForeignObjectAsync('system.config');

        if (sysLang && sysLang.common && sysLang.common.language) {
            this.systemLang = sysLang.common.language;
        }

        await this.setState('info.connection', false, true);
        this.connectWebSocket();
    }

    private async onUnload(callback: () => void): Promise<void> {
        await this.setState('info.connection', false, true);

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

    private async onMessage(obj: ioBroker.Message | null): Promise<void> {
        switch (obj?.command) {
            case 'sendToInstance':
                if (obj && obj.command === 'sendToInstance' && obj.message && obj.message.type) {
                    const resultInstances = [];

                    const instances = await this.getObjectViewAsync('system', 'instance', {
                        startkey: `system.adapter.${obj.message.type}.`,

                        endkey: `system.adapter.${obj.message.type}.\u9999`,
                    }).catch(err => this.log.error(err));

                    if (instances && instances.rows && instances.rows.length != 0) {
                        instances.rows.forEach(row => {
                            resultInstances.push({
                                label: row.id.replace('system.adapter.', ''),
                                value: row.id.replace('system.adapter.', ''),
                            });
                        });
                    } else {
                        resultInstances.push({
                            label: this._('none', this.systemLang),
                            value: 'none',
                        });
                    }
                    this.log.debug(`sendToInstance - ${JSON.stringify(obj)}`);
                    this.sendTo(obj.from, obj.command, resultInstances, obj.callback);
                }
                break;

            case 'sendToTelegramUser': {
                let useUsername = false;

                if (obj && obj.command === 'sendToTelegramUser' && obj.message && obj.message.instance) {
                    const inst = obj.message.instance ? obj.message.instance : this.config.telegramInstance;
                    const userList = (await this.getForeignStateAsync(`${inst}.communicate.users`)) as ioBroker.State;
                    const configTelegram = await this.getForeignObjectAsync(`system.adapter.${inst}`);

                    if (configTelegram && configTelegram.native) {
                        const native = configTelegram.native;
                        useUsername = native.useUsername;
                    }

                    const resultUser = [{ label: this._('All Receiver', this.systemLang), value: 'allTelegramUsers' }];

                    if (userList && userList?.val) {
                        const users = JSON.parse(userList?.val as string);

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
            case 'sendToDiscordTarget':
                if (obj && obj.command === 'sendToDiscordTarget' && obj.message && obj.message.instance) {
                    const resultTarget = [{ label: this._('none', this.systemLang), value: 'none' }];

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
                    const resultTarget = [{ label: this._('none', this.systemLang), value: 'none' }];

                    try {
                        this.sendTo(obj.from, obj.command, resultTarget, obj.callback);
                    } catch (err) {
                        this.log.error(`Cannot parse stored user IDs from Discord: ${err}`);
                    }
                }
                break;
        }
    }

    private connectWebSocket(): void {
        if (this.config.ip && this.config.port) {
            const uri = `ws://${this.config.ip}:${this.config.port}/stream`;

            this.ws = new WebSocket(uri, {
                headers: {
                    'X-Gotify-Key': this.config.token,
                },
            });

            this.ws.on('open', async () => {
                await this.setState('info.connection', true, true);
                this.log.info('WebSocket connected');
            });

            this.ws.on('message', async data => {
                const line = JSON.parse(data.toString('utf-8'));
                await this.pushMessage(line);
            });

            this.ws.on('close', async () => {
                await this.setState('info.connection', false, true);
                this.log.info('WebSocket closed');
                if (this.stopNow === false) {
                    this.timer = this.setTimeout(this.connectWebSocket, 5000);
                }
            });

            this.ws.on('error', async err => {
                await this.setState('info.connection', false, true);

                this.log.error(`WebSocket error: ${err}`);
            });
        } else {
            this.log.error('WebSocket error: Please check your Configuration');
        }
    }

    private async pushMessage(line: ioBroker.GotifyMessage): Promise<void> {
        if (this.config.notificationType) {
            switch (this.config.notificationType) {
                case 'telegram':
                    if (
                        this.config.telegramUser &&
                        this.config.telegramUser === 'allTelegramUsers' &&
                        this.config.telegramInstance
                    ) {
                        const formatMessage = line.message.replace(/[`]/g, '').replace(/[']/g, '"');

                        const title =
                            line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : '<b>Gotifi WS Message</b>';

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
                        const formatMessage = line.message.replace(/[`]/g, '').replace(/[']/g, '"');

                        const title =
                            line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : '<b>Gotifi WS Message</b>';

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
                        const formatMessage = line.message.replace(/[`]/g, '').replace(/[']/g, '"');

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
                        const formatMessage = line.message.replace(/[`]/g, '').replace(/[']/g, '"');

                        const title =
                            line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : '<b>Gotifi WS Message</b>';

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
                        const formatMessage = line.message.replace(/[`]/g, '').replace(/[']/g, '"');

                        const title =
                            line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : '<b>Gotifi WS Message</b>';

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
                        const formatMessage = line.message.replace(/[`]/g, '').replace(/[']/g, '"');

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
                        const formatMessage = line.message.replace(/[`]/g, '').replace(/[']/g, '"');

                        const title =
                            line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : '<b>Gotifi WS Message</b>';

                        try {
                            await this.sendToAsync(
                                this.config.notificationManagerInstance,
                                'registerUserNotification',
                                {
                                    category: 'notify',
                                    message: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
                                },
                            );
                        } catch (err) {
                            this.log.warn(`Error sending Notification-Manager message: ${err}`);
                        }
                    }
                    break;
                case 'signal-cmb':
                    if (this.config.signalInstance) {
                        const formatMessage = line.message.replace(/[`]/g, '').replace(/[']/g, '"');

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
                        const formatMessage = line.message.replace(/[`]/g, '').replace(/[']/g, '"');

                        const title =
                            line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : '<b>Gotifi WS Message</b>';

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
                        const formatMessage = line.message.replace(/[`]/g, '').replace(/[']/g, '"');

                        const title =
                            line.title != '' ? `<b>${line.title.replace(/[`]/g, '')}</b>` : 'Gotifi WS Message';

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

    private async _(word: string, systemLang: string): Promise<string> {
        return new Promise(resolve => {
            void (async () => {
                const translations = await import(`../admin/i18n/${systemLang ? systemLang : 'en'}/translations.json`);
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
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new GotifyWs(options);
} else {
    // otherwise start the instance directly
    (() => new GotifyWs())();
}
