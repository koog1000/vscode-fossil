# API

This documentation is intended for fossil extension developers
to understand all the commands and to not forget what all commands should do. This documentation should also help find bugs.

_Work in progress_.

| Command | Name | Where | Expected behavior |
| - | - | - | - |
| fossil.add | Add Files | •&nbsp;Untracked files section entries<br>•&nbsp;Command palette | 1. Execute `fossil add $(files)`<br>2. Add files into staged area |
| fossil.addAll | Add All Untracked Files | •&nbsp;Untracked files section<br>•&nbsp;Command palette | Same as `fossil.add` for all files |
| fossil.branch | Create Branch... | •&nbsp;Command palette | 1. Input new branch name<br>2. Try execute `fossil branch new $(branch-name)`<br>3. On error reopen or update branch
| fossil.branchChange | _not needed_ | •&nbsp;Branch name is clicked in status bar | 1. Pick branch name<br>2. Execute `fossil update $(branch-name)` |
| fossil.cherrypick | Cherry-pick into working directory... | •&nbsp;Main SCM menu<br>•&nbsp;Command palette |
| fossil.clean | Delete Extras |
| fossil.clone | Clone Fossil Repository | Source control header |
| fossil.close | Close Repository | | Execute `fossil close`
| fossil.closeBranch | Close branch... | | 1. Pick a branch<br>2. Execute `fossil tag add --raw closed $(branch-name)`
| fossil.commit | Commit |
| fossil.commitAll | Commit All | •&nbsp;Main SCM menu<br>•&nbsp;Command palette |
| fossil.commitBranch | Commit Creating New Branch... | •&nbsp;Main SCM menu<br>•&nbsp;Command palette |
| fossil.commitStaged | Commit Staged | •&nbsp;Main SCM menu<br>•&nbsp;Command palette |
| fossil.commitWithInput | _not needed_ | •&nbsp;Standard commit input box |
| fossil.deleteFile | Delete Untracked File |
| fossil.deleteFiles | Delete All Untracked Files |
| fossil.fileLog | Show file history... |
| fossil.forget | Forget Files |
| fossil.ignore | Add to ignore-glob | •&nbsp;Command palette<br>•&nbsp;Untracked submenu | 1. Modify `/.fossil-settings/ignore-glob`<br>2. Add `ignore-glob` to the current checkout (not staging)<br>3. Show ignore-glob file
| fossil.init | Initialize Fossil Repository | •&nbsp;Main SCM menu<br>•&nbsp;Command palette | 1. Ask `.fossil` path<br>2. Ask project name<br>3. Ask project description<br>4. Run `fossil init`<br>5. Ask to open repository
| fossil.integrate | Integrate into working directory... |
| fossil.log | Log... |
| fossil.merge | Merge into working directory... |
| fossil.open | Open Fossil Repository |
| fossil.openChange | Open Changes |
| fossil.openChangeFromUri | Open Changes | •&nbsp;Editor bar | Switch editor to diff mode
| fossil.openFile | Open File |
| fossil.openFileFromUri | Open File | •&nbsp;Command palette<br>•&nbsp;Editor bar | When in diff view, there's a special button to show local file
| fossil.openFiles | Open Files |
| fossil.openResource| _not needed_ | •&nbsp; Source Control panel | Resource in opened in a diff view if possible |
| fossil.openUI | Open web UI | •&nbsp;Command palette | execute `fossil ui` in VSCode terminal |
| fossil.patchApply | Apply Patch | •&nbsp;Main SCM menu<br>•&nbsp;Command palette | 1. Select path<br>2. Execute `fossil patch apply $(path)`
| fossil.patchCreate | Create Patch | •&nbsp;Main SCM menu<br>•&nbsp;Command palette | 1. Select path<br>2. Execute `fossil patch create $(path)`
| fossil.pull | Pull | •&nbsp;Main SCM menu<br>•&nbsp;Command palette | 1. Select remote URI if many<br>2. Execute `fossil pull URI`
| fossil.push | Push | •&nbsp;Main SCM menu<br>•&nbsp;Command palette | 1. Execute `fossil push`
| fossil.pushTo | Push to... | •&nbsp;Main SCM menu<br>•&nbsp;Command palette | 1. Pick remote if > 1<br>2. Execute `fossil push URI`
| fossil.redo | Redo | •&nbsp;Main SCM menu<br>•&nbsp;Command palette | execute `fossil redo`
| fossil.refresh | Refresh | Source control header | 1. Execute `fossil status`<br>2. Update related information
| fossil.render | Preview Using Fossil Renderer |
| fossil.reopenBranch | Reopen branch... | | 1. Pick branch<br>2. execute `fossil tag cancel --raw closed $(branch-name)`
| fossil.revert | Discard Changes |
| fossil.revertAll | Discard All Changes | •&nbsp;SCM group header<br>•&nbsp;Command palette | 1. When called from Command palette, revert "conflict" and "changes" groups <br>2. When called from SCM group header, revert all files in that group.
| fossil.revertChange | Revert Change | •&nbsp;Inline diff window |
| fossil.showOutput | Show fossil output | •&nbsp;Main SCM menu<br>•&nbsp;Command palette | Reveal `outputChannel` channel in the UI
| fossil.stage | Stage Changes |
| fossil.stageAll | Stage All Changes |
| fossil.stashApply | Stash Apply | •&nbsp;Main SCM menu<br>•&nbsp;Command palette |
| fossil.stashDrop | Stash Drop | •&nbsp;Main SCM menu<br>•&nbsp;Command palette |
| fossil.stashPop | Stash Pop | •&nbsp;Main SCM menu<br>•&nbsp;Command palette |
| fossil.stashSave | Stash Push | •&nbsp;Main SCM menu<br>•&nbsp;Command palette |
| fossil.stashSnapshot | Stash Snapshot | •&nbsp;Main SCM menu<br>•&nbsp;Command palette |
| fossil.sync | Sync | •&nbsp;Main SCM menu<br>•&nbsp;Command palette | execute `fossil sync`
| fossil.undo | Undo | •&nbsp;Main SCM menu<br>•&nbsp;Command palette | execute `fossil undo`
| fossil.unstage | Unstage Changes |
| fossil.unstageAll | Unstage All Changes |
| fossil.update | Update | •&nbsp;Main SCM menu<br>•&nbsp;Command palette<br>•&nbsp;Status bar item | 1. Execute `fossil update`
| fossil.wikiCreate | Publish as Fossil Wiki or Technote |
