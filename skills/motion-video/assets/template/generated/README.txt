Generated raster plates (textures, background illustrations, styleframes) land here, one file per
manifest.json entry. Most videos need none of this -- only run `node gen-image.mjs` when a scene
genuinely needs a raster background/texture/illustration, never for marks, type, UI or claims (see
references/generated-assets.md). Generate at prep time, into this folder; never at render time.
