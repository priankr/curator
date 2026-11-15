# Getting Started with Curator

This manual takes you from a fresh copy of the repo to a live site. You run it locally, write your collections, set your site and brand, check the result and deploy. Read it top to bottom the first time, then return to the section you need.

Every step that changes something ends with a "You will see" line. It is an observable check, so a person or an agent can confirm the step worked before moving on.

## Requirements

- Node 20 or newer. Run `node --version` to check.
- Your own copy of this repo in a Git repository you can push to. Fork it, or clone it and push it to a new repository. Either way keeps its history, so you can pull Curator updates later (see [FAQs](#faqs)).
- A terminal open in that copy.
- A static host for the deploy step.

There is nothing to install. Curator has no dependencies, so you never need `npm install`.

You will see: `node --version` prints `v20` or a higher number.

## What You Edit

- `content/`: your Markdown collections and the images in `content/images/`.
- `curator.config.json`: every setting.

The repo ships with three sample collections (`product`, `repos` and `visuals`), their images in `content/images/` and a config that names them. Replace them with your own as [Replace the samples](#replace-the-samples) describes.

Leave `src/` and `scripts/` as they are unless you want to change how Curator behaves. `dist/` and `.cache/` are generated, so never edit them.

## Run It Locally

1. Run `npm run dev`.
2. Open `http://localhost:4321`.

The site rebuilds when you change `content/`, `src/` or the config. Run `npm run dev -- --port <n>` to use another port.

You will see: the terminal reports the server is running, and the browser shows the light table with slides.

## Write Your Collections

Each collection is one Markdown file in `content/`. The file name without `.md` is the collection id and its URL, so `content/reading.md` is served at `/reading/`. Use lowercase letters, digits and hyphens in the name.

A new collection needs no config change. Collections not listed in `basic.collections.order` appear after the listed ones, in alphabetical order.

### Replace the samples

1. Delete the sample files in `content/` that you do not want, and add your own.
2. In `curator.config.json`, set `basic.collections.order` and `basic.collections.default` to your own collection ids, or set them to `[]` and `null`. Until you do, `npm run check` reports an error such as `basic.collections.order names "tools", but there is no content/tools.md.`
3. Replace `content/images/social.png` with your own social card image, or set `basic.site.socialImage` to `null`. Delete any sample images you no longer use.

You will see: `npm run check` reports 0 errors.

### Create a collection from a list of links

Write a collection by hand, or give your agent a list of links and have it write the file. Either way, follow these steps.

1. Choose a file name such as `content/reading.md`.
2. Start the file with front matter that has a `title`. See [Front matter](#front-matter).
3. Add one item per link, in the order you want the slides. Each item is a `##` heading with a short title, then a `url` line directly under it. Curator does not fetch page titles, so write each title yourself. See [Items and fields](#items-and-fields).
4. Add a `tags` line if you want to filter the collection by tag. Leave out `type` and `image`, because Curator infers the type and finds a preview image. Set them only to override that, as [Types](#types) and [Images](#images) describe.
5. Add notes after a blank line when you have something to say about a link. Notes are optional.
6. Run `npm run check` and fix anything it reports. See [Common check messages](#common-check-messages).

To have your agent do it, give it your links with a request such as:

```
Read the Write Your Collections section of docs/GETTING-STARTED.md, then turn these links into a new collection at content/reading.md titled "Things worth reading". Keep my order, write a short title for each link and leave out notes. Run npm run check and fix anything it reports.
```

You will see: `npm run check` reports 0 errors, and the new collection appears on the dev site.

### A complete example

```markdown
---
title: Things worth reading
short: Reading
description: Articles, talks and projects I keep coming back to.
---

## An article about slow software
url: https://example.com/articles/slow-software
type: article
tags: essays, craft
image: auto

A short argument for software that takes its time. The *second* section is the one to read, and it links to [the follow up](https://example.com/articles/follow-up).

Notes can run to several paragraphs. Use `code` and **strong** text where it helps.

## A talk on small tools
url: https://example.com/talks/small-tools
type: video
tags: talks

This one sets its type by hand.

## A sketch of the idea
url: https://example.com/sketch
image: ./images/sketch.png

This item uses an image uploaded to the content folder.

## A page with no picture
url: https://example.com/plain
image: none

This item gets a generated poster.
```

### Front matter

The block between the two `---` lines at the top of the file describes the collection.

- `title` is required.
- `short` is the label in the collections menu. It defaults to `title`.
- `description` is optional.

Other keys draw a warning, and text before the first `##` heading is ignored.

### Items and fields

A `##` heading starts an item, and its text is the item title. Keep titles to about 35 characters to show them in full on the slide label. Longer titles are cut at a whole word on the label and shown in full when the slide is opened. The `key: value` lines directly under it, with no blank line in between, are the fields. The first line that is not a `key: value` line ends them, so leave a blank line before the notes. Everything after the fields, up to the next `##`, is the notes. Notes are optional. Items appear on the table in the order they appear in the file.

- `url` is required. It must be an absolute `http` or `https` address.
- `type` is optional. See Types below.
- `tags` is optional and is a comma separated list.
- `image` is optional. See Images below.

Field names are not case sensitive. If a field appears twice, the first value is used.

Each item's look comes from its title: its poster colours and layout, and its slide mount and caption style. The same title always looks the same, so renaming an item gives it a new look.

### Notes

Notes support paragraphs, `*emphasis*`, `**strong**`, `` `code` `` and `[links](https://example.com)`. Only `http` and `https` links render as links, and any other text stays plain. Raw HTML is escaped and shown as text.

### Images

- `image: auto` is the default. Curator finds a preview image for the link at build time.
- `image: none` gives the item a generated poster.
- A path such as `./images/sketch.png` is relative to `content/`, unlike `basic.site.socialImage`, which is relative to the repo root. Keep your own images in `content/images/`. The file must be a `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` or `.svg` inside `content/`, and its content must match its extension. An SVG can be up to 100 KB.

For `auto`, Curator uses the first of these that works:

1. The video thumbnail, for a link to a known video site.
2. The repository's social preview, for a link to a repository on a known code host.
3. The link itself, when it points straight to an image.
4. The page's preview image, from its `og:image` or `twitter:image` tag.

If none of them works, the item gets a poster and the build warns. Links to local or private network addresses always get a poster. A fetched image is cached in `.cache/`, so later builds reuse it. Run `npm run build -- --refresh-images` to fetch every image again, or `npm run build -- --refresh-images=<collection>/<item>` for one item.

The `image` field takes `auto`, `none` or a path, never a web address. To use a specific picture from the web, save it into `content/images/` and set `image` to its path.

### Types

The types are `webpage`, `video`, `repo`, `image` and `article`. Set `type` by hand, or leave it out and Curator infers it from the URL:

- Links to known video sites give `video`.
- Repository paths on known code hosts give `repo`.
- Links ending in an image extension give `image`.
- Everything else gives `webpage`. The `article` type is never inferred, so set `type: article` on the items you want to show that way.

### Item ids and URLs

An item id is the slug of its title: lowercase, apostrophes removed, and every run of other characters turned into `-`. "A sketch of the idea" becomes `a-sketch-of-the-idea` and is served at `/reading/a-sketch-of-the-idea/`.

Two items with the same slug get `-2`, `-3` and so on, and the build warns. Rename one of them to give it a link of its own.

### How many items

Curator suits 10 to 100 items per collection. Larger collections work through paging. Past about 100 items the check warns that it is a library, not a collection, and suggests splitting it.

### Common check messages

Run `npm run check` to see these. Errors stop the build, and warnings do not. Each message names the file, the item and the fix.

Errors:

```
content/tools.md, "uv" (line 4): url is missing. Add a line such as url: https://example.com/page under the heading.
content/tools.md, "uv" (line 4): url "example.com/page" must be an absolute http or https address, such as https://example.com/page.
content/tools.md, "uv" (line 4): type "blog" is not a known type. Use one of webpage, video, repo, image, article.
content/tools.md, "uv" (line 4): image file "./images/missing.png" was not found in the content folder.
content/Reading List.md: the file name must use lowercase letters, digits and hyphens only, such as tools.md.
content/tools.md: the collection has no title. Add a title line to the front matter at the top of the file.
```

Warnings:

```
content/tools.md, "uv" (line 4): unknown field "tag" on line 6. Known fields are url, type, tags and image. Did you mean tags?
content/tools.md, "uv" (line 4): another item has the same link name, so this one becomes uv-2. Rename it to give it a link of its own.
content/tools.md: text before the first ## heading is ignored.
```

You will see: `npm run check` ends with a line such as `Checked 3 collections and 31 items: 0 errors, 0 warnings.`, and your slides appear on the running dev site.

## Set Your Site and Brand

Open `curator.config.json`. Only two settings are required, both under `basic.site`:

- `title` is the wordmark and the page title.
- `url` is the exact origin you will deploy to, with no path, such as `https://links.example.com`.

Next, most people set a few of these:

- `basic.site.description` and `basic.site.socialImage` for search results and preview cards. The social image path is relative to the repo root, such as `./content/images/social.png`.
- `basic.collections.order` and `basic.collections.default` to choose which collection leads.
- `basic.brand` for colours and `basic.fonts` for typefaces. Copy [examples/sample-brand.json](examples/sample-brand.json) as a lean starting brand.

For every other setting, see [Basic Settings in CONFIG.md](CONFIG.md#basic-settings), [Brand Colours in CONFIG.md](CONFIG.md#brand-colours) and [Fonts in CONFIG.md](CONFIG.md#fonts). Type labels and dot colours are in [Type Overrides in CONFIG.md](CONFIG.md#type-overrides).

You will see: the dev site shows your title and colours after the automatic rebuild, and `npm run check` still reports 0 errors.

### Check your theme

The theme page shows every colour, poster and font your config produces, drawn by the same code as the site. It exists only while `npm run dev` runs and is never part of the build.

1. With `npm run dev` running, open `http://localhost:4321/__theme/`.
2. Change `basic.brand`, `basic.fonts` or `advanced.posters` in `curator.config.json`, wait for the rebuild, then reload the page.
3. Repeat until the page passes the checks below.

You will see: the "Measured against the targets" table shows "met" in both rows that can pass or miss, no Warning card appears under Scene roles, and no poster looks muddy or hard to read.

What each section shows, and what to look for:

- **Brand switch:** toggles the page between your brand and the Sample brand from [examples/sample-brand.json](examples/sample-brand.json), for comparison. It changes this page only, never your config.
- **Brand tokens:** your primary, secondary, accent and neutral colours, your avoided pairs and the colours kept out of posters. Check every colour you set appears with the right value.
- **Scene roles:** the colours the build works out from your brand for the Visit button, the current collection in the menu, the focus ring and the type dots, with their contrast. A Warning card means neither of your neutrals reads well enough on accent 1, as text on the Visit button or as the icon on the side arrows, so the build uses black or white instead. Choose a different accent 1 or neutral, as the warning says.
- **Poster ink sets:** the paper colours and the inks that read on each, with sample posters. The table below them measures your content against `advanced.posters`. The two contrast and avoided pairs rows must show "met". The two share rows only need to be close, and a small collection can sit a little off.
- **Fonts:** a sample line in each of the six font roles, with where the site uses it. If a line looks like a plain system font, the font name is wrong or failed to load.
- **Scene colours:** every colour token of the light table, grouped by object. Tokens marked "role" follow your brand. Tokens marked "overridden" come from `advanced.scene.colors`, with the default shown beside them.
- **The sixteen** and **One item, sixteen ways:** the sixteen poster layouts, first across your items, then one item in every layout. Look for a title band that is hard to read or ink that clashes with its paper.

## Check and Preview

1. Run `npm run check`.
2. Run `npm run build`. It writes the site into `dist/`.

Add `--offline` to `check` or `build` to skip every network request and use only what is cached.

You will see: both commands exit cleanly, `npm run check` prints 0 errors, and `dist/` holds `index.html`, `404.html` and one folder per collection. [Troubleshooting in DEPLOY.md](DEPLOY.md#troubleshooting) lists the common errors with their fixes.

## Deploy

1. Push the repo to a static host that rebuilds on every push.
2. Set the build command to `npm run build`, the output folder to `dist` and the Node version to 20 or newer. See [What Any Static Host Needs in DEPLOY.md](DEPLOY.md#what-any-static-host-needs).
3. Attach your domain and turn on HTTPS. Serve Curator at the root of a domain or subdomain. See [Domains in DEPLOY.md](DEPLOY.md#domains).
4. Make sure the host serves `404.html` for unknown paths. See [Routes and the 404 Page in DEPLOY.md](DEPLOY.md#routes-and-the-404-page).

You will see: the host reports a successful build, and your domain loads the home page over HTTPS.

## After Deploying

1. Open the home page, a collection, an item page and an unknown path such as `/nope/` on the live domain.
2. Run the checks in [Check the Live Site in DEPLOY.md](DEPLOY.md#check-the-live-site).

You will see: every route loads directly, an unknown path shows the "Page not found." note, and pasting an item link into a chat or social tool shows a preview card.

## Changing How It Works

Settings cover most needs. To change behaviour they cannot reach, start with [Overview in ARCHITECTURE.md](ARCHITECTURE.md#1-overview) and [Repository Map in ARCHITECTURE.md](ARCHITECTURE.md#2-repository-map). Then work in `src/` or `scripts/`, and follow [Rules for Changes in ARCHITECTURE.md](ARCHITECTURE.md#12-rules-for-changes).

You will see: `npm test` and `npm run test:browser` pass, and the docs match the new behaviour.

## FAQs

**How do I add a collection?** Add a Markdown file such as `content/reading.md` with a `title` in its front matter. See [Write Your Collections](#write-your-collections).

**How do I choose which collection opens first, and their order?** Set `basic.collections.default` and `basic.collections.order`. See [basic.collections in CONFIG.md](CONFIG.md#basiccollections).

**Why does an item show a poster instead of a picture?** Curator could not find a preview image for the link, or the item sets `image: none`. See [Images](#images).

**How do I give an item a picture of my choice?** Save the picture in `content/images/` and set `image: ./images/<file>`. See [Images](#images).

**A source site changed its preview image. How do I get the new one?** Run `npm run build -- --refresh-images=<collection>/<item>`. See [Images](#images).

**Why did an item's poster and slide change?** Its look comes from its title, so renaming it gives it a new look. See [Items and fields](#items-and-fields).

**How do I change the colours?** Set `basic.brand` in `curator.config.json`, then check it on the theme page. See [Brand Colours in CONFIG.md](CONFIG.md#brand-colours).

**How do I change the fonts?** Set `basic.fonts` to Google Fonts family names. See [Fonts in CONFIG.md](CONFIG.md#fonts).

**How do I change one colour of the light table?** Set that token in `advanced.scene.colors`. See [Scene Colour Tokens in CONFIG.md](CONFIG.md#scene-colour-tokens).

**How do I show more or fewer slides per table page?** Set `advanced.scene.pageSize`, which is 12 by default. See [advanced.scene in CONFIG.md](CONFIG.md#advancedscene).

**Can I serve Curator from a subfolder such as `/links/`?** No. Serve it at the root of a domain or subdomain. See [Domains in DEPLOY.md](DEPLOY.md#domains).

**Why does an unknown path show the host's own error page?** The host is not serving `404.html`. See [Routes and the 404 Page in DEPLOY.md](DEPLOY.md#routes-and-the-404-page).

**Why do shared links show a broken preview card?** Check that `basic.site.url` matches your live domain exactly. See [Domains in DEPLOY.md](DEPLOY.md#domains) and [Check the Live Site in DEPLOY.md](DEPLOY.md#check-the-live-site).

**The build fails. Where do I start?** Run `npm run check`, which names the file, the item and the fix. See [Troubleshooting in DEPLOY.md](DEPLOY.md#troubleshooting).

**Can I build without a network connection?** Yes. Add `--offline` to `check` or `build` to use only cached images and fonts. See [Check and Preview](#check-and-preview).

**How do I get Curator updates?** Add the Curator repo you copied as a remote named `upstream`, then run `git pull upstream main`. Your own changes live in `content/` and `curator.config.json`, so when Git reports a conflict there, keep your version. Then run `npm run check`.

**How do I change how Curator works?** Edit `src/` or `scripts/` and follow the architecture rules. See [Changing How It Works](#changing-how-it-works).
