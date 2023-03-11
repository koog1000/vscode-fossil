/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types='@types/node'/>

declare namespace TSReset {
    type NonFalsy<T> = T extends false | 0 | '' | null | undefined | 0n
        ? never
        : T;
}

interface Array<T> {
    filter(predicate: BooleanConstructor, thisArg?: any): TSReset.NonFalsy<T>[];
}

interface ReadonlyArray<T> {
    filter(predicate: BooleanConstructor, thisArg?: any): TSReset.NonFalsy<T>[];
}
