// This file extends the AdapterConfig type from "@types/iobroker"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
	namespace ioBroker {
		interface AdapterConfig {
			ip: string;
			port: number;
			notificationType: string;
			emailInstance: string;
			matrixInstance: string;
			notificationManagerInstance: string;
			pushoverInstance: string;
			discordInstance: string;
			signalInstance: string;
			telegramInstance: string;
			telegramUser: string;
			whatsappInstance: string;
			emailReceiver: string;
			emailSender: string;
			pushoverDeviceID: string;
			pushoverSilentNotice: boolean;
			discordTarget: string;
			token: string;
		}
		interface GotifyMessage {
			message: string;
			title: string;
		}
	}
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};