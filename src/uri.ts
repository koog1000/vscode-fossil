/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { Uri } from 'vscode';

export interface FossilUriParams {
    // full filesystem path
    path: string;
    // https://fossil-scm.org/home/doc/trunk/www/checkin_names.wiki
    checkin: string;
}

export function fromFossilUri(uri: Uri): FossilUriParams {
    return JSON.parse(uri.query);
}

export function toFossilUri(uri: Uri, checkin: string=''): Uri {
    const params: FossilUriParams = {
        path: uri.fsPath,
        checkin: checkin,
    };
    return uri.with({
        scheme: 'fossil',
        path: uri.path,
        query: JSON.stringify(params)
    });
}
