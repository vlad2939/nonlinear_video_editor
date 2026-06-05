# Nonlinear Video Editor - User Guide

Nonlinear Video Editor is a local desktop video editing app. You can import video, audio, and image files, organize them on a timeline, add titles and transitions, adjust volume and fades, preview the edit, and export the final result as an MP4 file.

The app is built with Electron, React, and FFmpeg. If `vendor/ffmpeg/win64` exists, the app automatically uses that FFmpeg build for export, including advanced video transitions.

## Starting The App

Recommended on Windows 11:

```bat
start.bat
```

`start.bat`:

- checks whether `npm` is available.
- installs dependencies with `npm install` if `node_modules` is missing.
- checks and prepares the optional MP3 Fit Python environment when `mp3_fit/requirements.txt` exists.
- starts the app with `npm start`.
- opens the Electron window maximized.

MP3 Fit requires Python 3.10 or newer. If Python is missing, the editor still starts, but the audio fitting command will show a warning until Python and the MP3 Fit dependencies are available.

Manual start from a terminal:

```powershell
cd C:\Users\username\Documents\nonlinear_video_editor
npm start
```

Development mode:

```powershell
npm run dev
```

After changing the app code, close the Electron window completely and start it again.

## Main Interface

- Top Bar: project actions: New, Load, Save, Readme, Shortcuts, Export, and theme toggle.
- Media: left panel for importing and organizing media files.
- Preview: center area for playing the current edit.
- Inspector: right panel for the selected clip, PiP, logo, or export settings.
- Timeline Toolbar: editing commands above the timeline.
- Timeline: bottom area with Video 1, Video 2 / PiP, Transitions, Audio, and Titles tracks.

## Dark And Light Themes

The sun/moon button in the Top Bar switches between dark and light theme.

The selected theme is saved locally and remains active after restarting the app. The Readme and Shortcuts popups follow the same theme.

## Importing Media

Use the Import local files button in the Media panel.

Supported types:

- Video: mp4, mov, m4v, mkv, webm, avi.
- Audio: mp3, wav, m4a, aac, flac, ogg.
- Image: jpg, jpeg, png, webp, bmp, gif, tif, tiff.

The Media panel has separate tabs:

- Video: shows only video files.
- Audio: shows only audio files.
- Image: shows only image files.
- Colour: shows a built-in solid colour background item.

Imported files are automatically placed in the correct tab based on their detected media type. If you import only one media type, the app switches to that tab automatically. If you import mixed files, each file appears in its own tab.

Each media file has an individual remove button. If you remove a media file, all timeline clips using that file are removed automatically.

## Adding Clips To The Timeline

Click a file in the Media panel to add it to the timeline.

Rules:

- Video files go to the Video track.
- Images go to the Video track.
- Audio files go to the Audio track.
- Colour backgrounds go to the Video track.
- Insertion happens at the yellow playhead position.
- Images have a default duration of 5 seconds.
- Image duration can be changed in the Inspector, with a minimum of 1 second.
- Colour backgrounds have a default duration of 5 seconds. Their duration and colour can be changed in the Inspector.

You can also drag files from Media onto the timeline. Drag/drop inserts at the mouse drop position.

When Insert Mode is enabled in the Timeline Toolbar, adding or dragging a clip makes exact room for it on the target track. Later clips on that track shift right by the new clip duration and remain attached after repeated moves.

When Insert Mode is disabled, clips are inserted at the playhead or drop position without moving other clips.

## Preview

The Preview area uses a 16:9 aspect ratio. Clips keep their original aspect ratio, and the app adds black bars when needed.

Preview controls:

- Back to start: moves the playhead to the beginning and stops playback.
- Play/Pause: starts or stops playback.

Preview playback includes:

- video clips and images.
- solid colour backgrounds.
- additional audio track playback.
- individual clip volume.
- audio fade in and fade out.
- titles with position and formatting.
- live visual transitions between clips.
- logo overlay preview.
- picture-in-picture clips from Video 2 / PiP.

Playback stops at the end of the edit.

## Timeline

Track order:

- Video 1
- Video 2 / PiP
- Transitions
- Audio
- Titles

The left track header remains fixed while horizontally scrolling. The timeline toolbar remains fixed when vertical scrolling appears.

The playhead stays visible during playback. When it reaches roughly 75% of the visible timeline area, the timeline starts scrolling automatically.

The timeline supports snapping between clips, the playhead, and while trimming. When a clip snaps to an edge or playhead, an orange guide line appears.

The playhead line spans all visible tracks, including Titles.

## Timeline Toolbar

The toolbar above the timeline contains:

- Undo: goes back one edit step.
- Redo: restores an undone edit step.
- Split selected clip: cuts the selected clip at the playhead.
- Copy selected clip: duplicates the selected clip exactly as it is, including trim, duration, volume, fades, title settings, or transition settings, and places the copy slightly offset on the timeline.
- Delete selected clip: removes the selected clip.
- Text: adds a title.
- Transitions: adds a transition at the playhead.
- Logo: selects a logo image and opens Logo settings in the Inspector.
- Insert: turns Insert Mode on or off. Insert Mode keeps clips on the target track attached while making exact room for moved or newly inserted clips.
- Snap: turns magnetic snapping on or off.
- Playhead: includes the playhead as a snap target when Snap is enabled.
- Zoom: changes the timeline scale.
- Zoom to fit: adjusts the zoom so the timeline fits the visible area as well as possible.

Timeline zoom ranges from 10 to 140 px/second.

## Editing Clips

Select a clip in the timeline to edit it in the Inspector.

Common settings:

- Name: clip name.
- Start: start position on the timeline.
- Duration: clip duration.
- Source In: source file in-point, for video/audio.
- Source Out: source file out-point, for video/audio.

Clips can be moved, deleted, copied, and resized directly on the timeline.

Multiple selection:

- Ctrl+click adds or removes individual clips from the selection.
- Shift+click selects a visual range of clips in timeline order.
- Dragging any selected clip moves the whole selected group.
- Delete removes all selected clips.

Right-click a clip to open the context menu:

- Copy
- Delete
- Split
- Duplicate
- Bring to playhead
- Add transition

Right-click an empty space on a non-transition track to open the gap menu:

- Close gap: closes the gap nearest to the clicked point on that track.
- Close all gaps: removes all gaps on that track while preserving clip order.

Insert Mode:

- Off: moving or dropping a clip changes only that clip or selected group.
- On: later clips on the same track make exact room for the moved or inserted clip.
- Transitions stay independent so they can be placed where they are musically or visually useful.

## Audio Volume And Fades

For video and audio clips you can adjust:

- Volume: clip volume.
- Fade in: duration of the audio fade-in.
- Fade out: duration of the audio fade-out.

Volume and fade settings are used in both preview and export.

Audio clips display a waveform-style view on the Audio track. Fade in and fade out zones are highlighted directly over the waveform.

## MP3 Fit Audio Extension

MP3 Fit is integrated as a simplified tool for extending a shorter song so it can cover the current video timeline duration.

Use it when you have a music track that is shorter than the edited video and you want the app to create a longer, musically compatible version automatically.

How to use it:

- Put an audio clip on the Audio track.
- Right-click that audio clip.
- Choose Fit duration to timeline.
- The app opens a popup and generates one fitted version automatically.
- The target duration is taken from the current video timeline length.
- When generation is complete, use the audio preview controls in the popup to listen to the generated file.
- Press Replace in timeline to replace the selected audio clip with the fitted version.

What the app does automatically:

- Saves the generated file next to the original source audio file.
- Uses the name format `original_file_name_fit.mp3`.
- Adds the generated file to the Media panel under the Audio tab.
- Places the new fitted audio clip on the Audio track starting at `0`.
- Keeps the original imported audio file available unless you remove it manually.

Requirements:

- The `mp3_fit/` folder must exist in the editor folder.
- Python 3.10 or newer must be installed.
- Run `start.bat` once so it can create `mp3_fit/.venv` and install the required Python packages.
- The MP3 Fit engine uses the shared FFmpeg files from `vendor/ffmpeg/win64`.

If MP3 Fit is not ready, the popup shows an error explaining that Python 3.10+ and the MP3 Fit dependencies are required.

## Picture-In-Picture

Drag a video, image, or colour background onto the Video 2 / PiP track to create a picture-in-picture overlay.

When a PiP clip is selected, the Inspector shows PiP settings:

- Position: top-left, top-right, bottom-left, bottom-right, or custom.
- Size: small, medium, large, or custom percent.
- Size percent: custom PiP width percentage.
- X and Y: custom position percentages.
- Opacity: PiP transparency.
- Border: show or hide a border around the PiP.
- Shadow: show or hide the Preview shadow.
- Video fade in: visual fade-in duration.
- Video fade out: visual fade-out duration.

PiP appears in both Preview and export. PiP video is muted so it does not duplicate audio; use the Audio track when you need additional sound.

## Titles

Press Text in the Timeline Toolbar to add a title on the Titles track.

Inspector settings:

- Text: title content.
- Size: text size.
- Weight: font weight.
- Color: text color.
- X and Y: title position in the preview.
- Align: text alignment.
- Italic: italic style.
- Opacity: text opacity.
- Background: text background color.
- Background opacity: text background opacity.
- Outline: outline color.
- Outline width: outline thickness.
- Shadow: shadow color.
- Shadow blur: shadow intensity.

Title settings are applied in both preview and export.

## Transitions

Press Transitions in the Timeline Toolbar to add a transition at the playhead. The transition is added to the Transitions track and has a default duration of 2 seconds.

Transitions behave like timeline clips:

- they can be selected.
- they can be moved.
- they can be copied.
- they can be deleted.
- they can be resized.

Inspector settings:

- Transition type: transition effect.
- Transition duration: transition length.

Available types:

- Cross dissolve
- Dip to black
- Dip to white
- Fade
- Wipe left
- Wipe right
- Wipe up
- Wipe down
- Slide left
- Slide right
- Zoom
- Blur dissolve
- Luma fade

Transitions are shown live in Preview. During export, if `vendor/ffmpeg/win64/ffmpeg.exe` is available, the app uses FFmpeg `xfade` so the selected transition types are exported as real video effects.

Export keeps the final duration aligned with the Preview timeline, including projects with multiple transitions.

For best export results, place the transition on or very close to the cut between two consecutive video clips.

## Logo

Press Logo in the Timeline Toolbar to select an image file and open the Logo panel in the Inspector.

Logo settings:

- Add Logo: selects or replaces the logo image.
- Remove logo: clears the selected logo.
- Logo position: top-left, top-right, bottom-left, or bottom-right. Default is top-left.
- Logo size: small, medium, or large. Default is small. Small is capped at about 64 px wide, medium at about 96 px, and large at about 140 px.
- Logo transparency: 0-90%. Default is 50%.

PNG logos with transparent backgrounds are recommended.

The logo appears in both Preview and export with the same position, size, and transparency.

## Export

The Export button in the Top Bar does not start export immediately. It opens the Export panel in the Inspector.

Export settings:

- Preset: applies recommended settings for YouTube 1080p, YouTube 4K, Instagram Reels, TikTok, Facebook, or WhatsApp.
- Resolution: final video resolution.
- FPS: frames per second.
- Quality CRF: compression quality. Lower values mean better quality and larger files.
- Encoding: encoder speed/efficiency preset.
- Audio bitrate: audio quality.

The top bar shows Estimated size when the Export panel is selected.

Press the Export button inside the Inspector to start exporting.

Export includes:

- video clips and images with correct 16:9 framing.
- Video 2 / PiP overlays.
- audio from video clips.
- additional audio track.
- individual volume and audio fades.
- formatted titles.
- selected logo overlay.
- video transitions when the FFmpeg build from `vendor` is available.

The exported file duration is matched to the Preview timeline duration.

## FFmpeg Vendor

The project can include FFmpeg locally in:

```text
vendor/ffmpeg/win64/ffmpeg.exe
vendor/ffmpeg/win64/ffprobe.exe
```

If these files exist, the app uses them automatically. This is the recommended setup because it enables advanced transition export through `xfade`.

If `vendor` is missing, the app falls back to `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe`, but transition export may be limited.

The MP3 Fit integration also uses the same `vendor/ffmpeg/win64` FFmpeg folder, so FFmpeg does not need to be duplicated inside `mp3_fit`.

## Projects

- New: creates a new project. The app asks for confirmation before clearing the current workspace.
- Load: loads a saved project.
- Save: always opens a folder/name selection dialog and saves the project to the selected file.
- Readme: opens this guide in a formatted popup.
- Shortcuts: opens a formatted list of keyboard shortcuts.

Projects are saved as JSON files. The recommended extension is `.nve.json`.

## Autosave And Recovery

The app autosaves a recovery copy of the current project every few minutes while the desktop app is running.

If the app closes unexpectedly, the next launch can show a recovery dialog. Choose Restore to load the autosaved project, or Discard to remove the recovery copy.

Manual Save still opens the normal folder/name dialog and clears the old recovery copy.

## Shortcuts

Playback:

- Space: Play/Pause.
- Home: Back to start.
- End: Jump to the end of the edit.
- Left / Right: move playhead by 1 second.
- Shift+Left / Shift+Right: move playhead by 5 seconds.
- Shift+F: fullscreen Preview.

Timeline editing:

- Delete or Backspace: delete selected clip.
- S: split selected clip at the playhead.
- Ctrl+C: copy selected clip.
- Ctrl+D: duplicate selected clip after itself.
- T: add title.
- R: add transition.
- L: add or replace logo.
- I: toggle Insert Mode.

Timeline view:

- +: zoom timeline in.
- -: zoom timeline out.
- Z: zoom timeline to fit.

Project and panels:

- Ctrl+Z: Undo.
- Ctrl+Y: Redo.
- Ctrl+S: Save.
- Ctrl+O: Load.
- E: open Export panel.
- ?: open Shortcuts popup.
- Escape: close popup or context menu.

Window zoom:

- Ctrl++: increase Electron window zoom.
- Ctrl+-: decrease Electron window zoom.
- Ctrl+0: reset zoom to 100%.

Timeline mouse gestures:

- Mouse wheel: vertical timeline scroll.
- Shift+mouse wheel: horizontal timeline pan.
- Ctrl+mouse wheel: zoom timeline in or out around the cursor.

## Important Files For GitHub

Upload to the repository:

```text
electron/
src/
mp3_fit/
vendor/
assets/
public/
index.html
package.json
package-lock.json
README.md
start.bat
tsconfig.json
vite.config.ts
```

Do not upload:

```text
node_modules/
dist/
dist-electron/
outputs/
work/
```

Recommended `.gitignore`:

```gitignore
node_modules/
dist/
dist-electron/
outputs/
work/
*.log
.DS_Store
Thumbs.db
```

## Workflow Tips

- Move the playhead where you want to insert media before clicking a file in Media.
- Use the Video, Audio, Image, and Colour tabs to find or create timeline elements faster.
- Select a clip on the timeline before editing its Inspector settings.
- Check title position in Preview before exporting.
- Place transitions on the cut between two video clips.
- Use PNG logos with transparent backgrounds for cleaner export overlays.
- Check export settings and estimated size before starting export.
- After app updates, restart the Electron window completely.

**@ concept and implementation vlad39**
