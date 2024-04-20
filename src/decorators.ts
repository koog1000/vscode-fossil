/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { done } from './util';

export function memoize<Return extends {}>(
    target: (this: Record<string, Return>) => Return,
    context: ClassGetterDecoratorContext
) {
    const memoizeKey = `$memoize$${context.name as string}`;
    return function (this: Record<string, Return>): Return {
        if (!this[memoizeKey]) {
            this[memoizeKey] = target.apply(this);
        }
        return this[memoizeKey];
    };
}
/**
 * Decorator to not allow multiple async calls
 */
export function throttle<Args extends any[], T>(
    target: (
        this: Record<string, Promise<T> | undefined>,
        ...args: Args
    ) => Promise<T>,
    context: ClassMethodDecoratorContext
) {
    const currentKey = `$thr$c$${String(context.name)}`; // $throttle$current$
    const nextKey = `$thr$n$${String(context.name)}`; // $throttle$next$

    const trigger = function (
        this: Record<string, Promise<T> | undefined>,
        ...args: Args
    ): Promise<T> {
        if (this[nextKey]) {
            return this[nextKey]!;
        }

        if (this[currentKey]) {
            this[nextKey] = done(this[currentKey]!).then(() => {
                this[nextKey] = undefined;
                return trigger.apply(this, args);
            });

            return this[nextKey]!;
        }

        this[currentKey] = target.apply(this, args);

        const clear = () => (this[currentKey] = undefined);
        done(this[currentKey]!).then(clear, clear);

        return this[currentKey]!;
    };

    return trigger;
}

// Make sure asynchronous functions are called one after another.
type ThisPromise = Record<string, Promise<any>>;

export function sequentialize<Args extends any[]>(
    target: (this: ThisPromise, ...args: Args) => Promise<any>,
    context: ClassMethodDecoratorContext
) {
    const currentKey = `$s11e$${context.name as string}`; // sequentialize

    return function (this: ThisPromise, ...args: Args): Promise<any> {
        const currentPromise =
            (this[currentKey] as Promise<any>) || Promise.resolve(null);
        const run = async () => await target.apply(this, args);
        this[currentKey] = currentPromise.then(run, run);
        return this[currentKey];
    };
}

type ThisTimer = Record<string, ReturnType<typeof setTimeout>>;

export function debounce(delay: number) {
    return function <Args extends any[]>(
        target: (this: ThisTimer, ...args: Args) => void,
        context: ClassMemberDecoratorContext
    ) {
        const timerKey = `$d6e$${String(context.name)}`; // debounce

        return function (this: ThisTimer, ...args: Args): void {
            clearTimeout(this[timerKey]);
            this[timerKey] = setTimeout(() => target.apply(this, args), delay);
        };
    };
}
