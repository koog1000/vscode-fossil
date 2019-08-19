/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { Uri } from 'vscode';

export function fromFossilUri(uri: Uri): { path: string; ref: string; } {
    return JSON.parse(uri.query);
}

export function toFossilUri(uri: Uri, ref: string): Uri {
    return uri.with({
        scheme: 'fossil-original',
        path: uri.path,
        query: JSON.stringify({
            path: uri.fsPath,
            ref
        })
    });
}
