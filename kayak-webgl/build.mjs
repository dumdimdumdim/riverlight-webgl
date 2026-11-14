import { build } from "esbuild"
import { createHash } from "node:crypto"
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
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
await copyFile(here("style.css"), here("dist/style.css"))
await rm(here("dist/audio/"), { recursive: true, force: true })
await cp(here("audio/"), here("dist/audio/"), { recursive: true })
let html = await readFile(here("index.html"), "utf8")
for (const asset of ["style.css", "game.js"]) {
    const contents = await readFile(here("dist/" + asset))
    const hash = createHash("sha256").update(contents).digest("hex").slice(0, 12)
    html = html.replace(`"./${asset}"`, `"./${asset}?v=${hash}"`)
}
await writeFile(here("dist/index.html"), html)
