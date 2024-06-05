# Changelog

# v0.6.0

### What's New

- Configuration changes:
  * `fossil.path` option can change `fossil` path without restart
  * `fossil.path` and `fossil.username` options are of string type now, i.e. easily editable in "Settings" panel
  * Remove `fossil.enabled` option
- Warn user when `fossil` executable is not found
- Log output with timestamp and log level


# v0.5.7

### What's New

- add github/git export in a wizard-like style

### Bug Fix

- simplify and fixed minor issues in pikchr syntax highlighting


# v0.5.6

### What's New

- .{md,wiki,pikchr} files preview is automatically updated on editor/file switch

### Bug Fix

- pikchr syntax highlighting is ready, please report any issues now.
- some text wasn't rendered in the preview window


# v0.5.5

### What's New

- Add pikchr syntax highlighting (work in progress)
- Add .pikchr files preview
- Dark/light theme support for wiki/md/pikchr previews (requires fossil trunk version 2.24)
- Add "Revert" button to "Unresolved Conflicts" SCM group


# v0.5.4

### What's New

- Support fossil 2.23 updated status command output


# v0.5.3

### Bug Fix

- Show file contents instead of error when clicking on deleted file in scm panel


# v0.5.2

### What's New

- Use the same content backend (`FileSystemProvider`) as git extension

### Bug Fix

- Use remote names to push and pull to allows the use of the saved passwords


# v0.5.0

### What's New

- Add 'Update' command
- Remove 'autoUpdate' configuration option. Use 'Pull' command to run
  'fossil pull' and 'Update' command to run 'fossil update'

### Bug Fix

- In 0.4.0 'Pull' command did `fossil update URI` which is not a valid command.


# v0.4.0

### What's New

- Restore push/pull functionality
- Show current checkout time in the status bar tooltip
- Rework "Fossil: Log" menu: it's now possible to open all changed files of a past commit
- Allow multiple cherrypicks and merges (with confirmation)

### Bug Fixes

- Execution error handling reworked
- Invalid UTC date handling when showing stash and timeline entries


# v0.3.2

### What's New

- Add 'Open File' as inline action (icon like in git extension)

### Bug Fixes

- Don't save document when a range is reverted
- Fix 8 minor issues


# v0.3.1

### What's New

- Rename files after they were relocated.
  Use "Select New File Location" context menu for missing files.
- Checkout SHA and tags are now in status bar tooltip

### Bug Fixes

- Show diff for missing files without JSON error


# v0.3.0

### What's New

- Speedup: collect all file statuses using `fossil status` instead of
  combination of `fossil status` and `fossil extras`
- Show file status in resource tooltip:
  ![status tooltip](https://user-images.githubusercontent.com/76137/239752643-3b01f331-c729-41ea-a836-ffaa96b89fb5.png)
- support rare `UNEXEC`, `SYMLINK`, `UNLINK` and `NOT_A_FILE` statuses

### Bug Fixes

- Another two typos


# v0.2.6

### What's New

- Ability to create a private branch
- Custom color for new branch

### Bug Fixes

- Two typos


# v0.2.5

### Bug Fixes

- Support fossil 2.21 new 'check-out' spelling


# v0.2.4

### What's New

- "Praise" (blame) command
- "Checkout by hash" command in branch change menu (see statusbar)


# v0.2.3

### Bug Fixes

- Pull not working (issue #98)


# v0.2.2

### What's New

- Renaming: after a file or a directory is renamed from the explorer a dialog confirming rename in fossil is shown

### Bug Fixes

- Run one fewer `fossil status` command on startup


# v0.2.1

### What's New

- "Add" command not only does `fossil add` but stages files as well
- Add placeholder text for commit message input box

### Bug Fixes

- Fossil commands clutter git menus when fossil and git are open at the same time


# v0.2.0

### With 0.2.0 release we remove all Mercurial SCM references which were in the code after initial fork.

### Bug Fixes

- Remove inaccessible commands from Command Palette
- Each workspace subfolder is searched for repository (logic was broken)


# v0.1.9

### What's New
- Preview of wiki/md files using fossil's renderer
- Publish Technote right from preview
- Stash support (save, snapshot, pop, apply, drop)
- Rewrote Cloning operation to make it more user friendly
- Remove 'Delete Extras', 'Discard All Changes', 'Unstage All Changes' commands from Source Control menu because all these actions are available as buttons

### Bug Fixes
- Restore the "Restore" button in "scm/change/title"
- Minor bugfixes (#78, #80)


# v0.1.8

### What's New
- Prompts show command line arguments above stdout
- Support fossil 2.19's new rename status (from -> to)

### Bug Fixes
- Committing from ui didn't await user input
- Rework prompt detection using 50ms timeout


# v0.1.7

### What's New
- 'Redo' command
- Edit commit message with 'Log...' command
- Commands for opening and reopening a branch

### Bug Fixes
- 'Undo' command didn't work


# v0.1.6

### What's New
- Buttons to delete 'Untracked Files' and revert files in other groups
- Action to commit to a new branch
- Commit actions are grouped in a submenu
- Input project name and description on a new project initialization (2.18+)

### Bug Fixes
- Message 'Fossil: file _FILENAME_ does not exist in check-in current'
  was popping up when opening an untracked file was opened


# v0.1.5

### What's New
- 'Merge' and 'Timeline` submenus in Source Control panel
- 'Merge', 'Integrate' and 'Cherry-pick' from 'Merge' submenu

### Bug Fixes
- Timeline (Log) actions didn't show expected result. It should
  now be possible to show file diff from these menus.


# v0.1.4

### What's New
- Support fossil patch create/apply
- Warn about unsaved files when committing

### Bug Fixes
- Files merged by integration (`--integrate`)
  didn't appear in the scm changes section


# v0.1.3

### What's New
- Reduce package size from 0.25MB to 0.07MB

### Bug Fixes
- Renamed files don't appear in the scm changes section


# v0.1.2

### What's New
- Restore repository initialization buttons in "Source Control" tab
  when no repository is opened
- Reduce package size from 1.7MB to 0.25MB
- Extension codebase is modernized. It should be easier to add tests


# v0.1.1

### What's New
- Add "quick revert" button in quick diff window


# v0.1.0

### What's New
- Add username configuration override for commits


# v0.0.19

### What's New
- More fixes to repo actions to resource folders,
  Maybe someday I'll learn to test better...


# v0.0.18

### What's New
- Fix repo actions to resource folders


# v0.0.17

### What's New
- Added repo actions to resource folders


# v0.0.16

### What's New
- Added `Select Files to Add` to command palette
- Added `Delete Extras` command
- Fixed issue where attempting to remove multiple resources
  only removed one resource


# v0.0.15

### What's New
- Don't perform input checking for `fossil cat` commands
- update dependencies to reduce extension size


# v0.0.14

### What's New
- Throw error when caught by exec command instead of returning empty string.
  This fixes a host of odd behaviors.


# v0.0.13

### What's New
- Wait for user to select to open error prompt before opening it
- Filter out additional error case of `fossil cat` command


# v0.0.12

### What's New
- Open Fossil output log on error prompt
- Update which errors generate error prompt
- General cleanup


# v0.0.11

### What's New
- Actually Fix `Fossil: Commit All`, v0.0.9 didn't fix it
- When error occurs prompt to open Fossil output log
- General cleanup


# v0.0.10

### What's New
- Fix for diff files not refreshing after commit
- Update icons and menus to be more intuitive
- Performance improvements, fewer calls to fossil db
- General cleanup and removal of dead code


# v0.0.9

### What's New
- Fix `Fossil: Commit All`
- Make commit command more flexible
  and show warning when there are no staged changes
- Fix single-click to open diff
- Modify stdout webview for easier readability
- General cleanup


# v0.0.7

### What's New
- Update commit to allow non-ASCII characters
- Create webview with stdout content when fossil prompts user for input


# v0.0.6

### What's New
- Update readme with link to cloning doc and and troubleshooting section
- Update cloning inputboxes to default to empty
- Default all commands to check for input prompt


# v0.0.5

### What's New
- Update readme with preferable page for fossil install and
  point to proper pull requests
- add prompt when fossil requests stdin
    - only works for clone command at the moment


# v0.0.4

### What's New
- Fixed merge command and issue with merge files not showing in change list
    - fossil merge commits require a full merge so still use this command with
      caution, and fallback to command line if needed
- Fixed create branch command


# v0.0.3

### What's New
- Fixed issue where conflicted files would not show up in changeset
    - conflicted files still must be manually fixed, but at least
      you know about them now
- Updated README and gifs
- Removed unused files


# v0.0.2

### What's New
- Fixed file status icons
- Changed test file location


# v0.0.1

### What's New
- New Repo Initialization workflow
- Updated working changes\staged changes workflow
    - Fossil doesn't have a staging area, but has selective commit,
      so staging is purely an artifact of the extension.
      If you close the extension and reopen, the stage area will be cleared
- Updated some icons to match git icons for vs code 1.37.0


# v0.0.0

### What's New
- Everything. Work In Progress, based on Ben Crowl's excellent
  [Hg extension](https://github.com/mrcrowl/vscode-hg/).
