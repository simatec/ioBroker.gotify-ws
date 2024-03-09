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
	onMessage(obj) {
		if (obj.command === "sendToInstance") {
			// Send response in callback if required
			this.log.info(`sendToInstance - ${JSON.stringify(obj)}`);
			//if (obj.callback) this.sendTo(obj.from, obj.command,
			//{ native: { sendTo1Ret: `${obj.message.data1} / ${obj.message.data2}`}},
			//obj.callback);
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
