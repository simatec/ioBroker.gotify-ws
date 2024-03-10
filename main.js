"use strict";

const WebSocket = require("ws");
//const axios = require('axios');
const utils = require("@iobroker/adapter-core");
const adapterName = require("./package.json").name.split(".").pop();

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
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}

	async onReady() {
		this.setState("info.connection", false, true);
		this.connectWebSocket();
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		this.setState("info.connection", false, true);

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
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (state) {
			// The state was changed
			this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
	}
	/**
	 * @param {{ command: string; from: string; callback: ioBroker.MessageCallback | ioBroker.MessageCallbackInfo | undefined; }} obj
	 */
	async onMessage(obj) {
		// @ts-ignore
		if (obj && obj.command === "sendToInstance" && obj.message && obj.message.type) {
			// eslint-disable-next-line prefer-const
			let resultInstances = [];

			// @ts-ignore
			const instances = await this.getObjectViewAsync("system", "instance", { startkey: `system.adapter.${obj.message.type}.`, endkey: `system.adapter.${obj.message.type}.\u9999` })
				.catch(err => this.log.error(err));

			if (instances && instances.rows) {
				instances.rows.forEach(async row => {
					resultInstances.push({ label: row.id.replace("system.adapter.", ""), value: row.id.replace("system.adapter.", "") });
				});
			}
			this.log.debug(`sendToInstance - ${JSON.stringify(obj)}`);
			this.sendTo(obj.from, obj.command, resultInstances, obj.callback);
		}
	}
	async connectWebSocket() {
		const uri = `ws://${this.config.url}/stream`;
		ws = new WebSocket(uri, {
			headers: {
				"X-Gotify-Key": this.config.token,
			},
		});

		ws.on("open", () => {
			this.setState("info.connection", true, true);
			this.log.info("WebSocket connected");
		});

		ws.on("message", async (data) => {
			const line = JSON.parse(data);
			const message = line.message.replace(/[`]/g, "");
			const formatMessage = message.replace(/[']/g, '"');
			const title = line.title != "" ? `<b>${line.title.replace(/[`]/g, "")}</b>` : "";
			this.log.info(`${title != "" ? `${title}\n` : ""}${formatMessage}`);
			/*
			try {
				await axios.post(URL, {
					parse_mode: 'HTML',
					chat_id: chatid,
					text: `${title != '' ? `${title}\n` : ''}${formatMessage}`,
				});
			} catch (error) {
				console.error('Error sending message:', error);
			}
			*/
		});

		ws.on("close", () => {
			this.setState("info.connection", false, true);
			this.log.info("WebSocket closed");
			if (stop === false) {
				timer = setTimeout(this.connectWebSocket, 5000);
			}
		});

		ws.on("error", (err) => {
			this.setState("info.connection", false, true);
			// @ts-ignore
			this.log.error("WebSocket error:", err);
		});
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
