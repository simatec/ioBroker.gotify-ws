"use strict";

const utils = require("@iobroker/adapter-core");
const adapterName = require("./package.json").name.split(".").pop();

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
		// Reset the connection indicator during startup
		this.setState("info.connection", false, true);
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
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
		if (obj.command === "sendToInstance") {
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
}

if (require.main !== module) {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new GotifyWs(options);
} else {
	new GotifyWs();
}
