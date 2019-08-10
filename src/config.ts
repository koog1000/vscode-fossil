import { workspace } from "vscode"

export type PushPullScopeOptions = "default" | "current" | "all" | undefined;

const DEFAULT_AUTO_IN_OUT_INTERVAL_SECONDS = 3 * 60 /* three minutes */;

class Config {
    private get config() {
        return workspace.getConfiguration('fossil');
    }

    private get<T>(name: keyof Config, defaultValue: T): T {
        const value = this.config.get<T>(name);
        if (value === undefined) {
            return defaultValue;
        }
        return value;
    }

    private update<T>(name: keyof Config, value: T) {
        return this.config.update(name, value);
    }

    get enabled(): boolean {
        return this.get("enabled", true);
    }

    get instrumentation(): boolean {
        return this.get("instrumentation", false);
    }

    get path(): string | undefined {
        return this.get("path", undefined);
    }

    get autoUpdate(): boolean {
        return this.get("autoUpdate", true);
    }

    get autoRefresh(): boolean {
        return this.get("autoRefresh", true);
    }

    get autoInOut(): boolean {
        return this.get("autoInOut", true);
    }

    get autoInOutInterval(): number {
        return this.get("autoInOutInterval", DEFAULT_AUTO_IN_OUT_INTERVAL_SECONDS);
    }

    get autoInOutIntervalMillis(): number {
        return this.autoInOutInterval * 1000;
    }

    get allowPushNewBranches(): boolean {
        return this.get("allowPushNewBranches", false);
    }

    get pushPullScope(): PushPullScopeOptions {
        return this.get<PushPullScopeOptions>("pushPullScope", "all");
    }

    get pushPullBranch(): PushPullScopeOptions {
        return this.get<PushPullScopeOptions>("pushPullBranch", this.pushPullScope);
    }
}

const typedConfig = new Config()
export default typedConfig