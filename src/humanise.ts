import * as path from 'path';
import {
    FossilBranch,
    FossilCheckin,
    FossilCommitMessage,
} from './openedRepository';

import { localize } from './main';

class TimeSpan {
    private seconds: number;

    constructor(totalSeconds: number) {
        this.seconds = totalSeconds;
    }

    public get totalSeconds(): number {
        return this.seconds;
    }
    public get totalMinutes(): number {
        return this.seconds / 60;
    }
    public get totalHours(): number {
        return this.seconds / 3600;
    }
    public get totalDays(): number {
        return this.seconds / 86400;
    }
    // public get totalWeeks(): number {
    //     return this.seconds / 604800;
    // }
}

const BULLET = '\u2022';
const FILE_LIST_LIMIT = 8;

export function formatFilesAsBulletedList(filenames: string[]): string {
    let extraCount = 0;
    if (filenames.length > FILE_LIST_LIMIT + 1) {
        extraCount = filenames.length - FILE_LIST_LIMIT;
        filenames = filenames.slice(0, FILE_LIST_LIMIT);
    }

    const osFilenames = filenames.map(f => f.replace(/[/\\]/g, path.sep));
    let formatted = ` ${BULLET} ${osFilenames.join(`\n ${BULLET} `)}`;
    if (extraCount > 1) {
        const andNOthers = localize(
            'and n others',
            'and {0} others',
            extraCount
        );
        formatted += `\n${andNOthers}`;
    }

    return formatted;
}

export function describeMerge(
    localBranchName: FossilBranch,
    otherBranchName: FossilCheckin
): FossilCommitMessage {
    return localize(
        'merge into',
        'Merge {0} into {1}',
        otherBranchName,
        localBranchName
    ) as FossilCommitMessage;
}

export const enum Old {
    DATE,
    EMPTY_STRING,
}

export function ageFromNow(date: Date, old: Old = Old.DATE): string {
    const elapsedSeconds = timeSince(date) / 1e3;
    const elapsed = new TimeSpan(elapsedSeconds);
    if (elapsed.totalDays >= 0) {
        // past
        if (elapsed.totalSeconds < 5) {
            return 'now';
        }
        if (elapsed.totalSeconds < 15) {
            return 'a few moments ago';
        }
        if (elapsed.totalSeconds < 99) {
            return `${Math.floor(elapsed.totalSeconds)} seconds ago`;
        }
        if (elapsed.totalMinutes < 60) {
            const minutes: string = pluraliseQuantity(
                'minute',
                elapsed.totalMinutes
            );
            return `${minutes} ago`;
        }
        if (elapsed.totalHours < 24) {
            const now: Date = new Date();
            const today: Date = datePart(now);
            const startDate: Date = datePart(addSeconds(now, -elapsedSeconds));
            const yesterday: Date = addDays(today, -1);

            if (startDate.getTime() == yesterday.getTime()) {
                return 'yesterday';
            } else {
                const hours: string = pluraliseQuantity(
                    'hour',
                    elapsed.totalHours
                );
                return `${hours} ago`;
            }
        }
        if (elapsed.totalDays < 7) {
            const now: Date = new Date();
            const today: Date = datePart(now);
            const startDate: Date = datePart(addSeconds(now, -elapsedSeconds));
            const yesterday: Date = addDays(today, -1);
            // const wholeDays: number = Math.round(elapsed.totalDays);

            if (startDate.getTime() == yesterday.getTime()) {
                return 'yesterday';
            } else {
                const todayWeek: number = getWeek(today);
                const startWeek: number = getWeek(startDate);
                if (todayWeek == startWeek) {
                    return `${Math.round(elapsed.totalDays)} days ago`;
                } else {
                    return 'last week';
                }
            }
        }
        if (old == Old.DATE) {
            return date.toLocaleDateString(undefined, {
                formatMatcher: 'basic',
            });
        } else {
            return '';
        }
    } else {
        // future
        const totalDays: number = Math.floor(-elapsed.totalDays);
        const totalHours: number = Math.floor(-elapsed.totalHours);
        const totalMinutes: number = Math.floor(-elapsed.totalMinutes);
        if (totalMinutes < 60) {
            return `future (${pluraliseQuantity('minute', totalMinutes)})`;
        }
        if (totalHours < 48) {
            return `future (${pluraliseQuantity('hour', totalHours)})`;
        }
        return `future (${totalDays} days)`;
    }
}

function timeSince(date: Date): number {
    return Date.now() - date.getTime();
}

function addSeconds(date: Date, numberOfSeconds: number): Date {
    const adjustedDate: Date = new Date(date.getTime());
    adjustedDate.setSeconds(adjustedDate.getSeconds() + numberOfSeconds);
    return adjustedDate;
}

function addDays(date: Date, numberOfDays: number): Date {
    const adjustedDate: Date = new Date(date.getTime());
    adjustedDate.setDate(adjustedDate.getDate() + numberOfDays);
    return adjustedDate;
}

function datePart(date: Date): Date {
    return new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        0,
        0,
        0,
        0
    );
}

function getWeek(date: Date): number {
    const oneJan = new Date(date.getFullYear(), 0, 1);
    return Math.ceil(
        ((date.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) /
            7
    );
}

function pluraliseQuantity(word: string, quantity: number) {
    quantity = Math.floor(quantity);
    return `${quantity} ${word}${quantity == 1 ? '' : 's'}`;
}
