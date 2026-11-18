# Meniscus

**One working day of a Sydney window-cleaning crew, 04:40 to 21:10, told as a film you scroll: the
viewfinder's timecode is the clock of the day, the light follows the real sun for today's date, and
every take cleans something in front of you.**

Meniscus is a fictional commercial exterior-cleaning firm (glass, high-rise on rope, gutters,
façades, pressure cleaning, shopfronts and skylights, solar). The point of view: glass only comes up
spot-free when it dries by gravity, not by evaporation, which needs two zeros: **000 ppm water and
0° of sun on the pane**. So the crews chase the shade, and the site does too. See `CONCEPT.md` for
the palette, type, layout principles and the generic-default check.

```bash
npm install && npm run dev
```

Then open http://127.0.0.1:5323/ (the method statements page is at /services.html).
Live: https://meniscus-delta.vercel.app (pushes to `main` on https://github.com/indi886/meniscus deploy it).
Production: `npm run build && npm run preview` serves http://127.0.0.1:4323/.

## Pages and takes

| # | Time | Take | Named camera move | Motion language |
|---|---|---|---|---|
| 0 | 04:40 | Preloader | Purge | real bytes (fonts, grime texture, the reel's buffered bytes) drive the reading from 062 ppm (Sydney mains) to 000 ppm through carbon, RO and mixed-bed resin; exits as a water sheet draining off under gravity. Nothing plays until it has fully cleared |
| 1 | 05:12 | Hero | Locked-off fan stroke | WebGL pane over the commercial: dust and hard-water rings; a brass squeegee (channel, rubber, handle) cleans it in one three-pass fan stroke, pivoting on the blade's lower end at each edge; the bead of water ahead of the rubber refracts the film; drips run from the turns; the wordmark is pulled from a 75 % to a 125 % width channel as the last pass crosses each letter. Afterwards dew re-forms on the glass (8 to 30 s after each pixel was last wiped) and the pointer is a squeegee that wipes it away |
| 2 | 06:40 | About | Polarizer turn | a circular polarizer travels across a sunrise window; turning it through 90° takes the reflected sky out by Malus's law (cos²θ, fully polarised at Brewster's angle, 56.7° for float glass) and the room behind appears; the disc finally opens to fill the frame |
| 3 | 08:30 | Services | Overhead lane pass | WebGL: each service photo under the grime that service removes; scroll drives a 25° fan jet across it in boustrophedon lanes, top down (wet-dark behind the jet, drying light); the pointer is a second nozzle |
| 4 | 11:00 → 17:20 | Process | Shade-chase orbit | **signature 3D take**: a corner building modelled in Blender, shown as a lit presentation model in a dark studio, under a solar-study dome of today's sun path. Eight scroll-scrubbed steps: survey (lasers, sun path), rig (anchors glint, ropes, exclusion zone), purify (hose fills, HUD reads 062 → 000 ppm), roof (gutter vac swallows leaves, downpipe flush, solar brushed row by row), façade (soft-wash fronts in 2.4 m drops), glass (rope technician descends four drops, then the shopfront by pole), ground (rotary surface cleaner in lanes), reading (golden hour, lights on, site report). The camera always keeps the building between itself and the sun, so the face being worked is the one in shade; tilt-shift depth of field |
| 5 | 17:48 | Work | Rain-pane traverse and plunge | WebGL: a southerly buster beads the glass; each large drop is a lens holding a project upside down; it sticks, slips under gravity (stick-slip), swallows beads and leaves a trail; the camera plunges in, the image collapses through focus and rights itself, holds, and pulls back out |
| 6 | 19:05 | Testimonials | Fan-down tilt | a blade fans down each quote: lines below it are still wet (75 % width, heavier, blurred, behind condensation over a blue-hour city), lines above it dry at 125 % |
| 7 | 19:40 | Team | Truck along the glazing rack | each portrait behind a glazing sample (acid-etched, reeded, grey tint, one-way mirror) that slides away on hover, focus, or (touch) at the middle of the screen; the rack trucks sideways |
| 8 | 20:30 | FAQ | Nozzle change, snap zoom | answers open on grid-template-rows while a spray fan opens at the tip's real angle (0°, 15°, 25°, 40°, soap) |
| 9 | 21:10 | Contact | Tilt-down into the wet forecourt | the lit shopfront tilts out of frame into its reflection in freshly washed pavers; the water's ripple (SVG turbulence, animated through the filter) stills as you arrive and the form surfaces in it |
| — | — | `services.html` | Plate squeegee | seven method statements (scope, method, equipment, standards, readings, cadence); the title is pulled from 75 % to 125 % width on load; each photograph is squeegeed clean as it scrolls through the frame |

Global camera treatment: viewfinder HUD (take, move, lens, the working-day timecode, sun altitude
and the faces in shade computed for today, water at the brush); letterbox bars close on the pinned
3D takes; a two-frame cut pulse between takes; the day's light cross-fades between eight fixed sky
layers by opacity. The HUD blends by difference, so it reads on dark and light takes alike.

## Architecture

```
meniscus/
├── index.html              the film: ten takes, all copy as plain DOM (works without WebGL)
├── services.html           method statements page
├── CONCEPT.md              point of view, palette, type, layout, generic-default check
├── vite.config.ts          two-page build; shots/, assets-src/, scripts/ and *.md not watched
├── public/
│   ├── fonts/              Mona Sans (wdth 75–125, wght 200–900), Newsreader Italic (opsz, wght)
│   └── media/img|video     WebP stills, process fallback stills, reel 1080p/720p + posters
├── assets-src/             raw generations (stills, clips) and request manifests
├── scripts/
│   ├── stills.mjs          retouch (feathered offset clones) + shared grade + WebP sizes
│   ├── reel.mjs            the ffmpeg edit: speed ramps (minterpolate), flash frames, grade
│   ├── posters.mjs         process-take fallback stills captured from the scene itself
│   ├── capture.mjs         headless Chrome (GPU) capture of every take, desktop and 390 px
│   ├── probe.mjs, sheet.mjs  quick state probe; contact sheets for review
└── src/
    ├── main.ts             boot: preloader → intro → background compiles, nearest first
    ├── services-page.ts    second page boot
    ├── dev.ts              dev-only hooks (window.__mn) for the capture scripts
    ├── core/
    │   ├── ticker.ts       the one rAF: the GSAP ticker; everything subscribes by order
    │   ├── scroll.ts       Lenis ↔ ScrollTrigger; takes registry; one progress value per take
    │   ├── hud.ts          viewfinder, letterbox, cut pulse, day-light layers
    │   ├── sun.ts          NOAA solar position for Sydney; shaded faces
    │   ├── cursor.ts       squeegee cursor, lock-on rails, magnetic buttons and type
    │   ├── preloader.ts    purge: byte progress → ppm; gravity exit
    │   ├── assets.ts       streamed fetch with byte progress; texture cache with retries
    │   ├── diag.ts         ?diag panel (GPU, each take's state, errors) for phones
    │   └── util.ts
    ├── gl/
    │   ├── stage.ts        base take: renderer, post, render-only-when-visible, adaptive DPR,
    │   │                   compileAsync + first-frame verification, disposal
    │   └── post.ts         HDR → bright pass → 2-level bloom → anamorphic streak → ACES,
    │                       vignette, live grain; optional thin-lens DOF (tilt-shift in take 4)
    ├── scenes/
    │   ├── hero.ts         film + glass pane, fan-stroke mask (max-blend paint), bead, handle
    │   ├── jet.ts          services: closed-form lanes + pointer strokes, fan jets
    │   ├── process.ts      the 3D take (dirt patch on MeshStandardMaterial, four kinds)
    │   └── rain.ts         droplet-lens gallery with stick-slip
    ├── sections/
    │   ├── hero-ui.ts      wordmark on the width axis, keyed to the blade
    │   ├── takes.ts        about, services, process, work, voices DOM choreography
    │   ├── flow.ts         team, FAQ, contact tilt and ripple, form
    │   ├── stages.ts       mounts the WebGL takes with posters, timeouts, context-loss fallback
    │   └── poster.ts       stills under each canvas until (or unless) its scene runs
    └── styles/main.css     Tailwind v4 + tokens, fluid type, every take's layout
```

Runtime rules this code keeps:

- One rAF: the GSAP ticker drives Lenis, ScrollTrigger, every scene, the HUD and the cursor.
- Sticky stages, each driven by one progress value, so everything scrubs both ways (no pin spacers).
- Each WebGL take renders only while visible, adapts its resolution to frame time, compiles with
  `renderer.compileAsync` (and renders one verification frame) at boot, and disposes on `pagehide`
  and on hot reload. The hero blocks the preloader; the other three compile after the fan stroke so
  nothing stutters the intro, nearest to the visitor first, each in its own try/catch with a stall
  timeout. A take that cannot run (no context, a shader that fails to link, a dropped texture, a
  lost context) stays on its stills while its copy keeps following the scroll.
- Only transform, opacity, filter and grid-template-rows are animated, plus the variable font's width
  and weight axes (the one deliberate exception).
- Reduced motion: no smooth scroll, no intro stroke (the pane starts clean), no magnetic effects,
  instant reveals; the takes still scrub with the scroll.

## The building (Blender)

`scripts/blender/build_building.py` models the process take's corner building procedurally in
headless Blender 5.2, in three.js coordinates so the dirt shader's world-space logic (drops on the
east face, soft-wash fronts, solar rows, gutters) lines up exactly:

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P scripts/blender/build_building.py -- "C:/Users/indik/meniscus"
```

- 1920s Hawkesbury-sandstone corner block: rusticated ground floor with recessed joints and a plinth
  course; ashlar upper floors with punched windows in real 350 mm reveals (architraves, projecting
  sills, keystones, bronze frames with mullion and transom, inset glass); quoins on every stone
  corner; a string course; a three-step cornice; a parapet with aluminium coping
- a 2000s refit on the east face: unitised curtain wall in 1.257 m modules with fritted spandrels,
  pressure-capped mullions and transoms between full-height stone piers; a recessed bronze shopfront
  with clerestory, a blank sign band and a steel blade canopy on tie rods
- roof: membrane deck, galvanised box gutters with outlets, a solar array on aluminium racking, two
  condensers with fan grilles and louvres, a lift overrun, a hatch; a downpipe with rainhead and
  brackets
- bevelled edges on stone, trim and metal; 54,680 triangles; Draco GLB **455 KB**
  (`public/media/model/building.glb`)
- ambient occlusion baked in Cycles (2048², 1.6 m distance) into one UV atlas →
  `public/media/model/building-ao.webp`; three.js applies it as `aoMap`, and the dirt shader also
  darkens crevices with it and lets grime gather where the occlusion is high
- material names are the contract with `src/scenes/process.ts`, which swaps them for the dirt
  materials (stone, trim, base → render dirt; glass_cw, glass_win, glass_shop, spandrel → glass
  dirt; solar → dust) and keeps the rest

## Media pipeline (fal.ai)

- **Stills**: Seedream 4.5 (`fal-ai/bytedance/seedream/v4.5/text-to-image`) at 2560×1440 (portraits
  1920×2400), one shared grade sentence in every prompt; `npm run stills` applies a local retouch
  (the model painted camera-brand lettering on two jackets and a helmet and signage on one building;
  removed by feathered offset clones, no edit model) and a shared grade, and writes WebP sizes.
- **Clips**: MiniMax H3 Max image-to-video (`minimax/h3-max/image-to-video`) at 1080P from seven
  keyframes; audio stripped.
- **Reel**: `npm run reel` (ffmpeg): 24.3 s; real-time → motion-interpolated slow motion → fast;
  two-frame warm flash frames on hard cuts; warm grade and vignette baked; grain added live in the
  browser. 1080p (12.5 MB), 720p (4.4 MB), WebP posters.
- **Process fallback stills**: `node scripts/posters.mjs` captures the 3D take's nine framings from
  the scene itself (desktop and phone).

### Asset spend

| Item | Model | Units | Rate | Estimate |
|---|---|---|---|---|
| 29 stills (7 hero keyframes, 7 services, 6 projects, 2 about, 4 portraits, 1 contact, 2 textures) | Seedream 4.5 | 29 images | $0.04 / image | $1.16 |
| 7 hero clips, 1080P | MiniMax H3 Max | 35 s requested (36.2 s delivered) | $0.0375 / s | $1.31 to $1.36 |
| **Total** | | | | **≈ $2.47 to $2.52**, inside the $5 budget |

Request ids are in `assets-src/manifest-*.txt`. These are estimates from the published rates; the
fal dashboard has the final figure.

## Verification

`node scripts/capture.mjs [--vp desktop|mobile] [--only process] [--reduced] --out shots/passN`
drives the dev server in installed Chrome (ANGLE / Iris Xe, GPU on), waits for exact points on the
intro clock, captures every take at several progress values at 1440×900 and 390×844, samples frame
time with rAF and logs console errors, failed requests and HTTP errors. `?diag` on any URL shows
each take's state on a phone.

### Review passes (screenshots in `shots/`)

| Pass | Problems found in the captures | Fix |
|---|---|---|
| 1 | Rain gallery smeared in a rainbow (post chromatic aberration 50× too strong) and garish saturated bokeh | CA off for that take; bokeh restyled to sodium amber, warm white and rare cool LED, fewer and dimmer discs over a storm teal-grey |
| 1 | The 3D take read as a flat grey clay render under a dull dark sky | rebuilt the look: tilt-shift thin-lens DOF, solar-study dome of today's sun path with hour beads and a compass ring, string courses, deep window reveals |
| 1 | HUD invisible on the light services take | the HUD container blends by difference (children of a z-indexed fixed element can't blend with the page); CTA moved out of it |
| 1 | Hero copy visible before the wipe; blade read as a thin stick; wordmark collided with the readings | copy keyed to the stroke's own clock; thicker rubber, brass channel and a handle; wordmark resized and readings moved up |
| 1 | Polarizer effect too subtle; testimonials take sparse | outside the filter the room is dim under a full sky reflection, inside it is bright; larger disc and bezel. Testimonials gained a blue-hour city behind condensation that the blade wipes away |
| 2 | Process take washed out and fog-white with placeholder-looking neighbour blocks; glass dark brown | moved it into a dark studio: blue-black cyclorama glowing on the sun's side, strip-light reflections in the glass, a round model plinth with a brass edge, no neighbours |
| 2 | Background shader compiles during the intro starved its clock (copy arrived early) | other takes compile only after the fan stroke ends |
| 3 | Hero pane stayed dirty: the paint passes were auto-cleared before every render (and the adaptive DPR loop could resize the mask) | `autoClear = false` while painting (hero mask and the services pointer nozzle); mask sized from CSS pixels and copied on resize |
| 3 | Services dirty glass looked like a flat grey filter; shaded façades went muddy | dirt film modulated by the grime texture, dried runs and ring highlights; a soft fill light from the camera side |
| 3 | Phone: HUD rows collided; About crowded; services sheet ran into the HUD; contact copy on the brightest reflection | phone HUD shows timecode and reading only; About drops the data grid; services sheet trimmed; a dark falloff at the foot of the contact plate |
| 4 | The procedural box building was what held the take back | replaced by the Blender model above, AO baked, verified in every framing on desktop and phone |
| 5 | With the model: the roof membrane and silver coping read as a flat light slab; dust hid the solar cells; the façade wash line was faint; the trailer was a white box; on phones the site report covered the building | dark membrane and darker aluminium; dust lets the cells through; a darker soot tone, a longer wet band and a foam line at the wash front; a rounded trailer with two stainless pressure vessels, a hose reel and a meter that reads the water live (062 → 000 ppm); the report docks at the foot of the frame on phones |
| 5 | The hero only did something once | dew re-forms on the glass after the stroke and the pointer wipes it (desktop pointers only, never with reduced motion) |

Final state: `npm run build` passes (strict TypeScript); `node scripts/smoke-prod.mjs` against the
production preview wheel-scrolls both pages on desktop, phone (390 px) and reduced motion with **0
console errors, 0 warnings, 0 failed requests**, all four WebGL takes up; every take holds 60 fps
(16.7 ms average) in the headless GPU captures on this machine's Iris Xe; ready in about 3.5 s.

Not verified: real Safari / iOS (WebKit on Windows can't render the variable-font axes), a real
low-end phone (the poster stills and `?diag` exist for that).
