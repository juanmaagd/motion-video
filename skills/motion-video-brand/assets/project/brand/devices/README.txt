Drop a device frame here for this project only (references/device-frames.md):
- A licensed SVG frame (body/screen/overlay contract) -- copy from the skill's assets/devices/ or
  your own user library.
- An official Apple bezel PNG -- download once from developer.apple.com/design/resources (Product
  Bezels), accept Apple's licence yourself, drop the PNGs here, then run
  `python3 detect-frame.py brand/devices/<name>.png` to write its sidecar.
Nothing here ships with the skill and nothing is auto-downloaded; the generic frame
(engine.js's genericDeviceFrame()) needs none of this and works with an empty folder.
