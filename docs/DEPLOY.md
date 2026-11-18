# Deploying Curator

Curator builds to a plain folder of static files, so any static host can serve it. This page covers what a host needs, how to point a domain at it and what to do when something goes wrong.

## What Any Static Host Needs

In your host's build settings, set:

- **Build command:** `npm run build`
- **Output folder:** `dist`, or the value of `advanced.build.outDir` if you changed it
- **Node version:** 20 or newer
- **Rebuild:** on every push to your main branch

With that in place, editing a Markdown file in your Git host's web editor is enough to publish. The host rebuilds and the change goes live.

There is nothing to install, so the host does not need an install step. If it runs one anyway, it finishes at once because the project has no dependencies.

For the Node version, this repo has a `.nvmrc` file containing `20`, and many hosts read it. If yours does not, set the Node version in the host's build settings.

## Domains

Curator is hosted at the root of a domain or subdomain, never in a subfolder. `links.example.com` works. `example.com/links/` does not.

Set `basic.site.url` in `curator.config.json` to the exact origin you will serve from, for example `https://links.example.com`, with no path. Canonical links, the sitemap and social cards all use it, so a wrong value gives broken preview cards.

To attach the domain:

1. Add the domain or subdomain in your host's settings. The host shows the DNS records to create.
2. At your DNS provider, create them. A subdomain usually takes a CNAME record pointing to the address the host gives you. A root domain takes the A, ALIAS or ANAME records the host gives you.
3. Wait for DNS to update, then turn on HTTPS in the host's settings. Most hosts issue the certificate for you.
4. Check that `basic.site.url` matches, and redeploy if you changed it.

## Routes and the 404 Page

Every route is a real file in the output, such as `/tools/` and `/tools/uv/`, so you do not need rewrite or redirect rules.

The host must serve `404.html` for unknown paths. Most static hosts do this automatically when the file is at the top of the output folder. If yours does not, set its custom 404 page to `/404.html`.

## Preview Images on the Host

The build downloads the preview image for every `image: auto` item over the network. The `.cache/` folder is not committed, so each build on the host fetches them again. Builds on a host are therefore slower than rebuilds on your machine.

If the host blocks outbound requests, or a source site refuses the fetch, the build prints a warning of the form `no preview image found for <url> (<reason>). A poster is used instead.` and carries on. The item gets a generated poster. The build does not fail.

To skip fetching altogether, set `advanced.images.fetch` to `false`. Items then use posters unless an image is already in the cache. Images you upload to `content/images/` and reference with `image: ./images/name.png` never need the network, so they always work.

## Fonts

By default the site loads its fonts from Google Fonts, set by `advanced.fonts.source: "google"`. With `"self"`, the build downloads the font files and serves them from `dist/fonts/`, so visitors make no third-party requests. The files are downloaded at build time, so the host needs network access for that build.

If the download fails, the build prints a warning and the site falls back to system fonts. It does not fail.

## Example: Vercel

This example deploys a site to a free address on Vercel. Other hosts follow the same pattern with the settings from [What Any Static Host Needs](#what-any-static-host-needs).

1. Sign in to Vercel with your Git host account.
2. Choose Add New, then Project, and import your repo.
3. Set Project Name to the name you want. The free address is `<name>.vercel.app`. If the name is taken, Vercel assigns a random address instead, so check the Domains tab in Project Settings after the first deploy.
4. Set Application Preset to Other. Under Build and Output Settings, turn on Override for Build Command and enter `npm run build`. Turn on Override for Output Directory and enter `dist`. Leave Install Command alone.
5. Click Deploy.
6. Set `basic.site.url` in `curator.config.json` to your address, for example `https://curator-demo.vercel.app`, then commit and push. Vercel rebuilds on its own.
7. Run the checks in [Check the Live Site](#check-the-live-site).

The repo includes a `vercel.json` that holds the same build settings. Once it is on your main branch it takes priority over the dashboard, so change build settings there. Vercel serves `404.html` and every route folder without extra rules, so you need no rewrites.

## Check the Live Site

Run these checks on your live domain after the first deploy, and again whenever you change the domain or `basic.site.url`. Use one of your own collections and one of its items.

1. **Routes load directly.** Paste `/<collection>/` and `/<collection>/<item>/` into a fresh tab. Both load with no error page, and the item URL opens with the screen already down.
2. **Unknown paths.** Open a path that does not exist, such as `/nope/`. The address bar changes to `/` and the "Page not found." note shows above the default table. If the host shows its own error page instead, see [Routes and the 404 Page](#routes-and-the-404-page).
3. **Back closes the screen.** Open a slide, press the projector's Next button twice, then press the browser Back button. The screen closes in one press and you stay on your site.
4. **Preview cards.** Paste a collection URL and an item URL into a social card preview tool or a chat app. The collection card shows the collection title and description. The item card shows the item title, the start of its notes and its preview image. An item with no preview image shows `basic.site.socialImage`.

If a preview card is broken or missing, check that `basic.site.url` matches your live domain exactly, as [Domains](#domains) describes, then redeploy.

## Troubleshooting

`npm run check` and `npm run build` print one line per problem under an Errors or Warnings heading. These are the ones people hit first.

**An output folder outside the project**

```
curator.config.json: advanced.build.outDir "../public" must be a folder inside the project, such as dist.
```

Set `advanced.build.outDir` to a folder inside the repo, and set your host's output folder to the same name.

**A folder that already holds other files**

```
advanced.build.outDir "dist" already holds files that Curator did not write. Empty it or choose another folder.
```

The build empties its output folder on every run, so it refuses to use a folder it did not create. Empty it or pick another name.

**A missing social image**

```
curator.config.json: basic.site.socialImage "./content/images/social.png" was not found.
```

Put the image at that path, or fix the path in `basic.site.socialImage`. The path is relative to the repo root and must stay inside it. The file must be a `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp` image whose content matches its extension. An SVG is not accepted.

**An unknown font family**

```
curator.config.json: font "Fraunsez" was not found on Google Fonts. Check the spelling, or choose a family that Google Fonts offers. Both font sources load families from Google Fonts.
```

Fix the spelling in `basic.fonts` or `advanced.fonts`. If the check could not reach Google Fonts, you get a warning instead, saying the font `could not be checked with Google Fonts`, and the font is requested without weights.

**A bad site URL**

```
curator.config.json: basic.site.url must be an http or https address with no path, such as https://links.example.com.
```

Use only the origin: the scheme and the host, with no path.

**A missing item url**

```
content/tools.md, "uv" (line 4): url is missing. Add a line such as url: https://example.com/page under the heading.
```

Every item needs an absolute http or https `url` line directly under its heading.

**Node too old**

Curator needs Node 20 or newer. The scripts do not check the version themselves, so on an older Node the failure is whatever error that version raises. If a host build fails in an odd way before any Curator message, check the Node version first and set it to 20 or newer through `.nvmrc` or the host's build settings.
