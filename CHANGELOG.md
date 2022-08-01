# Changelog

# v0.1.6

### What's New
- Buttons to delete 'Untracked Files' and revert files in other groups

# v0.1.5

### What's New
- 'Merge' and 'Timeline` submenus in Source Control panel
- 'Merge', 'Integrate' and 'Cherry-pick' from 'Merge' menu

### Bug Fixes
- Timeline (Log) actions didn't show expected result. It should
  now be possible to show file diff from these menus.

# v0.1.4

### What's New
- Support fossil patch create/apply
- Warn about unsaved files when commiting

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
- Restore repositoty initialization buttons in "Source Control" tab
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
- More fixes to repo actions to resouce folders,
  Maybe somedeay I'll leran to test beter...


# v0.0.18

### What's New
- Fix repo actions to resouce folders


# v0.0.17

### What's New
- Added repo actions to resouce folders


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
- Update readme with link to cloning doc and and troubleshooting seciton
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
