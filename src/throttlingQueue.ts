type Task<T> = {
    action: () => Promise<T>;
    key: string;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
};

class TPromise<T> extends Promise<T> {
    public newer?: Promise<T>;
}

/**
 * Run tasks one by one, allows throttling by key
 */
export class ThrottlingQueue<T> {
    private readonly _items: Task<T>[] = [];
    private readonly _keys = new Map<string, TPromise<T>>();
    private _loopRunning: boolean = false;

    enqueue(action: () => Promise<T>, key: string): Promise<T> {
        const existing = this._keys.get(key);
        if (existing) {
            if (!existing.newer) {
                existing.newer = new Promise<T>((resolve, reject) => {
                    this._items.push({ action, resolve, reject, key });
                });
            }
            return existing.newer;
        }
        const promise = this._new(action, key);
        this._keys.set(key, promise);
        return promise;
    }

    private _new(action: () => Promise<T>, key: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this._items.push({ action, resolve, reject, key });
            this._task_loop();
        });
    }

    private _delete(key: string): void {
        const promise = this._keys.get(key)!;
        this._keys.delete(key);
        if (promise.newer) {
            this._keys.set(key, promise!.newer);
        }
    }

    private async _task_loop(): Promise<void> {
        if (this._loopRunning) {
            return;
        }

        const item = this._items.shift();

        if (item) {
            this._loopRunning = true;
            try {
                const payload = await item.action();
                this._loopRunning = false;
                item.resolve(payload);
            } catch (reason) {
                this._loopRunning = false;
                item.reject(reason);
            } finally {
                this._delete(item.key);
                this._task_loop();
            }
        }
    }
}

type ObjectOfType<T, U> = {
    [K in keyof T]: T[K] extends U ? K : never;
};

type KeysOfType<T, U> = ObjectOfType<T, U>[keyof T];

export function queue<This extends Record<string, any>>(
    queue_name: KeysOfType<This, ThrottlingQueue<any>>,
    queueKey: string
) {
    return function (
        target: This,
        key: string,
        descriptor: TypedPropertyDescriptor<
            (this: This, ...args: any[]) => Promise<any>
        >
    ) {
        const fn = descriptor.value!;

        descriptor.value = function (this: This, ...args: any[]): Promise<any> {
            return this[queue_name].enqueue(fn.bind(this, ...args), queueKey);
        };
    };
}
