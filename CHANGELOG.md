
**v1.0.7**
=============================================

## What's New
  - Faster commits. The outgoing/incoming check is now separate from the commit.
  - New setting `hg.pushPullBranch` controls which branch(es) will be pushed/pulled [#8](https://github.com/mrcrowl/vscode-hg/issues/8)
    - `all`: all branches (this is the default)
    - `current`: only the current branch
    - `default`: only the default branch
  - `hg.autoInOut` setting and status-bar display respects `hg.pushPullBranch` 
  - Spinning icon while pushing/pulling.

**v1.0.5-6**
=============================================

## What's New
  - Improvements to commandMode `server` reliability.
  - Marketplace category change --> SCM Providers [PR #5]

**v1.0.4**
=============================================

## What's New
  - If you have staged files when you rollback a commit, then all files from the rolled-back commit become staged too.
  - Attempt to fix issue with non-ascii commit messages encoding. [Issue #4](https://github.com/mrcrowl/vscode-hg/issues/4)
  
## Change to defaults
  - Default HGENCODING is now utf-8, unless an existing environment variable exists.

**v1.0.3**
=============================================

## What's New
  - The context menu commands "Open Changes" and "Open File" now work with multiple selections in source control.
  - These commands are also available in each group-level context menu (e.g. Changes or Staged Changes).

## Change to defaults
  - `cli` is now the default commandMode.  Although `server` is faster, it occasionally causes hangs.
  - I will attempt to track down the cause of the hangs before reverting this change.
  - In the meantime, if you prefer `server`, you'll need to add a user-setting.

## Bug Fixes
  - When using Undo/Rollback to undo a commit, the last commit message is properly restored.

**v1.0.2**
=============================================

## What's New
  - A commit including missing files now prompts for these to be deleted before committing.
  - With `hg.autoInOut` enabled, the status is shown as a tick when there are no incoming/outgoing changesets.
  - With `hg.autoInOut` enabled, the status bar tooltip shows when the next check time will be.
  - Problems with push/pull operations now show an error indicator on the status bar.

## Bug Fixes
  - Rollback/Undo now updates the count of outgoing commits immediately.
  - When you attempt to pull with no default path configured, the option to 'Open hgrc' now works from the error prompt. 
  - With `hg.autoInOut` disabled, the incoming count is no longer shown after you commit.