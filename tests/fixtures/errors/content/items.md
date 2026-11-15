---
title: Item errors
---

## No url
type: article

## Bad url
url: ftp://example.com/file

## Unparseable url
url: not a url

## Unknown type
url: https://example.com/a
type: podcast

## Web image
url: https://example.com/b
image: https://example.com/b.png

## Outside image
url: https://example.com/c
image: ../secret.png

## Wrong extension
url: https://example.com/d
image: images/notes.txt

## Missing image
url: https://example.com/e
image: images/missing.png
