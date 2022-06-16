import {
    TextDocument,
    Range,
    TextEditor,
    WorkspaceEdit,
    workspace,
    Position,
} from 'vscode';
import { toFossilUri } from './uri';

export interface LineChange {
    readonly originalStartLineNumber: number;
    readonly originalEndLineNumber: number;
    readonly modifiedStartLineNumber: number;
    readonly modifiedEndLineNumber: number;
}

// copy from vscode/extensions/git/src/staging.ts
function applyLineChanges(
    original: TextDocument,
    modified: TextDocument,
    diffs: LineChange[]
): string {
    const result: string[] = [];
    let currentLine = 0;

    for (const diff of diffs) {
        const isInsertion = diff.originalEndLineNumber === 0;
        const isDeletion = diff.modifiedEndLineNumber === 0;

        let endLine = isInsertion
            ? diff.originalStartLineNumber
            : diff.originalStartLineNumber - 1;
        let endCharacter = 0;

        // if this is a deletion at the very end of the document,then we need to account
        // for a newline at the end of the last line which may have been deleted
        // https://github.com/microsoft/vscode/issues/59670
        if (isDeletion && diff.originalEndLineNumber === original.lineCount) {
            endLine -= 1;
            endCharacter = original.lineAt(endLine).range.end.character;
        }

        result.push(
            original.getText(new Range(currentLine, 0, endLine, endCharacter))
        );

        if (!isDeletion) {
            let fromLine = diff.modifiedStartLineNumber - 1;
            let fromCharacter = 0;

            // if this is an insertion at the very end of the document,
            // then we must start the next range after the last character of the
            // previous line, in order to take the correct eol
            if (
                isInsertion &&
                diff.originalStartLineNumber === original.lineCount
            ) {
                fromLine -= 1;
                fromCharacter = modified.lineAt(fromLine).range.end.character;
            }

            result.push(
                modified.getText(
                    new Range(
                        fromLine,
                        fromCharacter,
                        diff.modifiedEndLineNumber,
                        0
                    )
                )
            );
        }

        currentLine = isInsertion
            ? diff.originalStartLineNumber
            : diff.originalEndLineNumber;
    }

    result.push(
        original.getText(new Range(currentLine, 0, original.lineCount, 0))
    );

    return result.join('');
}

// copy from vscode/extensions/git/src/commands.ts
export async function revertChanges(
    textEditor: TextEditor,
    changes: LineChange[]
): Promise<void> {
    if (!textEditor) {
        return;
    }

    const modifiedDocument = textEditor.document;
    const modifiedUri = modifiedDocument.uri;

    if (modifiedUri.scheme !== 'file') {
        return;
    }

    const originalUri = toFossilUri(modifiedUri);
    const originalDocument = await workspace.openTextDocument(originalUri);
    const visibleRangesBeforeRevert = textEditor.visibleRanges;
    const result = applyLineChanges(
        originalDocument,
        modifiedDocument,
        changes
    );

    const edit = new WorkspaceEdit();
    edit.replace(
        modifiedUri,
        new Range(
            new Position(0, 0),
            modifiedDocument.lineAt(modifiedDocument.lineCount - 1).range.end
        ),
        result
    );
    workspace.applyEdit(edit);

    await modifiedDocument.save();

    textEditor.revealRange(visibleRangesBeforeRevert[0]);
}
