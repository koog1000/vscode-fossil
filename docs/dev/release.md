# How to release vscode-fossil extension

1. Update version in `package.json`
1. Update `CHANGELOG.md`
1. Run tests: `npm run test`
1. Remove out directory: `rm -rf out`
1. Test that .wsix file can be created: `npm run package`
1. Ensure all files are there: `unzip -l fossil-0.1.9.vsix`. There should be ony TWO js files.
1. Push commit on master
1. Tag `git tag v#.#.#; git push origin $_`
1. Upload to https://marketplace.visualstudio.com/manage/publishers/koog1000
1. Upload to https://open-vsx.org/extension/koog1000/fossil
