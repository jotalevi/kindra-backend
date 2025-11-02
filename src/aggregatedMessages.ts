export default class AggregatedMessages {
    userId: string;
    messages: { timestamp: number; content: string }[];
    private timeout: number;
    timeoutHandle: NodeJS.Timeout | null;
    callback: ((messages: { timestamp: number; content: string }[]) => void);

    constructor(userId: string, callback: ((messages: { timestamp: number; content: string }[]) => void) = () => { }, timeout: number = 10000) {
        this.userId = userId;
        this.messages = [];
        this.timeout = timeout;
        this.timeoutHandle = null;
        this.callback = callback;
    }

    pushMessage(message: { timestamp: number; content: string }): void {
        if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
        this.timeoutHandle = setTimeout(() => {
            this.callback(this.messages);
        }, this.timeout);

        this.messages.push(message);
    }
}