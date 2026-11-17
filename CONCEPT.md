# Meniscus — concept

**Meniscus** is a fictional commercial exterior-cleaning firm in Sydney (depot in Alexandria, est. 2011):
shopfront and office glass, high-rise glass on rope, gutters, façades, pressure cleaning, glass doors and
skylights, solar arrays.

## Point of view: two zeros

Glass comes up spot-free only when it dries by gravity, not by evaporation. That needs two zeros:

1. **000 ppm** — water with nothing dissolved in it (carbon → reverse osmosis → mixed-bed DI resin), so
   there is nothing left behind when it dries.
2. **0° of sun on the pane** — a pane in direct sun flash-dries the solution before the blade gets
   there and prints streaks. So the crews **chase the shade**: west faces before 11:00, east faces after
   13:00, south faces whenever, north faces at first and last light.

The site is one working day, 04:40 to 21:10, following the shade around Sydney. Every section is
time-stamped; the colour theme is the light at that hour; the viewfinder HUD's timecode *is* the clock
of the working day, with sun elevation, the face in shade and the water reading beside it. Clean is
never an adjective on this site; it is a reading with a unit and an instrument (ppm, VLT %, kWh,
L/s, P-rating, L*).

## Palette (from the materials of the trade)

| Name | Hex | Source | Role |
|---|---|---|---|
| Curtain Wall | `#0F1B22` | blue-black of tinted glazing at blue hour | dark ground, dark text on light |
| Float Edge | `#8EC5B1` | the green of a float-glass edge (iron oxide) | data, readings, the meniscus line |
| Hawkesbury | `#D9BC8C` | Sydney sandstone | warm light text, sunrise and golden themes |
| Brass Channel | `#B98A47` | the brass channel of a squeegee | interactive: buttons, cursor lock, focus |
| Etch | `#E4EAE6` | acid-etched glass, cool white-green | light-theme ground |
| Spent Resin | `#C47A2C` | DI indicator resin once exhausted (amber) | warnings, "before" readings |

Day themes interpolate between these: 04:40 pre-dawn (Curtain Wall), 06:40 sunrise (warm dark with
Hawkesbury), 09:00 bright (Etch ground), 11–16 h the process take (its own 3D sky), 17:48 southerly
buster (storm teal-grey), 19:05 blue hour, 20:30 night, 21:10 night shift.

## Type

- **Mona Sans** (variable, `wdth` 75–125, `wght` 200–900): display and interface. The animated axis is
  **width = channel width**: words are pulled from a 75 % (6-inch) channel to a 125 % (18-inch) channel
  as a blade passes. Tabular numerals (`tnum`) for every reading.
- **Newsreader Italic** (variable, `opsz`, `wght`): the human voice: testimonials, the about story,
  captions. Never used for labels.

Scale: display up to `clamp(4rem, 19vw, 22rem)`; data arrays at 11–12 px with `tnum`. No all-caps labels,
no monospace, no "·"-joined meta strings, no arrows appended to buttons.

## Layout principles

1. **Mullion grid.** A 12-column grid where every two columns are one 1.5 m curtain-wall pane. Content
   snaps to panes; where the grid is drawn it is drawn as mullions (an aluminium profile with a specular
   line), not as newspaper rules.
2. **The shade side.** Copy sits on the shaded side of the frame. Morning sections weight left, the
   process take flips sides at solar noon, afternoon and evening sections weight right.
3. **Extreme scale contrast.** One massive display line per section against dense, tiny tabular readings.
4. **Every number is a reading.** A number always comes with its unit and the instrument that took it.
5. **Square-cut glass.** No border radius anywhere except the round things in the trade (nozzle tips,
   droplets, the polarizer ring).

## Sections, camera moves, motion languages

| # | Time | Section | Named camera move | Motion language |
|---|---|---|---|---|
| 0 | 04:40 | Preloader | Purge | real bytes drive the TDS reading down to 000 ppm while a DI vessel fills; exits as a water sheet draining off the glass (gravity) |
| 1 | 05:12 | Hero | Locked-off fan stroke | WebGL pane in front of the commercial: grime, hard-water rings and a squeegee S-stroke with a refracting meniscus bead; the film plays behind |
| 2 | 06:40 | About | Polarizer turn | a circular polarizer rotates; sky reflection on a window falls away by Malus's law (cos²θ) at Brewster's angle and the room behind appears |
| 3 | 09:00 | Services | Overhead lane pass | WebGL: each service photo under a grime layer; the pointer is a 25° nozzle cutting overlapping lanes (wet-dark trail that dries light) |
| 4 | 11:00–16:00 | Process | Shade-chase orbit | signature 3D: one corner building cleaned top-down in eight steps while the sun crosses and the camera keeps to the shaded face |
| 5 | 17:48 | Projects | Rain-pane traverse and plunge | WebGL: a southerly buster beads the glass; each drop is a lens holding an inverted project; drops run with stick-slip physics; the camera plunges into one and the image rights itself past the focal point |
| 6 | 19:05 | Testimonials | Fan-down tilt | a blade fans down each quote; lines go from a wet, condensed 75 % width to a dry 125 % width as it passes |
| 7 | 19:40 | Team | Truck along the glazing rack | glass samples (acid-etched, reeded, grey tint, mirror) in front of each portrait slide aside |
| 8 | 20:30 | FAQ | Nozzle change, snap zoom | answers open as spray fans at the tip's real angle (0°, 15°, 25°, 40°, soap) |
| 9 | 21:10 | Contact | Tilt-down into the wet forecourt | the lit shopfront's reflection in freshly washed pavers ripples, then stills into the form |

Global: viewfinder HUD (take, move, lens, timecode of the working day, sun, face in shade, TDS),
letterbox bars on the 3D takes, a cut pulse between takes, and themes that blend by scroll.

Second page: `services.html`, the seven method statements (equipment, standards, readings, cadence).

## Generic-default check (and what changed)

- First instinct was a cream "spec sheet" light theme with a terracotta accent for warnings — that is the
  cream + terracotta default. Replaced the ground with **Etch** (cool green-white of acid-etched glass) and
  the warning colour with **Spent Resin** amber, which is the actual colour exhausted DI resin turns.
- First instinct for HUD and labels was all-caps monospace. Replaced with sentence-case Mona Sans
  at 11 px with tabular numerals; the timecode is the only "technical" string and it is a clock.
- First instinct for services was a 7-card grid. Replaced with one stage and an index of lanes.
- First instinct for the gallery was a horizontal strip of photos. Replaced with droplet optics (trade
  material: water on glass) with stick-slip physics.
- Rack-focus about and condensation panes were used on earlier sites; replaced with the polarizer turn.
