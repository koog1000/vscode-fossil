# How to release vscode-fossil extension

1. Update version in `package.json`
1. Update `CHANGELOG.md`
1. Run tests: `npm run test`
1. Remove out directory: `rm -rf out`
1. Create package (.vsix file): `npm run package`
1. Ensure all files are there: `unzip -l fossil-#.#.#.vsix`. There should only be TWO .js files.
1. Make a commit 'release: #.#.#'
1. Push commit on master
1. Tag `git tag v#.#.#; git push origin $_`
1. Upload to https://marketplace.visualstudio.com/manage/publishers/koog1000
1. Upload to https://open-vsx.org/extension/koog1000/fossil
