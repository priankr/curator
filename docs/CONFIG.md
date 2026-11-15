# Curator Configuration

Everything is set in one file, `curator.config.json`, at the repo root. It has two sections: `basic` holds what most people change, and `advanced` holds everything else, which defaults to the Curator design.

Only `basic.site.title` and `basic.site.url` are required. Every other key is optional. Run `npm run check` to validate the file without building. It names bad keys and bad values by path, for example `advanced.posters.minContrast must be a number from 1 to 21`.

This page is generated from `src/config.schema.json` and the colour tokens in the CSS by `npm run docs`. Do not edit it by hand. Change the schema or the CSS and run `npm run docs` again.

## Examples

The smallest working config:

```json
{
  "basic": {
    "site": {
      "title": "Sample brand",
      "url": "https://links.example.com"
    }
  }
}
```

A fuller config with a brand. The brand and font values here are the Curator defaults:

```json
{
  "basic": {
    "site": {
      "title": "Sample brand",
      "description": "Links worth keeping, with notes on why.",
      "url": "https://links.example.com",
      "language": "en",
      "socialImage": "./content/images/social.png"
    },
    "collections": {
      "order": [
        "product",
        "repos",
        "visuals"
      ],
      "default": "product"
    },
    "brand": {
      "primary": [
        { "name": "Vermilion", "value": "#e4572e" },
        { "name": "Ultramarine", "value": "#2b4ea2" },
        { "name": "Navy", "value": "#17304f" }
      ],
      "secondary": [
        { "name": "Teal", "value": "#0f6e63" },
        { "name": "Plum", "value": "#5b3a6e" }
      ],
      "accent": [
        { "name": "Marigold", "value": "#f2b134" },
        { "name": "Salmon", "value": "#f08a7b" }
      ],
      "neutral": {
        "light": "#efe7d3",
        "dark": "#1d1b18"
      }
    },
    "fonts": {
      "display": "Fraunces",
      "body": "Archivo",
      "mono": "IBM Plex Mono",
      "poster": "Archivo"
    }
  },
  "advanced": {}
}
```

## Basic Settings

### `basic.site`

Site identity.

| Key | Type and allowed values | Default | Meaning |
|-----|-------------------------|---------|---------|
| `basic.site.title` | non-empty text | required | Wordmark text, page titles and social cards |
| `basic.site.description` | text | `""` | Meta description and the default social card text |
| `basic.site.url` | an http or https address with no path, such as https://links.example.com | required | The deployed origin, used for absolute social card URLs and canonical links |
| `basic.site.language` | non-empty text | `"en"` | The lang attribute |
| `basic.site.socialImage` | non-empty text or null | `null` | Default social card image, used for the home page and for items with no preview image. A .png, .jpg, .jpeg, .gif or .webp file inside the repo, relative to the repo root, whose content matches its extension |

### `basic.collections`

Collection ordering.

| Key | Type and allowed values | Default | Meaning |
|-----|-------------------------|---------|---------|
| `basic.collections.order` | a list of collection ids | `[]` | Collection ids in display order. Collections not listed come after, alphabetically |
| `basic.collections.default` | a collection id or null | `null` | The collection shown at the site root. Null means the first collection |

### `basic.brand`

Brand colours. Drives poster inks and the default accent roles in the scene.

| Key | Type and allowed values | Default | Meaning |
|-----|-------------------------|---------|---------|
| `basic.brand.primary` | list of { name, value } objects, at least 1 | 3 entries, see the fuller example | Primary brand colours, at least one. Each is an object with a name and a hex value. Poster rules and type dots refer to them by name and position |
| `basic.brand.secondary` | list of { name, value } objects | 2 entries, see the fuller example | Secondary brand colours, may be empty. Same shape as primary. Used as poster inks and for some type dots |
| `basic.brand.accent` | list of { name, value } objects | 2 entries, see the fuller example | Accent brand colours, may be empty. Same shape as primary. Used as poster inks, the focus ring and some type dots |

### `basic.brand.neutral`

Neutral colours.

| Key | Type and allowed values | Default | Meaning |
|-----|-------------------------|---------|---------|
| `basic.brand.neutral.light` | a hex colour such as #e4572e | `"#efe7d3"` | Light neutral. Poster paper, and the light text colour on dark fills |
| `basic.brand.neutral.dark` | a hex colour such as #e4572e | `"#1d1b18"` | Dark neutral. The dark text colour on light fills, and poster paper on the inverse set |
| `basic.brand.neutral.surface` | a hex colour such as #e4572e | none | Surface neutral, a second paper tone for posters. Derived from the light and dark neutrals when omitted |
| `basic.brand.neutral.muted` | a hex colour such as #e4572e | none | Muted neutral, a quiet mid tone. Derived from the light and dark neutrals when omitted |

### `basic.fonts`

The four main font roles, as Google Fonts family names. Self hosting serves the same families from your own site.

| Key | Type and allowed values | Default | Meaning |
|-----|-------------------------|---------|---------|
| `basic.fonts.display` | non-empty text | `"Fraunces"` | Titles and wordmark |
| `basic.fonts.body` | non-empty text | `"Archivo"` | UI text |
| `basic.fonts.mono` | non-empty text | `"IBM Plex Mono"` | Labels and counters |
| `basic.fonts.poster` | non-empty text | `"Archivo"` | Poster title band and poster type |

## Advanced Settings

### `advanced`

Everything else, defaulting to the Curator design.

| Key | Type and allowed values | Default | Meaning |
|-----|-------------------------|---------|---------|
| `advanced.types` | an object keyed by type name | `{}` | Per-type overrides keyed by type name, each with an optional label and dot. The dot is a colour role such as accent.1 |

### `advanced.fonts`

Extra font roles and font loading.

| Key | Type and allowed values | Default | Meaning |
|-----|-------------------------|---------|---------|
| `advanced.fonts.typewriter` | non-empty text | `"Special Elite"` | Slide label font for typed labels |
| `advanced.fonts.handwriting` | non-empty text | `"Caveat"` | Slide label font for handwritten labels |
| `advanced.fonts.source` | `"google"` or `"self"` | `"google"` | google loads from Google Fonts. self downloads the font files at build time and serves them from the output folder |
| `advanced.fonts.googleFontsUrl` | an https address or null | `null` | Overrides the Google Fonts URL the build generates, for custom weights or axes. When set, the family check against Google Fonts is skipped |

### `advanced.posters`

Poster generation for items without an image.

| Key | Type and allowed values | Default | Meaning |
|-----|-------------------------|---------|---------|
| `advanced.posters.avoidPairs` | a list of colour name pairs | `[]` | Pairs of colour names that never appear together in a poster, for example [["Lime", "Orange"]] |
| `advanced.posters.excludeFromPosters` | a list of colour names | `[]` | Brand colours never used as poster ink or paper |
| `advanced.posters.inverseShare` | number from 0 to 1 | `0.25` | Share of posters printed on dark paper, a primary colour or the dark neutral |
| `advanced.posters.primaryShare` | number from 0 to 1 | `0.75` | Target share of primary colours across a collection's posters |
| `advanced.posters.minContrast` | number from 1 to 21 | `1.6` | Minimum ink to paper contrast ratio |
| `advanced.posters.compositions` | "all" or a list of composition numbers from 1 to 16 | `"all"` | all, or a list of composition numbers 1 to 16 to allow |

### `advanced.scene`

Scene selection and behaviour.

| Key | Type and allowed values | Default | Meaning |
|-----|-------------------------|---------|---------|
| `advanced.scene.name` | an id using lowercase letters, numbers and hyphens | `"lighttable"` | Which scene folder in src/scenes to mount. Only lighttable ships |
| `advanced.scene.pageSize` | whole number from 1 to 100 | `12` | Slides per table page |
| `advanced.scene.motion` | `"normal"` or `"fast"` or `"off"` | `"normal"` | Motion level. normal is the full design, fast shortens animations, off removes them |
| `advanced.scene.colors` | an object of colour overrides | `{}` | Overrides for any scene colour token, keyed by token name without the leading dashes, for example table-frame-top. Brand-driven role tokens cannot be overridden |

### `advanced.images`

Image fetching behaviour. Links to local or private network addresses are never fetched and get a poster.

| Key | Type and allowed values | Default | Meaning |
|-----|-------------------------|---------|---------|
| `advanced.images.fetch` | true or false | `true` | Fetch preview images at build time |
| `advanced.images.timeoutMs` | whole number from 1000 to 120000 | `15000` | Timeout for each image request in milliseconds |
| `advanced.images.maxBytes` | whole number from 10000 to 50000000 | `3000000` | Largest image accepted in bytes |
| `advanced.images.fitDomains` | a list of hostnames | `["github.com"]` | Hostnames whose images are shown fitted rather than cropped |

### `advanced.build`

Build output.

| Key | Type and allowed values | Default | Meaning |
|-----|-------------------------|---------|---------|
| `advanced.build.outDir` | a relative folder path such as dist | `"dist"` | Output folder, relative to the repo root |
| `advanced.build.itemPages` | true or false | `true` | Write a page for each item. Turn off only for very large sites: item links then load through 404.html, with a not found status and no item preview card |

## Brand Colours

The brand has three lists of named colours, `primary`, `secondary` and `accent`, plus a `neutral` object. The lists can be any length, so lean and large brands both work. The repo ships the Curator default brand, and `docs/examples/sample-brand.json` as a second, lean example with one secondary and one accent.

**Poster inks and paper.** Items without an image get a generated poster. Light posters use the light neutral (or surface) as paper with three brand inks. Inverse posters use a primary or the dark neutral as paper, and about `advanced.posters.inverseShare` of posters are inverse. Each poster has at least one primary ink, three distinct inks, no `avoidPairs` pair together and every ink at least `advanced.posters.minContrast` against the paper. Across a collection, primaries make up about `advanced.posters.primaryShare` of ink use. The title band uses whichever ink reaches 4.5:1 on the paper, else the dark or light neutral.

**Avoiding and excluding colours.** `advanced.posters.avoidPairs` lists pairs of colour names that never share a poster. `advanced.posters.excludeFromPosters` lists colours that are never used as poster ink or paper. Both use the `name` of a brand colour.

**Scene roles.** A few colours in the scene follow the brand and cannot be overridden in `advanced.scene.colors`, because the build computes them from the brand and keeps their contrast readable.

- The Visit button fill and the active collection menu item fill are accent 1, else primary 1. Hover and pressed shades of the Visit button are derived from it.
- The text on both is the dark or light neutral, whichever contrasts more with primary 1. When neither reaches 4.5:1, the text is black or white and the build warns.
- The keyboard focus ring is accent 1, else primary 1.
- Each content type has a dot colour, set by role. See Type overrides.

## Type Overrides

`advanced.types` changes the label and dot colour of a content type, keyed by type name. The types are `webpage` (the fallback for any other link), `video`, `repo`, `image` and `article` (only for items that set `type: article`):

```json
{
  "advanced": {
    "types": {
      "repo": {
        "label": "Project",
        "dot": "accent.1"
      }
    }
  }
}
```

The `dot` is a colour role written as a tier and a zero based index. `primary.0` is primary 1, `secondary.0` is secondary 1 and `accent.1` is accent 2. A role beyond the brand's list for that tier is still valid. The first colour of that tier is used instead, and `npm run check` warns. The label is used on the slide, the open screen, the slide's accessible name and the screen reader list.

## Fonts

There are six font roles, all configurable. `display` sets titles and the wordmark, `body` the UI text, `mono` labels and counters, `poster` the poster title band and poster type, `typewriter` typed slide labels and `handwriting` handwritten slide labels. The first four live under `basic.fonts` and the last two under `advanced.fonts`. Each role takes a family that Google Fonts offers, and several roles may share one. Every role has a fallback stack.

With `advanced.fonts.source` set to `google` (the default), the build generates one Google Fonts URL for the configured families. Set `advanced.fonts.googleFontsUrl` to replace that URL, for custom weights or axes. With `source` set to `self`, the build downloads the same Google Fonts files at build time and serves them from `dist/fonts/`, so visitors make no third-party requests.

Unless `googleFontsUrl` is set, the build checks each family against Google Fonts. A family it cannot find is reported as an error naming the family, so check the spelling. `npm run check` runs the same check, and skips it when `source` is `self`.

## Scene Colour Tokens

Every colour in the light table scene is a token with a default. Override any token in `advanced.scene.colors`, keyed by the token name without the leading dashes:

```json
{
  "advanced": {
    "scene": {
      "colors": {
        "page-room": "#101820",
        "glass-center": "rgba(255, 255, 255, 0.9)"
      }
    }
  }
}
```

A value can be a hex colour (`#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`), an `rgb()`, `rgba()`, `hsl()` or `hsla()` colour written with plain numbers and percentages, or `transparent`. Named colours and `var()` are not accepted. An unknown token or a bad value is reported by `npm run check`.

Tokens marked brand-driven cannot be overridden. They follow `basic.brand` so the Visit button, the active collection menu item and the focus ring always match the brand and stay readable. Change the brand instead.

### `page`

| Token | Default | Colours |
|-------|---------|---------|
| `page-bg` | `#17140f` | Page background behind the scene |
| `page-room` | `#0e0f11` | Room backdrop behind the tables, and the scrim under the heading |
| `page-room-glow` | `rgba(236, 242, 214, .07)` | Soft light pooled in the middle of the room |
| `page-scrollbar` | `#3a3c40` | Scrollbar thumb of the room |
| `page-booth-center` | `rgba(22, 20, 17, .93)` | Dimmed room behind the projector, near the bottom centre |
| `page-booth-edge` | `rgba(4, 4, 5, .985)` | Dimmed room behind the projector, towards the edges |

### `chrome`

| Token | Default | Colours |
|-------|---------|---------|
| `chrome-ink` | `#f1e9d6` | Text and icons on the top bar, collection heading, chips and arrows |
| `chrome-dim` | `rgba(241, 233, 214, .62)` | Quiet text on the top bar and collection heading |
| `chrome-pill-on-fill` (brand-driven) | `#f2b134` | Fill of the active collection menu item, follows accent 1 else primary 1 |
| `chrome-pill-on-text` (brand-driven) | `#1d1b18` | Text of the active collection menu item, the neutral that reads best on it |
| `chrome-chip-on-fill` | `#f2b134` | Fill of a pressed tag filter chip |
| `chrome-chip-on-text` | `#1b1814` | Text of a pressed tag filter chip |
| `chrome-focus` (brand-driven) | `#ffd24a` | Keyboard focus ring, follows accent 1 else primary 1 |
| `chrome-arrow-fill` (brand-driven) | `#f2b134` | Fill of the round side arrows, follows accent 1 else primary 1 |
| `chrome-arrow-icon` (brand-driven) | `#1d1b18` | Chevron of the round side arrows, the neutral that reads best on the fill |

### `button`

| Token | Default | Colours |
|-------|---------|---------|
| `button-visit-fill` (brand-driven) | `#f2b134` | Fill of the Visit button, follows accent 1 else primary 1 |
| `button-visit-hover` (brand-driven) | `#f4ba4c` | Fill of the Visit button on hover, a shade of its fill |
| `button-visit-pressed` (brand-driven) | `#d59c2e` | Fill of the Visit button while pressed, a shade of its fill |
| `button-visit-text` (brand-driven) | `#1d1b18` | Text of the Visit button, the neutral that reads best on it |
| `button-face-top` | `#65676c` | Top of the paging button face |
| `button-face-mid` | `#36383c` | Middle of the paging button face |
| `button-face-bottom` | `#27282b` | Bottom of the paging button face |
| `button-edge` | `#050506` | Lower edge of the paging buttons, which shows as depth |
| `button-icon` | `#141416` | Arrow on the paging buttons |
| `button-focus` | `#ffb27d` | Keyboard focus ring on the paging buttons |

### `table`

| Token | Default | Colours |
|-------|---------|---------|
| `table-frame-top` | `#414347` | Top of the light table frame |
| `table-frame-bottom` | `#1d1e21` | Bottom of the light table frame |
| `table-screw-light` | `#c9c9c5` | Highlight on the frame screws |
| `table-screw-dark` | `#55565a` | Shaded side of the frame screws |
| `table-plate-text` | `#b9b6aa` | Collection name and range on the table plate |
| `table-plate-title` | `#f1e9d6` | Bold table label on the table plate |
| `table-slide-focus` | `#d2401f` | Keyboard focus ring on a slide |

### `glass`

| Token | Default | Colours |
|-------|---------|---------|
| `glass-center` | `#f7f9ef` | Light panel glass in the middle |
| `glass-edge` | `#e3e7d6` | Light panel glass towards the edges |
| `glass-grid` | `rgba(60, 90, 120, .09)` | Faint grid lines on the glass |
| `glass-inner-glow` | `rgba(110, 125, 80, .28)` | Greenish glow inside the glass edge |
| `glass-halo` | `rgba(236, 242, 214, .2)` | Light spilling out around the glass |

### `mount`

| Token | Default | Colours |
|-------|---------|---------|
| `mount-fallback` | `#ebe4d0` | Mount colour when a slide has no mount style |
| `mount-text` | `#3a342c` | Label text on a mount with no mount style |
| `mount-shadow` | `rgba(30, 40, 20, .4)` | Long soft shadow under each slide |
| `mount-cream` | `#f3ecd6` | Cream slide mount |
| `mount-white` | `#f4f4ef` | White slide mount |
| `mount-grey` | `#8f9699` | Grey slide mount |
| `mount-grey-text` | `#15171a` | Label text on the grey mount |
| `mount-black` | `#1e1f21` | Black slide mount |
| `mount-black-text` | `#f1efe6` | Label text and handwriting on the black mount |
| `mount-window` | `#101010` | Film window behind the picture in each mount |
| `mount-fit-bg` | `#fff` | Background behind pictures shown whole, on mounts and on the screen |

### `label`

| Token | Default | Colours |
|-------|---------|---------|
| `label-accent` | `#b3262b` | Red number and domain on the cream and white mounts |
| `label-hand` | `#1f3c8a` | Handwritten slide labels, blue ink |
| `label-grey-plate` | `#f4f1e6` | Paper strip under the picture on the grey mount |
| `label-grey-plate-text` | `#222` | Text on the paper strip of the grey mount |

### `screen`

| Token | Default | Colours |
|-------|---------|---------|
| `screen-roller-top` | `#55575b` | Top of the screen roller |
| `screen-roller-mid` | `#26272a` | Middle of the screen roller |
| `screen-roller-bottom` | `#101012` | Bottom of the screen roller |
| `screen-roller-edge` | `rgba(222, 218, 200, .5)` | Lit edge along the bottom of the screen roller |
| `screen-roller-cap` | `#1a1b1d` | Outer shade of the roller end caps |
| `screen-roller-cap-mid` | `#46484c` | Centre of the roller end caps |
| `screen-fabric` | `#34342f` | Screen fabric, lit middle |
| `screen-fabric-edge` | `#232325` | Screen fabric towards the edges |
| `screen-side` | `#08080a` | Dark side borders of the screen |
| `screen-bar-top` | `#3a3c40` | Top of the weighted bar at the foot of the screen |
| `screen-bar-bottom` | `#0d0d0e` | Bottom of the weighted bar at the foot of the screen |
| `screen-pull` | `#88898d` | Pull cord and ring under the screen |
| `screen-image-bg` | `#131313` | Projected picture area before the image shows |
| `screen-glow` | `rgba(255, 238, 196, .22)` | Glow around the projected picture |

### `caption`

| Token | Default | Colours |
|-------|---------|---------|
| `caption-text` | `#f4ecd9` | Title, notes and counter on the screen |
| `caption-glow` | `rgba(255, 238, 196, .28)` | Faint glow behind the screen text |
| `caption-kicker` | `#ffb27d` | Type label above the title on the screen |

### `beam`

| Token | Default | Colours |
|-------|---------|---------|
| `beam-base` | `rgba(255, 238, 196, .5)` | Projector beam at the lens |
| `beam-tip` | `rgba(255, 238, 196, .07)` | Projector beam where it reaches the screen |

### `projector`

| Token | Default | Colours |
|-------|---------|---------|
| `projector-body-light` | `#4a4c50` | Top highlight of the projector body |
| `projector-body-mid` | `#323437` | Projector body just under the highlight |
| `projector-body-seam` | `#232427` | Seam line across the projector body |
| `projector-body` | `#17181a` | Projector body |
| `projector-slot` | `#050505` | Slide slot on top of the projector |
| `projector-vent-slot` | `#060606` | Dark gaps in the projector vent |
| `projector-vent-rib` | `#2b2c2f` | Ribs of the projector vent |
| `projector-vent-lit` | `#7a4a18` | Vent gaps while the lamp is lit |
| `projector-vent-glow` | `rgba(255, 190, 110, .35)` | Glow from the vent while the lamp is lit |
| `projector-lamp-off` | `#3d1210` | Indicator lamp when off |
| `projector-lamp-on` | `#ff5a36` | Indicator lamp when lit, and its glow |
| `projector-knob-top` | `#5a5c60` | Highlight on the projector knob |
| `projector-knob-bottom` | `#17181a` | Shade on the projector knob |
| `projector-knob-ring` | `#0c0c0d` | Ring around the projector knob |
| `projector-power-icon` | `#e4e5e8` | Power symbol on the projector knob |
| `projector-pad` | `#09090a` | Recess that holds the projector buttons |

## More

For how tokens, role colours, fonts and posters work in the code, see [Design Values in ARCHITECTURE.md](ARCHITECTURE.md#9-design-values).
