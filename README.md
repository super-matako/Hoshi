# Hoshi

A simple SGF viewer and GUI for KataGo to analyze one's Go games.

## KataGo Engine
* Comes pre-packaged with **KataGo OpenCL**, which should run on most devices with no problems. You can change engine specifics (to use your own custom KataGo version/configuration) in the Options.

## How to Download
1. Go to the [Releases page](link-to-releases-here).
2. Download the folder 'Hoshi v.1.0.5' or 'Hoshi v.1.0.5.zip' for the zipped version.
3. Extract the folder and run `Hoshi.exe`. No installation required.

## Keyboard Shortcuts

### Navigation & Tree Control
* `Left Arrow` - Move back 1 move
* `Right Arrow` - Move forward 1 move
* `Shift` + `Left Arrow` / `Page Up` - Move back 15 moves
* `Shift` + `Right Arrow` / `Page Down` - Move forward 15 moves
* `Ctrl` + `Left Arrow` / `Home` - Jump to the start of the game (Root)
* `Ctrl` + `Right Arrow` / `End` - Jump to the very end of the current branch
* `Up Arrow` - Switch to the previous alternative variation
* `Down Arrow` - Switch to the next alternative variation
* `Shift` + `Up Arrow` - Warp backward directly to the primary branch intersection

### Tools & Markup
* `1` - Place Black stone
* `2` - Place White stone
* `3` - Alternate colors (Black/White)
* `Q` - Triangle markup (△)
* `W` - Square markup (□)
* `E` - Circle markup (○)
* `R` - Cross markup (✕)
* `A` - Alphabet markup (Press again to toggle case)
* `S` - Number markup
* `Z` - Eraser tool
* `Shift` + `Click` - Apply active markup tool to an entire group of connected stones

### Analysis & Game Actions
* `Spacebar` - Play / Pause KataGo Analysis
* `C` - Toggle Score Estimate calculation
* `Delete` / `Backspace` - Delete current node (and all future variations)
* `Ctrl` + `Z` - Undo tree/node deletion

### File Operations
* `Ctrl` + `N` - New Game
* `Ctrl` + `O` - Open SGF file
* `Ctrl` + `S` - Save current game
* `Ctrl` + `Shift` + `S` - Save As...

## License
This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE) - see the LICENSE file for details.