import { InputBox } from 'vscode';
import { window, commands } from 'vscode';
import * as sinon from 'sinon';
import { fakeExecutionResult, getExecStub } from './common';
import * as assert from 'assert/strict';
import { Suite } from 'mocha';

export function BranchSuite(this: Suite): void {
    test('Create public branch', async () => {
        const cib = this.ctx.sandbox.stub(window, 'createInputBox');
        cib.onFirstCall().callsFake(() => {
            const inputBox: InputBox = cib.wrappedMethod();
            const stub = sinon.stub(inputBox);
            stub.show.callsFake(() => {
                stub.value = 'hello branch';
                const onDidAccept = stub.onDidAccept.getCall(0).args[0];
                const onDidChangeValue =
                    stub.onDidChangeValue.getCall(0).args[0];
                const onDidTriggerButton =
                    stub.onDidTriggerButton.getCall(0).args[0];
                onDidTriggerButton(stub.buttons[1]); // private on
                onDidTriggerButton(stub.buttons[1]); // private off
                onDidChangeValue(stub.value);
                assert.equal(stub.validationMessage, '');
                onDidAccept();
            });
            return stub;
        });

        const creation = getExecStub(this.ctx.sandbox).withArgs([
            'branch',
            'new',
            'hello branch',
            'current',
        ]);
        await commands.executeCommand('fossil.branch');
        sinon.assert.calledOnce(creation);
    });

    test('Branch already exists warning is shown', async () => {
        const cib = this.ctx.sandbox.stub(window, 'createInputBox');
        cib.onFirstCall().callsFake(() => {
            const inputBox: InputBox = cib.wrappedMethod();
            const stub = sinon.stub(inputBox);
            stub.show.callsFake(() => {
                stub.value = 'hello branch';
                stub.onDidAccept.getCall(0).args[0]();
            });
            return stub;
        });

        const swm: sinon.SinonStub = this.ctx.sandbox
            .stub(window, 'showWarningMessage')
            .resolves();

        const creation = getExecStub(this.ctx.sandbox).withArgs([
            'branch',
            'new',
            'hello branch',
            'current',
        ]);
        await commands.executeCommand('fossil.branch');
        sinon.assert.calledOnce(creation);
        sinon.assert.calledOnceWithExactly(
            swm,
            "Branch 'hello branch' already exists. Update or Re-open?",
            {
                modal: true,
            },
            '&&Update',
            '&&Re-open'
        );
    }).timeout(14500);

    test('Create private branch', async () => {
        const cib = this.ctx.sandbox.stub(window, 'createInputBox');
        cib.onFirstCall().callsFake(() => {
            const inputBox: InputBox = cib.wrappedMethod();
            const stub = sinon.stub(inputBox);
            stub.show.callsFake(() => {
                stub.value = 'hello branch';
                const onDidAccept = stub.onDidAccept.getCall(0).args[0];
                const onDidTriggerButton =
                    stub.onDidTriggerButton.getCall(0).args[0];
                onDidTriggerButton(stub.buttons[1]); // private on
                onDidAccept();
            });
            return stub;
        });

        const execStub = getExecStub(this.ctx.sandbox);
        const creation = execStub
            .withArgs(['branch', 'new', 'hello branch', 'current', '--private'])
            .resolves(fakeExecutionResult());
        await commands.executeCommand('fossil.branch');
        sinon.assert.calledOnce(creation);
    });

    test('Create branch with color', async () => {
        const cib = this.ctx.sandbox.stub(window, 'createInputBox');
        cib.onFirstCall().callsFake(() => {
            const inputBox: InputBox = cib.wrappedMethod();
            const stub = sinon.stub(inputBox);
            stub.show.callsFake(() => {
                const onDidAccept = stub.onDidAccept.getCall(0).args[0];
                const onDidTriggerButton =
                    stub.onDidTriggerButton.getCall(0).args[0];
                onDidTriggerButton(stub.buttons[0]);
                stub.value = '#aabbcc';
                onDidAccept();
                stub.value = 'color branch';
                onDidAccept();
            });
            return stub;
        });
        const execStub = getExecStub(this.ctx.sandbox);
        const creation = execStub
            .withArgs([
                'branch',
                'new',
                'color branch',
                'current',
                '--bgcolor',
                '#aabbcc',
            ])
            .resolves(fakeExecutionResult());
        await commands.executeCommand('fossil.branch');
        sinon.assert.calledOnce(creation);
    });

    test('Create branch canceled', async () => {
        const cib = this.ctx.sandbox.stub(window, 'createInputBox');
        cib.onFirstCall().callsFake(() => {
            const inputBox: InputBox = cib.wrappedMethod();
            const stub = sinon.stub(inputBox);
            stub.show.callsFake(() => {
                const onDidAccept = stub.onDidAccept.getCall(0).args[0];
                stub.value = '';
                onDidAccept();
            });
            return stub;
        });
        await commands.executeCommand('fossil.branch');
        sinon.assert.calledOnce(cib);
    });

    test('Branch already exists - reopen branch', async () => {
        const cib = this.ctx.sandbox.stub(window, 'createInputBox');
        cib.onFirstCall().callsFake(() => {
            const inputBox: InputBox = cib.wrappedMethod();
            const stub = sinon.stub(inputBox);
            stub.show.callsFake(() => {
                const onDidAccept = stub.onDidAccept.getCall(0).args[0];
                stub.value = 'trunk';
                onDidAccept();
            });
            return stub;
        });
        const swm: sinon.SinonStub = this.ctx.sandbox
            .stub(window, 'showWarningMessage')
            .resolves('&&Re-open' as any);

        const execStub = getExecStub(this.ctx.sandbox);
        const newBranchStub = execStub
            .withArgs(['branch', 'new', 'trunk', 'current'])
            .onSecondCall()
            .resolves(fakeExecutionResult());

        await commands.executeCommand('fossil.branch');
        sinon.assert.calledOnce(cib);
        sinon.assert.calledOnce(swm);
        sinon.assert.calledTwice(newBranchStub);
    });

    test('Branch already exists - update to', async () => {
        const cib = this.ctx.sandbox.stub(window, 'createInputBox');
        cib.onFirstCall().callsFake(() => {
            const inputBox: InputBox = cib.wrappedMethod();
            const stub = sinon.stub(inputBox);
            stub.show.callsFake(() => {
                const onDidAccept = stub.onDidAccept.getCall(0).args[0];
                stub.value = 'trunk';
                onDidAccept();
            });
            return stub;
        });
        const swm: sinon.SinonStub = this.ctx.sandbox
            .stub(window, 'showWarningMessage')
            .resolves('&&Update' as any);

        const execStub = getExecStub(this.ctx.sandbox);
        const newBranchStub = execStub.withArgs(
            sinon.match.array.startsWith(['branch', 'new', 'trunk', 'current'])
        );
        const updateStub = execStub
            .withArgs(sinon.match.array.startsWith(['update', 'trunk']))
            .resolves(fakeExecutionResult());

        await commands.executeCommand('fossil.branch');
        sinon.assert.calledOnce(cib);
        sinon.assert.calledOnce(swm);
        sinon.assert.calledOnce(newBranchStub);
        sinon.assert.calledOnceWithExactly(
            updateStub,
            ['update', 'trunk'],
            undefined,
            { logErrors: true }
        );
    });
}
