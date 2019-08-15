Changelog
=============================================


v0.0.6
---------------------------------------------
## What's New
- Update readme with link to cloning doc and and troubleshooting seciton
- Update cloning inputboxes to default to empty
- Default all commands to check for input prompt


v0.0.5
---------------------------------------------
## What's New
- Update readme with preferable page for fossil install and
  point to proper pull requests
- add prompt when fossil requests stdin
    - only works for clone command at the moment


v0.0.4
---------------------------------------------
## What's New
- Fixed merge command and issue with merge files not showing in change list
    - fossil merge commits require a full merge so still use this command with
      caution, and fallback to command line if needed
- Fixed create branch command


v0.0.3
---------------------------------------------
## What's New
- Fixed issue where conflicted files would not show up in changeset
    - conflicted files still must be manually fixed, but at least
      you know about them now
- Updated README and gifs
- Removed unused files


v0.0.2
---------------------------------------------
## What's New
- Fixed file status icons
- Changed test file location


v0.0.1
---------------------------------------------
## What's New
- New Repo Initialization workflow
- Updated working changes\staged changes workflow
    - Fossil doesn't have a staging area, but has selective commit,
      so staging is purely an artifact of the extension.
      If you close the extension and reopen, the stage area will be cleared
- Updated some icons to match git icons for vs code 1.37.0


v0.0.0
---------------------------------------------
## What's New
- Everything. Work In Progress, based on Ben Crowl's excellent
  [Hg extension](https://github.com/mrcrowl/vscode-hg/).

