import { build } from "esbuild"
import { copyFile, mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const here = name => fileURLToPath(new URL(name, import.meta.url))
await mkdir(here("dist/"), { recursive: true })
await build({
    entryPoints: [here("src/main.ts")],
    outfile: here("dist/game.js"),
    bundle: true,
    minify: true,
    target: "es2020",
    legalComments: "none",
})
await Promise.all(["index.html", "style.css"].map(file => copyFile(here(file), here("dist/" + file))))
