# How to release vscode-fossil extension

## Desribe the changes
1. Update version in `package.json`
1. Update `CHANGELOG.md`


## Ensure everything is working
1. Run tests: `npm run test`
1. Remove out directory: `rm -rf out`
1. Create package (.vsix file): `npm run package`
1. Ensure all files are there: `unzip -l fossil-#.#.#.vsix`. There should only be TWO .js files.


## Make commits

1. Create a brunch `git switch --create $USER-release-#.#.#`
1. Make a commit 'release: #.#.#'
1. Make a pull request
1. "Merge and rebase" on a successful pull request
1. Switch to `master`
1. Tag `git tag v#.#.#; git push origin $_`


## Release
1. Download .vsix file from github "Releases"*
1. Upload it to https://marketplace.visualstudio.com/manage/publishers/koog1000
1. Upload it to https://open-vsx.org/extension/koog1000/fossil

Storing tokens