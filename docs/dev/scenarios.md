# Scenarios for README.md videos and images


## Software

* Chronicler plugin for VScode is used to capture video

```json
"chronicler.recording-defaults": {
    "animatedGif": false,
    "fps": 5,
    "gifScale": 1.0,
    "countdown": 1,
    "flags": {
        "pix_fmt": "rgb24",
        "c:v": "png",
        "vcodec": "rawvideo",
        "vframes": "1"
    }
}
```

* Extract frames with `ffmpeg -i fossil-1677169739283.mp4 'out%06d.png'`
* Use professional software to generate `gif`


## Images

### Setup

* Color theme: `Dark+`
* Window size: `1168 x 720`
    * Set using you OS or window manager api
* Zoom level: `1`
    * Set zoom level using `ctrl+,`
* All extensions except *Chronicler* and *Fossil* are disabled
* Use latest Fossil extension

### `fossil.png`

* Opened official fossil repository
* Source control panel is visible
    * Unresolved conflicts: some
    * Changes:
        * Added: some
        * Modified: some
    * Untracked files:
    * Staged files:
    ```bash
    #!/usr/bin/env bash
    # example
    fossil clone https://fossil-scm.org/home fossil.fossil
    fossil open fossil.fossil
    printf 'modification for fossil.png\n' >> www/quotes.wiki
    fossil commit -m "commit for conflict"
    fossil up forumpost-locking --nosync
    touch autoconfig.h config.log a_new_file.md
    fossil add a_new_file.md
    printf 'conflict for fossil.png\n' >> www/quotes.wiki
    printf 'modification for fossil.png\n' >> BUILD.txt
    fossil merge trunk
    ```
* Status bar shows current branch as `trunk+`
* Editor is split horizontally
    * Left:
        * `pikchr.md`
        * `quotes.wiki`
        * `fossil_prompt.wiki`
    * Right:
        * `pikchr.md` - preview with pikchr diagram visible

### `fossil-diff.gif` (View file changes)

1. Same setup as `fossil.png`, but all files are closed
2. Click on a file that shows diff in quotes.wiki
3. Highlight the diff with funny text:
    > You should give a try to this fossil VSCode plugin
4. End

### `init.gif` (Initialize a new repo)

1. Status: No repository is opened, Explorer view is selected
2. Source Control panel is opened
3. Fossil icon is clicked
4. Fossil file location is selected
5. Project name is entered
6. Project description is entered
7. "Would you like to open the cloned repository?" yes
8. End

### `change-branch.gif` (Update to a branch/tag)

1. Status: Fossil repo is opened
2. Branch name is status bar is clicked
3. A branch is selected
4. End
