/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vscode';

export interface IDisposable {
    dispose(): void;
}

interface HasForEach<T> {
    forEach: (val: (item: T) => void) => void;
}

export function dispose<T extends IDisposable>(
    disposables: HasForEach<T>
): T[] {
    disposables.forEach(d => d.dispose());
    return [];
}

export function toDisposable(dispose: () => void): IDisposable {
    return { dispose };
}

function combinedDisposable(disposables: IDisposable[]): IDisposable {
    return toDisposable(() => dispose(disposables));
}

export function filterEvent<T>(
    event: Event<T>,
    filter: (e: T) => boolean
): Event<T> {
    return (listener, thisArgs = null, disposables?) =>
        event(e => filter(e) && listener.call(thisArgs, e), null, disposables);
}

export function anyEvent<T>(...events: Event<T>[]): Event<T> {
    return (listener, thisArgs = null, disposables?) => {
        const result = combinedDisposable(
            events.map(event => event(i => listener.call(thisArgs, i)))
        );

        if (disposables) {
            disposables.push(result);
        }

        return result;
    };
}

export function done<T>(promise: Promise<T>): Promise<void> {
    return promise.then<void>(() => void 0, <any>(() => void 0));
}

export function once<T>(event: Event<T>): Event<T> {
    return (listener, thisArgs = null, disposables?) => {
        const result = event(
            e => {
                result.dispose();
                return listener.call(thisArgs, e);
            },
            null,
            disposables
        );

        return result;
    };
}

export function eventToPromise<T>(event: Event<T>): Promise<T> {
    return new Promise(c => once(event)(c));
}

export function groupBy<T>(
    arr: T[],
    fn: (el: T) => string
): { [key: string]: T[] } {
    return arr.reduce((result, el) => {
        const key = fn(el);
        result[key] = [...(result[key] || []), el];
        return result;
    }, Object.create(null));
}

export function partition<T>(
    array: T[],
    fn: (el: T, i: number, ary: T[]) => boolean
): [T[], T[]] {
    return array.reduce(
        (result: [T[], T[]], element: T, i: number) => {
            if (fn(element, i, array)) {
                result[0].push(element);
            } else {
                result[1].push(element);
            }
            return result;
        },
        <[T[], T[]]>[[], []]
    );
}

export const delay = (ms: number): Promise<void> =>
    new Promise(c => setTimeout(c, ms));

// export const isInArray = <T, A extends T>(
//     item: T,
//     array: ReadonlyArray<A>
// ): item is A => array.includes(item as A);
