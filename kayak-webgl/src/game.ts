import { KayakCore, deerRestLeg } from "./core"
import { gallopFrames, GALLOP_STRIDE } from "./deer-gallop"
import { advanceBird, birdDeparture } from "./wildlife"
import { RiverRenderer } from "./renderer"
import { drawKayak } from "./kayak"
import { createRiverSound } from "./sound"
import type { Projected, Point, Deer, Habitat, RiverBird, Tree, Transform, Wake } from "./types"

const FOCAL_RATIO = 1.08
const CAMERA_TRAIL = 5.2
const restDeerLegs = [-1, 1].flatMap(front => [-1, 1].map(side => deerRestLeg(side, front)))

const PALETTE = {
    shade: "#627968",
    shadow: "#167d91",
    paper: "#faf7ee",
    distance: "#e9bd90",
    land: "#7c8750",
    sand: "#edce8d",
    gold: "#e5af4d",
    leaf: "#99a35a",
    deepLeaf: "#557d59",
    rust: "#cd7550",
}

export function mountRiverlight(root: HTMLElement) {
    const C = KayakCore,
        canvas = root.querySelector<HTMLCanvasElement>("canvas")!,
        intro = root.querySelector<HTMLElement>("[data-intro]")!,
        left = root.querySelector<HTMLButtonElement>("[data-left]")!,
        right = root.querySelector<HTMLButtonElement>("[data-right]")!
    let gpu = new RiverRenderer(canvas)
    root.dataset.renderer = "webgl2"
    const colors = PALETTE
    intro.hidden = false
    delete root.dataset.started
    left.dataset.active = right.dataset.active = "false"
    canvas.tabIndex = 0
    const s = C.create(),
        listeners: Array<() => void> = [],
        media = matchMedia("(prefers-reduced-motion: reduce)")
    let reduced = media.matches,
        w = 0,
        h = 0,
        dpr = 1,
        started = false,
        visible = true,
        disposed = false,
        raf = 0,
        last = 0,
        nextFrame = 0,
        cam = { x: s.x, y: 2.3, z: s.z - CAMERA_TRAIL },
        trees = new Map<number, Tree[]>(),
        deer = new Map<number, Deer>(),
        habitats = new Map<string, Habitat>(),
        birds = new Map<string, RiverBird>(),
        reedBends = new Map<string, { x: number; z: number; time: number }>(),
        lost = false,
        visualTime = 0,
        frames = 0
    const reedRoots = new Map<string, Point[]>()
    const FRAME_MS = 1000 / 60
    // Runtime-owned UI is removed on unmount, including Framer remounts.
    const lamp = document.createElement("button"),
        soundButton = document.createElement("button"),
        toolbar = document.createElement("div"),
        stats = document.createElement("div")
    lamp.type = "button"
    lamp.className = "rl-lamp"
    lamp.setAttribute("aria-label", "Show trip statistics")
    lamp.setAttribute("aria-expanded", "false")
    lamp.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 14c3 1 6 1.5 10 1.5s7-.5 10-1.5l-3.2 4H5.2L2 14Z"/><circle cx="12" cy="6" r="1.5"/><path d="m11 9-1 4h5m-4-4 4 2 3 4M6 6l12 11m-13-12 2 1-1 1-2-1m13 10 2 1-1 1-2-1"/></svg>'
    soundButton.type = "button"
    soundButton.className = "rl-sound"
    soundButton.setAttribute("aria-label", "Sound")
    soundButton.setAttribute("aria-pressed", "false")
    soundButton.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path data-mute d="m17 10 4 4m0-4-4 4"/><path data-waves d="M16 9a4.3 4.3 0 0 1 0 6m2.6-8.5a7.8 7.8 0 0 1 0 11"/></svg>'
    toolbar.className = "rl-tools"
    toolbar.append(soundButton, lamp)
    const sound = createRiverSound(soundButton)
    stats.className = "rl-stats"
    stats.setAttribute("role", "group")
    stats.dataset.open = "false"
    stats.setAttribute("aria-hidden", "true")
    root.appendChild(stats)
    root.appendChild(toolbar)
    let statsOpen = false,
        tripDistance = 0
    let statsTimer: ReturnType<typeof setTimeout> | undefined
    const timeText = document.createElement("span"),
        distanceText = document.createElement("span"),
        strokesText = document.createElement("span")
    for (const item of [timeText, distanceText, strokesText]) {
        item.className = "rl-stat"
        stats.appendChild(item)
    }
    function refreshStats() {
        const elapsed = Math.floor(s.time),
            minutes = Math.floor(elapsed / 60),
            seconds = elapsed % 60
        timeText.textContent = `Time ${minutes}m ${String(seconds).padStart(2, "0")}s`
        distanceText.textContent = `Distance ${Math.round(tripDistance)} m`
        strokesText.textContent = `Strokes ${s.contacts}`
        stats.setAttribute(
            "aria-label",
            `${minutes} minutes ${seconds} seconds, ${Math.round(tripDistance)} metres, ${s.contacts} paddle strokes`
        )
    }
    function showStats() {
        clearTimeout(statsTimer)
        refreshStats()
        // Another click restarts the eight-second reveal without pausing the trip.
        stats.dataset.open = "false"
        void stats.offsetWidth
        statsOpen = true
        stats.dataset.open = "true"
        stats.setAttribute("aria-hidden", "false")
        lamp.setAttribute("aria-expanded", "true")
        statsTimer = setTimeout(() => {
            statsOpen = false
            stats.dataset.open = "false"
            stats.setAttribute("aria-hidden", "true")
            lamp.setAttribute("aria-expanded", "false")
        }, 8000)
    }
    {
        on(lamp, "pointerenter", (e) => {
            if (e.pointerType !== "touch") showStats()
        })
        on(lamp, "focus", showStats)
        on(lamp, "pointerdown", (e) => e.stopPropagation())
        on(lamp, "keydown", (e) => {
            // Arrow keys must reach the game's paddling handler even here.
            if (e.key === "Enter" || e.key === " ") e.stopPropagation()
        })
        on(lamp, "click", (e) => {
            e.stopPropagation()
            showStats()
            canvas.focus({ preventScroll: true })
        })
        on(soundButton, "click", (e) => {
            e.stopPropagation()
            void sound.toggle()
        })
        on(soundButton, "keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") e.stopPropagation()
        })
    }
    const pitch = 0.245,
        co = Math.cos(pitch),
        si = Math.sin(pitch)
    const shadeCache = new Map<string, string>()
    function mix(hex: string, b: string, f: number) {
        const key = hex + b + Math.round(f * 100)
        if (shadeCache.has(key)) return shadeCache.get(key)!
        const rgb = (x: string) =>
                x.match(/[a-f\d]{2}/gi)!.map((v) => parseInt(v, 16)),
            a = rgb(hex),
            bb = rgb(b)
        const col =
            "#" +
            a
                .map((v, i) =>
                    Math.round(v * (1 - f) + bb[i] * f)
                        .toString(16)
                        .padStart(2, "0")
                )
                .join("")
        if (shadeCache.size < 512) shadeCache.set(key, col)
        return col
    }
    type GameEvents = WindowEventMap & DocumentEventMap & {
        webglcontextlost: WebGLContextEvent
        webglcontextrestored: WebGLContextEvent
    }
    function on<K extends keyof GameEvents>(
        t: EventTarget,
        n: K,
        fn: (event: GameEvents[K]) => void,
        opts?: AddEventListenerOptions
    ) {
        t.addEventListener(n, fn as EventListener, opts)
        listeners.push(() =>
            t.removeEventListener(n, fn as EventListener, opts)
        )
    }
    function project(p: Point): Projected | null {
        const x = p.x - cam.x,
            y = p.y - cam.y,
            z = p.z - cam.z,
            d = z * co - y * si
        if (d < 0.7) return null
        const f = Math.min(w, h) * FOCAL_RATIO
        return {
            x: w / 2 + (x * f) / d,
            y: h * 0.43 - ((y * co + z * si) * f) / d,
            d,
        }
    }
    let geometryFade = 1
    let material = 0 // Land is tagged separately for procedural shading.
    function face(points: Point[], color: string, alpha = 1) {
        if (alpha <= 0) return
        // Clip paddle and wildlife geometry at the water surface.
        if (points.some((p) => p.y < 0)) {
            const clipped: Point[] = []
            for (let i = 0; i < points.length; i++) {
                const a = points[i], b = points[(i + 1) % points.length]
                if (a.y >= 0) clipped.push(a)
                if ((a.y >= 0) !== (b.y >= 0)) {
                    const t = a.y / (a.y - b.y)
                    clipped.push({ x: C.lerp(a.x, b.x, t), y: 0, z: C.lerp(a.z, b.z, t) })
                }
            }
            points = clipped
        }
        gpu.face(points, color, alpha * geometryFade, material)
    }
    function poly(points: Point[], color: string, alpha = 1) {
        gpu.decal(points, color, alpha)
    }
    function ellipse(
        x: number,
        y: number,
        z: number,
        rx: number,
        rz: number,
        color: string,
        alpha = 1
    ) {
        const pts = []
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * C.TAU
            pts.push({ x: x + Math.cos(a) * rx, y, z: z + Math.sin(a) * rz })
        }
        poly(pts, color, alpha)
    }
    function line3(points: Point[], color: string, width = 1, alpha = 1) {
        const focal = Math.min(w, h) * FOCAL_RATIO
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i]
            const pa = project(a), pb = project(b)
            const len = Math.hypot(b.x - a.x, b.z - a.z)
            if (!pa || !pb || len < 0.0001) continue
            const dx = (b.z - a.z) * width / (2 * len * focal)
            const dz = (a.x - b.x) * width / (2 * len * focal)
            poly([
                { x: a.x + dx * pa.d, y: a.y, z: a.z + dz * pa.d },
                { x: a.x - dx * pa.d, y: a.y, z: a.z - dz * pa.d },
                { x: b.x - dx * pb.d, y: b.y, z: b.z - dz * pb.d },
                { x: b.x + dx * pb.d, y: b.y, z: b.z + dz * pb.d },
            ], color, alpha)
        }
    }
    function ellipsoid(
        x: number,
        y: number,
        z: number,
        rx: number,
        ry: number,
        rz: number,
        col: string,
        seed = 0,
        segments = 12,
        rings = 6,
        transform: Transform = null
    ) {
        const vs: Point[][] = []
        for (let j = 0; j <= rings; j++) {
            const t = (Math.PI * j) / rings,
                row: Point[] = []
            for (let k = 0; k < segments; k++) {
                const a = (k / segments) * C.TAU,
                    ir = 1 + 0.025 * Math.sin(a * 3 + seed)
                let p = {
                    x: x + rx * Math.sin(t) * Math.cos(a) * ir,
                    y: y + ry * Math.cos(t),
                    z: z + rz * Math.sin(t) * Math.sin(a) * ir,
                }
                if (transform) p = transform(p)
                row.push(p)
            }
            vs.push(row)
        }
        for (let j = 0; j < rings; j++)
            for (let k = 0; k < segments; k++) {
                const a = (k / segments) * C.TAU,
                    shade = 0.025 + 0.065 * (1 - Math.cos(a - 2.2)) + 0.012 * j
                face(
                    [
                        vs[j][k],
                        vs[j][(k + 1) % segments],
                        vs[j + 1][(k + 1) % segments],
                        vs[j + 1][k],
                    ],
                    mix(col, colors.shade, shade)
                )
            }
    }
    function tube(
        points: Point[],
        radii: number[],
        col: string,
        tr: (p: Point) => Point,
        segments = 8
    ) {
        const verts: Point[][] = []
        for (let j = 0; j < points.length; j++) {
            const a = points[Math.max(0, j - 1)],
                b = points[Math.min(points.length - 1, j + 1)],
                dx = b.x - a.x,
                dy = b.y - a.y,
                dz = b.z - a.z,
                len = Math.hypot(dx, dy, dz) || 1,
                tx = dx / len,
                ty = dy / len,
                tz = dz / len,
                h = Math.hypot(tx, tz)
            const ux = h > 1e-8 ? tz / h : 1,
                uz = h > 1e-8 ? -tx / h : 0,
                vx = ty * uz,
                vy = tz * ux - tx * uz,
                vz = -ty * ux,
                p = points[j],
                r = radii[j]
            verts.push(
                Array.from({ length: segments }, (_, i) => {
                    const q = (i / segments) * C.TAU,
                        c = Math.cos(q) * r,
                        sn = Math.sin(q) * r
                    return tr({
                        x: p.x + ux * c + vx * sn,
                        y: p.y + vy * sn,
                        z: p.z + uz * c + vz * sn,
                    })
                })
            )
        }
        for (let j = 0; j < verts.length - 1; j++)
            for (let i = 0; i < segments; i++) {
                const k = (i + 1) % segments
                face(
                    [
                        verts[j][i],
                        verts[j][k],
                        verts[j + 1][k],
                        verts[j + 1][i],
                    ],
                    mix(col, colors.shade, i * 0.012)
                )
            }
        face(verts[0].slice().reverse(), col)
        face(verts[verts.length - 1], col)
    }
    function rod(
        a: Point,
        b: Point,
        r: number,
        col: string,
        transform: Transform = null
    ) {
        tube([a, b], [r, r], col, transform || ((p: Point) => p), 6)
    }
    function islandReedPatches(id: number) {
        const seed = id*173+8311
        const count = 2+Math.floor(C.rand(seed+9)*3)
        const rotation = C.rand(seed+10)*C.TAU
        return Array.from({ length: count }, (_, i) => {
            const patch = seed+i*59
            return {
                seed: patch,
                angle: rotation + (i+(C.rand(patch+4)-.5)*.68)*C.TAU/count,
                span: .22+C.rand(patch+11)*.47,
                width: .52+C.rand(patch+14)*.60,
            }
        })
    }
    function reedBankCover(z: number, side: number) {
        let cover = 0
        const cell = Math.floor(z / 65)
        for (let i = cell - 1; i <= cell + 1; i++) {
            if (C.rand(i * 71 + 7311) > 0.43) continue
            const patchSide = C.rand(i + 7313) < 0.5 ? -1 : 1
            if (patchSide !== side) continue
            const centre = i * 65 + 18 + C.rand(i + 7312) * 24,
                halfLength = (20 + C.rand(i + 7315) * 30) * 0.5,
                t = C.clamp((halfLength + 1.5 - Math.abs(z - centre)) / 3, 0, 1)
            cover = Math.max(cover, t * t * (3 - 2 * t))
        }
        return cover
    }
    function shoreWidth(z: number) {
        return C.half(z) + .19*Math.sin(z*.63) + .09*Math.sin(z*1.47)
    }
    function terrain(start: number, transition: number, end: number) {
        for (let z = start; z < end; ) {
            const zz = z + (z < transition ? 2 : 8)
            for (const side of [-1, 1]) {
                const edge = (t: number) => C.center(t) + side * shoreWidth(t),
                    e = edge(z),
                    ee = edge(zz),
                    sw = C.sand(z) * (.50 + .14*Math.sin(z*.32 + side)),
                    sww = C.sand(zz) * (.50 + .14*Math.sin(zz*.32 + side)),
                    p = (x: number, y: number, z: number) => ({ x, y, z })
                material = 7
                face(
                    [
                        p(e, 0, z),
                        p(ee, 0, zz),
                        p(ee + side * sww, 0.14, zz),
                        p(e + side * sw, 0.14, z),
                    ],
                    mix(
                        colors.sand,
                        colors.land,
                        reedBankCover((z + zz) * 0.5, side)
                    )
                )
                material = 1
                face(
                    [
                        p(e + side * sw, 0.14, z),
                        p(ee + side * sww, 0.14, zz),
                        p(ee + side * 70, 0.22, zz),
                        p(e + side * 70, 0.22, z),
                    ],
                    mix(
                        colors.land,
                        colors.distance,
                        0.55 * C.clamp((z - s.z - 100) / 200, 0, 1)
                    )
                )
            }
            z = zz
        }
        for (const o of C.islands(s.z + 115, 165)) {
            const rings: Point[][] = [[], []]
            for (let i = 0; i < 40; i++) {
                const a = (i / 40) * C.TAU,
                    r = C.radius(o, a)
                for (let k = 0; k < 2; k++) {
                    const extra = k === 1 ? -0.55 : 0
                    rings[k].push({
                        x: o.x + Math.cos(a) * Math.max(0.1, o.rx * r + extra),
                        y: k === 1 ? 0.18 : 0,
                        z: o.z + Math.sin(a) * Math.max(0.1, o.rz * r + extra),
                    })
                }
            }
            const patches = islandReedPatches(o.i)
            material = 7
            for (let i = 0; i < 40; i++) {
                const k = (i + 1) % 40
                face(
                    [rings[0][i], rings[0][k], rings[1][k], rings[1][i]],
                    mix(
                        colors.sand,
                        colors.land,
                        (() => {
                            const angle = ((i + 0.5) / 40) * C.TAU
                            let cover = 0
                            for (const patch of patches) {
                                const delta = Math.abs(C.angleDelta(angle,patch.angle))
                                const t = C.clamp((patch.span+.16-delta)/.32,0,1)
                                cover = Math.max(cover, t * t * (3 - 2 * t))
                            }
                            return cover
                        })()
                    )
                )
            }
            material = 1
            const middle = { x: o.x, y: 0.18, z: o.z }
            for (let i = 0; i < 40; i++)
                face([middle, rings[1][i], rings[1][(i + 1) % 40]], colors.land)
            makeTree(
                {
                    x: o.x,
                    y: 0.18,
                    z: o.z,
                    seed: o.i + 711,
                    size: 2.2,
                    color: colors.gold,
                },
                1 - C.clamp((o.z - s.z - 160) / 105, 0, 1)
            )
        }
    }
    function treeChunk(i: number): Tree[] {
        if (trees.has(i)) return trees.get(i)!
        const list: Tree[] = []
        for (const side of [-1, 1]) {
            const seed = i * 101 + side * 7,
                lush = 0.5 + 0.5 * Math.sin(i * 0.72 + side),
                count = lush > 0.63 ? 6 : lush > 0.25 ? 2 : 1
            for (let k = 0; k < count; k++) {
                const z = i * 18 + C.rand(seed + k * 19) * 18,
                    x =
                        C.center(z) +
                        side *
                            (C.half(z) +
                                C.sand(z) * 0.5 +
                                1.35 +
                                C.rand(seed + k * 17 + 2) * 12),
                    size = 1.6 + C.rand(seed + k * 21 + 7) * 2.3,
                    choice = C.rand(seed + k * 5)
                list.push({
                    x,
                    y: 0.22,
                    z,
                    size,
                    seed: seed + k * 97,
                    color:
                        choice < 0.37
                            ? colors.leaf
                            : choice < 0.62
                              ? colors.deepLeaf
                              : choice < 0.86
                                ? colors.gold
                                : colors.rust,
                })
            }
            // Overlapping clusters give the forest depth while leaving gaps near the water.
            const groveDepth = 17 + C.rand(seed+442)*9
            const groveZ = i*18 + 4 + C.rand(seed+443)*11
            for (let k = 0; k < (lush > .46 ? 5 : 3); k++) {
                const pick = seed*17 + 701 + k*137
                const z = groveZ + (C.rand(pick+2)-.5)*23
                const offset = groveDepth + (k%3)*9 + C.rand(pick+4)*5
                const shade = C.rand(pick+9)
                list.push({
                    x: C.center(z) + side*(C.half(z)+offset),
                    y: .22,
                    z,
                    size: 2.45 + C.rand(pick+3)*2.7,
                    seed: pick,
                    color: shade < .48 ? "#506b4b" : shade < .85 ? "#6b784e" : "#9a8f56",
                    woodland: true,
                })
            }
            // Small groups at uneven depths leave open banks between thickets.
            for (let group = 0; group < 2; group++) {
                const patch = seed*233 + 4729 + group*113
                if (C.rand(patch) < (group === 0 ? .26 : .48)) continue
                const patchZ = i*18 + C.rand(patch+1)*18
                const setback = group === 0 ? 1.4+C.rand(patch+2)*4.2 : 7+C.rand(patch+2)*12
                const count = 2+Math.floor(C.rand(patch+3)*3)
                for (let j = 0; j < count; j++) {
                    const pick = patch + j*67
                    const z = patchZ + (j-(count-1)*.5)*1.55 + (C.rand(pick+7)-.5)*1.6
                    const depth = setback + C.rand(pick+8)*2.0
                    const shade = C.rand(pick+9)
                    list.push({
                        x: C.center(z)+side*(shoreWidth(z)+depth),
                        y: .21,
                        z,
                        size: .94+C.rand(pick+10)*1.18,
                        seed: pick,
                        color: shade < .48 ? "#597548" : shade < .85 ? "#78874b" : "#9b8d51",
                        shrub: true,
                    })
                }
            }
        }
        // Frame the launch with a low thicket visible from the centre of the river.
        if (i === 1) {
            for (let j = 0; j < 4; j++) {
                const z = 20 + j*1.75
                const seed = 6389+j*67
                list.push({
                    x: C.center(z)-shoreWidth(z)-2.6-C.rand(seed)*2.4,
                    y: .21,
                    z,
                    size: 1.7+C.rand(seed+1)*.55,
                    seed,
                    color: j%2 ? "#687c43" : "#587547",
                    shrub: true,
                })
            }
        }
        trees.set(i, list)
        return list
    }
    function makeTree(o: Tree, fade: number) {
        if (fade <= 0) return
        const base = project({ x: o.x, y: o.y, z: o.z }),
            top = project({ x: o.x, y: o.y + o.size * (o.shrub ? .7 : 3.3), z: o.z }),
            edge = project({ x: o.x + o.size * 1.30, y: o.y, z: o.z })
        if (!base || !top || !edge) return
        const height = base.y - top.y,
            width = Math.abs(edge.x - base.x) * 2
        if (
            height < 1 ||
            base.x + width / 2 < 0 ||
            base.x - width / 2 > w ||
            base.y < 0 ||
            top.y > h
        )
            return
        const kind = o.shrub ? 3 : Math.floor(C.rand(o.seed + 93) * 3)
        const variant = Math.floor(C.rand(o.seed + 23) * 3)
        gpu.tree(o, kind, variant, fade, o.woodland === true)
    }
    function vegetation() {
        const a = Math.floor((cam.z - 5) / 18),
            b = Math.floor((s.z + 274) / 18)
        for (let i = a; i <= b; i++)
            for (const t of treeChunk(i)) {
                const distance = t.z-s.z
                const fade = t.shrub ? 1-C.clamp((distance-95)/55,0,1)
                    : 1-C.clamp((distance-160)/105,0,1)
                makeTree(t,fade)
            }
        for (const k of trees.keys())
            if (k < a - 1 || k > b + 1) trees.delete(k)
    }
    // Encounters are about three times farther apart than the original 72-unit cells.
    // A group is deterministic, with independently timed reactions for its members.
    function deerGroupZ(group: number) {
        return group === 0 ? 42 : 70 + group * 210 + C.rand(group + 451) * 45
    }
    function deerGroupCount(group: number) {
        return C.rand(group * 113 + 6841) < 0.38 ? 2 : 1
    }
    function deerSite(group: number, member: number): Deer {
        const id = group * 2 + member,
            side = C.rand(group * 71 + 5141) < 0.5 ? -1 : 1,
            siteZ = deerGroupZ(group),
            z = siteZ + member * (3.8 + C.rand(group + 815) * 1.2)
        return {
            id,
            side,
            z,
            siteZ,
            x:
                C.center(z) +
                side * (C.half(z) + C.sand(z) + 0.9 + member * 1.2),
            heading: (-side * Math.PI) / 2 + (C.rand(id + 196) - 0.5) * 0.16,
            state: "idle",
            age: 0,
            phase: C.rand(id + 811) * C.TAU,
            alertClock: 0,
            fleeClock: 0,
            alertRange: 39 + C.rand(id + 961) * 3,
            fleeRange: 28 + C.rand(id + 971) * 2,
            alertDelay: member * 0.65 + 0.1 + C.rand(id + 981) * 0.25,
            strideDistance: 0,
            fleeDelay: member * 0.6 + 0.1 + C.rand(id + 991) * 0.3,
        }
    }
    function updateDeer(dt: number) {
        const first = Math.max(0, Math.floor((s.z - 150) / 210)),
            last = Math.max(0, Math.ceil((s.z + 140) / 210))
        for (let group = first; group <= last; group++) {
            const z = deerGroupZ(group)
            if (z < s.z - 35 || z > s.z + 230) continue
            for (let member = 0; member < deerGroupCount(group); member++) {
                const id = group * 2 + member
                if (!deer.has(id)) deer.set(id, deerSite(group, member))
            }
        }
        for (const [id, o] of deer) {
            // Retire by the original site, so fleeing sideways cannot retain cells.
            const siteZ = o.siteZ
            if (siteZ < s.z - 35 || siteZ > s.z + 230) {
                deer.delete(id)
                continue
            }
            if (!started || dt <= 0 || o.state === "escaped") continue
            o.age += dt
            const distance = Math.hypot(o.x - s.x, o.z - s.z)
            if (o.state === "idle") {
                o.alertClock = distance < o.alertRange ? o.alertClock + dt : 0
                if (o.alertClock >= o.alertDelay) {
                    o.state = "alert"
                    o.age = 0
                }
            }
            if (o.state === "alert") {
                o.fleeClock = distance < o.fleeRange ? o.fleeClock + dt : 0
                if (o.fleeClock >= o.fleeDelay && o.age > 0.85) {
                    o.state = "fleeing"
                    o.age = 0
                }
            }
            if (o.state === "fleeing") {
                const target = Math.atan2(o.side, .52 + C.rand(o.id+890)*.55)
                const remainingTurn = C.angleDelta(target,o.heading)
                o.heading += remainingTurn*(1-Math.exp(-dt*7))
                const speed = 5.6*(1-Math.exp(-Math.max(0,o.age-.13)*2.8))
                const distance = speed*dt*Math.max(0,Math.cos(remainingTurn))
                o.x += Math.sin(o.heading)*distance
                o.z += Math.cos(o.heading)*distance
                o.strideDistance += distance
                if (o.age > 6) o.state = "escaped"
            }
        }
    }
    function drawDeer(o: Deer) {
        if (o.state === "escaped") return
        const base = project({ x: o.x, y: 0.22, z: o.z })
        if (!base || base.d > 145) return
        const scale = Math.min(w, h) * FOCAL_RATIO / base.d
        if (base.x < -scale * 2 || base.x > w + scale * 2) return
        const running = o.state === "fleeing",
            blend = running ? C.clamp(o.strideDistance/.92,0,1) : 0,
            effort = blend*blend*(3-2*blend),
            frameCount = gallopFrames.length,
            // Lead with the hind legs from a planted pose.
            frame = (o.strideDistance/GALLOP_STRIDE*frameCount+9)%frameCount,
            frameIndex = Math.floor(frame),
            a = gallopFrames[frameIndex],
            b = gallopFrames[(frameIndex+1)%frameCount],
            sample = (i: number) => C.lerp(a[i],b[i],frame-frameIndex),
            co = Math.cos(o.heading),
            si = Math.sin(o.heading),
            tr = (p: Point): Point => ({
                x: o.x + p.x * co + p.z * si,
                y: 0.22 + p.y,
                z: o.z - p.x * si + p.z * co,
            }),
            coat = "#ac7950",
            dark = "#765238",
            cream = "#eee1bd",
            // Fade only at the end of escape, after reaching the forest.
            fade = running ? 1 - C.clamp((o.age - 4.5) / 1.5, 0, 1) : 1
        geometryFade = fade
        // Deliberately low polygon counts: only nearby deer need articulated shapes.
        const body = (
            x: number,
            y: number,
            z: number,
            rx: number,
            ry: number,
            rz: number,
            color: string
        ) => ellipsoid(x, y, z, rx, ry, rz, color, o.phase, 8, 4, tr)
        const torsoY = C.lerp(1.04,sample(0),effort),
            bodyPitch = sample(1)*effort,
            pitchCos = Math.cos(bodyPitch),
            pitchSin = Math.sin(bodyPitch),
            torsoTr = (p: Point): Point =>
                tr({
                    x: p.x,
                    y:
                        torsoY +
                        (p.y - 1.04) * pitchCos -
                        p.z * pitchSin,
                    z:
                        (p.y - 1.04) * pitchSin +
                        p.z * pitchCos,
                })
        ellipsoid(0, 1.04, 0, 0.25, 0.34, 0.65, coat, o.phase, 8, 4, torsoTr)
        ellipsoid(
            0,
            1.06,
            -0.57,
            0.19,
            0.23,
            0.12,
            cream,
            o.phase,
            8,
            4,
            torsoTr
        )
        for (let leg = 0; leg < restDeerLegs.length; leg++) {
            const front = leg >= 2,
                rest = restDeerLegs[leg],
                offset = 4+leg*12,
                joint = (p: Point, j: number): Point => {
                    const i = offset+j*3
                    return effort === 0 ? p : {
                        x: C.lerp(p.x,sample(i),effort),
                        y: C.lerp(p.y,sample(i+1),effort),
                        z: C.lerp(p.z,sample(i+2),effort),
                    }
                },
                hip = joint(rest.hip,0),
                knee = joint(rest.knee,1),
                hock = joint(rest.hock,2),
                foot = joint(rest.foot,3)
            rod(tr(hip), tr(knee), front ? 0.065 : 0.075, coat)
            // Keep the actual forward-facing stifle visible below the flank.
            if (!front)
                body(knee.x, knee.y, knee.z, 0.075, 0.08, 0.075, coat)
            rod(knee, hock, front ? 0.04 : 0.042, coat, tr)
            if (!front) {
                tube([hock, foot], [0.03, 0.018], dark, tr, 6)
            } else rod(hock, foot, 0.027, dark, tr)
            body(foot.x, foot.y, foot.z + 0.025, 0.043, 0.038, 0.07, dark)
        }
        // Neck reaches forwards and down; skull pitches independently.
        // The muzzle stays in front of the forelegs throughout the transition.
        const rise =
                o.state === "idle"
                    ? 0
                    : o.state === "alert"
                      ? C.clamp(o.age / 0.85, 0, 1)
                      : 1,
            eased = rise * rise * (3 - 2 * rise),
            grazing = 1 - eased,
            angle = .65*grazing + bodyPitch*.75,
            headY = C.lerp(
                0.38 + Math.sin(s.time * 0.65 + o.phase) * 0.01,
                C.lerp(1.73,sample(2),effort),
                eased
            ),
            headZ = C.lerp(1.08,C.lerp(.74,sample(3),effort),eased),
            headTr = (p: Point): Point => {
                const y = p.y - 1.73,
                    z = p.z - 0.74
                return tr({
                    x: p.x,
                    y: headY + y * Math.cos(angle) - z * Math.sin(angle),
                    z: headZ + y * Math.sin(angle) + z * Math.cos(angle),
                })
            },
            headBody = (
                x: number,
                y: number,
                z: number,
                rx: number,
                ry: number,
                rz: number,
                color: string
            ) => ellipsoid(x, y, z, rx, ry, rz, color, o.phase, 8, 4, headTr)
        const neckBase = torsoTr({ x: 0, y: 1.01, z: .36 })
        const neckEnd = headTr({ x: 0, y: 1.65, z: .64 })
        tube(
            [neckBase, {
                x: C.lerp(neckBase.x, neckEnd.x, .51),
                y: C.lerp(neckBase.y, neckEnd.y, .51) + .035,
                z: C.lerp(neckBase.z, neckEnd.z, .51),
            }, neckEnd],
            [.157, .109, .074],
            coat,
            p => p,
            8
        )
        headBody(0, 1.73, 0.74, 0.13, 0.16, 0.24, coat)
        headBody(0, 1.64, 0.98, 0.095, 0.08, 0.14, dark)
        for (const side of [-1, 1]) {
            headBody(side * 0.16, 1.94, 0.63, 0.075, 0.19, 0.065, coat)
            headBody(side * 0.122, 1.77, 0.79, 0.024, 0.026, 0.025, "#342d26")
            rod(
                { x: side * 0.075, y: 1.87, z: 0.72 },
                { x: side * 0.2, y: 2.23, z: 0.52 },
                0.022,
                dark,
                headTr
            )
            rod(
                { x: side * 0.14, y: 2.05, z: 0.62 },
                { x: side * 0.29, y: 2.17, z: 0.73 },
                0.017,
                dark,
                headTr
            )
        }
        geometryFade = 1
    }
    function reedPosition(o: Habitat, along: number, across: number): Point {
        const length = o.length ?? 10,
            width = o.width ?? 1.5,
            taper = Math.sqrt(Math.max(0, 1 - along * along)),
            fringe = (0.72 + 0.18 * Math.sin(along * 7 + o.seed)) * taper,
            offset = across * width * fringe
        if (o.islandI !== undefined) {
            const island = C.island(o.islandI),
                angle = (o.angleCentre ?? 0) + along * (o.angleSpan ?? 0),
                r = C.radius(island, angle),
                x = island.x + Math.cos(angle) * (island.rx * r + offset),
                z = island.z + Math.sin(angle) * (island.rz * r + offset)
            return { x, y: Math.max(.023,.18*C.clamp(-offset/.55,0,1)+.012), z }
        }
        const z = o.z + along * length * 0.5,
            side = o.side ?? (Math.sign(o.x - C.center(o.z)) || 1),
            x = C.center(z) + side * (C.half(z) - 0.15 + offset)
        return { x, y: offset > 0.2 ? 0.22 : 0.025, z }
    }
    function addHabitat(o: Habitat, withBirds = true) {
        if (habitats.has(o.key)) return
        habitats.set(o.key, o)
        if (!withBirds) return
        const big = C.rand(o.seed + 31) < 0.42,
            count = 2 + Math.floor(C.rand(o.seed + 41) * 3)
        for (let j = 0; j < count + (big ? 1 : 0); j++) {
            const large = big && j === 0,
                key = o.key + ":" + j,
                x = o.x + (C.rand(o.seed + j * 19) - 0.5) * 0.65,
                z = o.z + (C.rand(o.seed + j * 23) - 0.5) * 0.7,
                perch =
                    o.kind === "reeds"
                        ? reedPosition(
                              o,
                              large
                                  ? 0.55
                                  : (C.rand(o.seed + j * 23) - 0.5) * 0.6,
                              large ? -0.95 : 0.1
                          )
                        : { x, y: o.y, z }
            birds.set(key, {
                key,
                homeZ: o.z,
                x: perch.x,
                z: perch.z,
                y: perch.y,
                large,
                flying: false,
                escaped: false,
                age: 0,
                heading: C.rand(o.seed + j * 29) * C.TAU,
                seed: o.seed + j * 97,
                delay: large ? 0.15 : 0.05 + j * 0.12,
            })
        }
    }
    function updateBirds(dt: number) {
        // Sparse bank patches, stable in world coordinates.
        for (
            let cell = Math.floor((s.z - 35) / 65);
            cell <= Math.ceil((s.z + 140) / 65);
            cell++
        ) {
            if (C.rand(cell * 71 + 7311) > 0.43) continue
            const z = cell * 65 + 18 + C.rand(cell + 7312) * 24,
                side = C.rand(cell + 7313) < 0.5 ? -1 : 1
            if (z < s.z - 35 || z > s.z + 145) continue
            addHabitat({
                key: "bank:" + cell,
                x: C.center(z) + side * (C.half(z) - 0.25),
                y: 0.025,
                z,
                seed: cell * 137 + 7314,
                kind: "reeds",
                side,
                length: 20 + C.rand(cell + 7315) * 30,
                width: 1.5 + C.rand(cell + 7316) * 1.0,
            })
        }
        for (const island of C.islands(s.z + 45, 110)) {
            if (island.z < s.z - 35) continue
            const patches = islandReedPatches(island.i)
            for (const [i, patch] of patches.entries()) {
                const radius = C.radius(island,patch.angle)
                const tangentRadius = Math.hypot(
                    island.rx*Math.sin(patch.angle), island.rz*Math.cos(patch.angle),
                )
                addHabitat({
                    key: "island-reeds:" + island.i + ":" + i,
                    x: island.x + Math.cos(patch.angle)*island.rx*radius,
                    y: .025,
                    z: island.z + Math.sin(patch.angle)*island.rz*radius,
                    seed: patch.seed,
                    kind: "reeds",
                    islandI: island.i,
                    angleCentre: patch.angle,
                    angleSpan: patch.span,
                    width: patch.width,
                    length: 2*patch.span*tangentRadius,
                }, i === 0)
            }
            addHabitat({
                key: "island-tree:" + island.i,
                x: island.x + 0.3,
                y: 6.9,
                z: island.z,
                seed: island.i * 193 + 8411,
                kind: "tree",
            })
        }
        for (const [key, o] of habitats)
            if (o.z < s.z - 35 || o.z > s.z + 170) habitats.delete(key)
        for (const [key, o] of birds) {
            if (o.homeZ < s.z - 35 || o.homeZ > s.z + 170) {
                birds.delete(key)
                continue
            }
            if (!started || dt <= 0 || o.escaped) continue
            const distance = Math.hypot(o.x - s.x, o.z - s.z)
            if (!o.flying) {
                if (distance < (o.large ? 15 : 12)) o.age += dt
                else o.age = 0
                if (o.age >= o.delay) {
                    const obstacles: Tree[] = []
                    for (let chunk = Math.floor((o.z-63)/18); chunk <= Math.floor((o.z+63)/18); chunk++)
                        obstacles.push(...treeChunk(chunk).filter(tree => !tree.shrub))
                    for (const island of C.islands(o.z,62))
                        obstacles.push({ x:island.x,y:.18,z:island.z,size:2.2,seed:island.i,color:colors.gold })
                    const departure = birdDeparture(o,{x:s.x,y:0,z:s.z},obstacles)
                    // In dense cover, wait until there is a way out without clipping a crown.
                    o.age = departure ? 0 : o.delay-.8
                    if (!departure) continue
                    o.departure = departure
                    o.flying = true
                    const lateral = (o.x - s.x) * Math.cos(s.heading) -
                        (o.z - s.z) * Math.sin(s.heading)
                    sound.takeoff(distance, lateral)
                }
            } else {
                advanceBird(o,dt)
                if (o.age > 9) o.escaped = true
            }
        }
    }
    function bendReed(root: Point, key: string) {
        const co = Math.cos(s.heading),
            si = Math.sin(s.heading),
            dx = root.x - s.x,
            dz = root.z - s.z,
            localX = dx * co - dz * si,
            localZ = dx * si + dz * co,
            // Capsule follows the narrow hull, with a soft contact margin.
            end = C.clamp(localZ, -1.65, 1.75),
            separationZ = localZ - end,
            distance = Math.hypot(localX, separationZ),
            influence = started ? C.clamp((0.95 - distance) / 0.65, 0, 1) : 0,
            strength = influence * influence * (3 - 2 * influence),
            awayX = distance > 0.03 ? localX / distance : localX >= 0 ? 1 : -1,
            awayZ = distance > 0.03 ? separationZ / distance : 0,
            targetX = (awayX * co + awayZ * si) * strength * 0.78,
            targetZ = (-awayX * si + awayZ * co) * strength * 0.78
        let state = reedBends.get(key)
        if (!state && strength === 0) return { x: 0, z: 0 }
        if (!state) {
            state = { x: 0, z: 0, time: s.time - 1 / 60 }
            reedBends.set(key, state)
        }
        const dt = C.clamp(s.time - state.time, 0, 0.25),
            blend = 1 - Math.exp(-dt * (strength > 0 ? 15 : 2.8))
        state.x += (targetX - state.x) * blend
        state.z += (targetZ - state.z) * blend
        state.time = s.time
        if (strength === 0 && Math.hypot(state.x, state.z) < 0.005)
            reedBends.delete(key)
        return state
    }
    function drawReeds(o: Habitat) {
        if (o.kind !== "reeds") return
        // Cull per stem rather than by the centre: long beds can straddle the camera.
        const extent = (o.length ?? 10) * 0.5 + 3
        if (o.z + extent < cam.z || o.z - extent > s.z + 145) return
        let roots = reedRoots.get(o.key)
        if (!roots) {
            roots = []
            reedRoots.set(o.key, roots)
        }
        const islandPatch = o.islandI !== undefined
        const waterBed = !islandPatch && C.rand(o.seed+7521) < .38
        const count = Math.round((o.length ?? 10)*(islandPatch ? 22 : waterBed ? 24 : 15))
        for (let j = 0; j < count; j++) {
            const seed = o.seed + j * 53,
                along = C.rand(seed + 1) * 2 - 1,
                // Most roots are in the dense core; a few form the ragged fringe.
                raw = C.rand(seed + 2) * 2 - 1,
                // A broad, dense tongue joins the shore bed to navigable water.
                // The majority of stems in these beds occupy the tongue itself.
                reaching = waterBed && j % 4 !== 0,
                tongue = Math.exp(-(((along - 0.12) / 0.58) ** 4)),
                across = reaching
                    ? -C.rand(seed + 12) *
                      (0.5 + 3.5 * tongue)
                    : j % 4
                      ? raw * 0.48
                      : raw,
                root = roots[j] ?? (roots[j] = reedPosition(o, along, across)),
                base = project(root)
            if (!base || base.d > 145) continue
            const pixel = Math.min(w, h) * FOCAL_RATIO / base.d
            if (
                base.x < -pixel ||
                base.x > w + pixel ||
                base.y < -pixel * 2 ||
                base.y > h + pixel * 3
            )
                continue
            const fade = 1 - C.clamp((base.d - 110) / 35, 0, 1),
                edge = Math.min(1, Math.abs(across)),
                height = (.52 + C.rand(seed+3)*.80)*(1-edge*.31),
                azimuth = C.rand(seed+8)*C.TAU,
                sway = Math.sin(s.time*.7+root.z*.13)*.075,
                lean = .05+C.rand(seed+4)*.18,
                dry = C.rand(seed+5) < .23,
                col = dry ? "#ad9b67" : j%3 ? "#71884c" : "#8f9d59",
                bend = bendReed(root,o.key+":"+j),
                flatten = Math.min(.28,Math.hypot(bend.x,bend.z)*.32),
                at = (t: number): Point => ({
                    x: root.x+(Math.cos(azimuth)*lean+sway+bend.x)*t*t,
                    y: root.y+height*t-flatten*t*t,
                    z: root.z+(Math.sin(azimuth)*lean+bend.z)*t*t,
                }),
                middle = at(.62),
                tip = at(1)
            // Three faces give the stalk depth from both the camera and the water.
            const stemRing = (p: Point, width: number) => Array.from({length: 3}, (_, i) => {
                const angle = azimuth+i*C.TAU/3
                return {x:p.x+Math.cos(angle)*width,y:p.y,z:p.z+Math.sin(angle)*width}
            })
            const foot = stemRing(root,.017), waist = stemRing(middle,.010)
            for (let i = 0; i < 3; i++) {
                const j = (i+1)%3
                face([foot[i],foot[j],waist[j],waist[i]],col,fade)
                face([waist[i],waist[j],tip],col,fade)
            }
            for (let k = 0; k < 3; k++) {
                const start = at(.25+k*.22)
                const angle = azimuth+k*2.4+(C.rand(seed+k+21)-.5)
                const dx = Math.cos(angle), dz = Math.sin(angle)
                const length = (.23+C.rand(seed+k+28)*.27)*(1-k*.12)
                const width = .034+C.rand(seed+k+36)*.021
                const centre = {x:start.x+dx*length*.48,y:start.y+length*.48,z:start.z+dz*length*.48}
                const left = {x:centre.x-dz*width,y:centre.y-.026,z:centre.z+dx*width}
                const right = {x:centre.x+dz*width,y:centre.y-.026,z:centre.z-dx*width}
                const end = {x:start.x+dx*length,y:start.y+length*.20,z:start.z+dz*length}
                face([start,left,end,centre],col,fade)
                face([start,centre,end,right],mix(col,colors.shade,.22),fade)
            }

        }
    }
    function drawBird(o: RiverBird) {
        // Small birds remain completely hidden until their own takeoff.
        if (o.escaped || (!o.large && (!o.flying || o.age < 0.2))) return
        const p = project({ x: o.x, y: o.y + 0.5, z: o.z })
        if (!p || p.d > 150) return
        const pixels = Math.min(w, h) * FOCAL_RATIO / p.d
        if (p.x < -pixels * 3 || p.x > w + pixels * 3 || p.y < -pixels * 3)
            return
        const size = o.large ? 1 : 0.34,
            co = Math.cos(o.heading),
            si = Math.sin(o.heading),
            preparationTime = o.large ? 0.65 : 0.35,
            preparation = o.flying ? C.clamp(o.age / preparationTime, 0, 1) : 0,
            flightAge = o.flying ? Math.max(0, o.age - preparationTime) : 0,
            flightBlend = 1 - Math.exp(-flightAge * 3.5),
            crouch = Math.sin(preparation * Math.PI) * (1 - flightBlend) * 0.1,
            spread = preparation * preparation * (3 - 2 * preparation),
            flap = o.flying
                ? flightAge > 0
                    ? Math.cos(flightAge * (o.large ? 8 : 17))
                    : Math.sin(preparation * Math.PI * 0.5)
                : 0,
            fade = o.flying ? 1 - C.clamp((o.age - 7) / 2, 0, 1) : 1,
            tr = (q: Point): Point => ({
                x: o.x + (q.x * co + q.z * si) * size,
                y: o.y + q.y * size,
                z: o.z + (-q.x * si + q.z * co) * size,
            }),
            col = o.large ? "#f3ead4" : "#6a7562",
            bodyY = C.lerp(0.72, 0.45, flightBlend) - crouch,
            shape = (
                x: number,
                y: number,
                z: number,
                rx: number,
                ry: number,
                rz: number,
                color: string
            ) => ellipsoid(x, y, z, rx, ry, rz, color, o.seed, 6, 3, tr)
        geometryFade = fade
        shape(0, bodyY, 0, 0.16, 0.23, 0.32, col)
        if (o.large) {
            const headY = C.lerp(1.32, 0.72, flightBlend) - crouch,
                headZ = C.lerp(0.3, 0.36, flightBlend)
            tube(
                [
                    { x: 0, y: bodyY + 0.1, z: 0.13 },
                    { x: 0, y: headY - 0.16, z: 0.07 },
                    { x: 0, y: headY, z: headZ },
                ],
                [0.075, 0.052, 0.06],
                col,
                tr,
                5
            )
            shape(0, headY, headZ, 0.09, 0.1, 0.12, col)
            tube(
                [{x:0,y:headY,z:headZ+.075},{x:0,y:headY-.018,z:headZ+.40}],
                [.036,.003],
                "#b58b4f",
                tr,
                5
            )
            for (const side of [-1, 1]) {
                const end = {
                    x: side * 0.065,
                    y: C.lerp(0.025, 0.39, flightBlend),
                    z: C.lerp(0.06, -0.73, flightBlend),
                }
                rod(
                    { x: side * 0.07, y: bodyY - 0.12, z: -0.06 },
                    end,
                    0.018,
                    "#716c52",
                    tr
                )
            }
        } else shape(0, bodyY+.14, .27, .13, .13, .15, col)
        if (o.flying)
            for (const side of [-1, 1]) {
                face(
                    [
                        tr({ x: side * 0.1, y: bodyY + 0.06, z: 0.14 }),
                        tr({
                            x: side * (0.12 + 0.48 * spread),
                            y: bodyY + flap * spread * 0.28,
                            z: 0.06,
                        }),
                        tr({
                            x: side * (0.16 + 0.89 * spread),
                            y: bodyY + flap * spread * 0.52,
                            z: -0.2,
                        }),
                        tr({
                            x: side * (0.12 + 0.38 * spread),
                            y: bodyY + flap * spread * 0.19,
                            z: -0.28,
                        }),
                        tr({ x: side * 0.1, y: bodyY, z: -0.2 }),
                    ],
                    col
                )
            }
        geometryFade = 1
    }
    function wildlife() {
        for (const key of reedRoots.keys())
            if (!habitats.has(key)) reedRoots.delete(key)
        for (const [key, bend] of reedBends)
            if (s.time - bend.time > 4) reedBends.delete(key)
        for (const o of habitats.values()) drawReeds(o)
        for (const o of deer.values()) drawDeer(o)
        for (const o of birds.values()) drawBird(o)
    }
    function wake() {
        const a = s.wake
        const wakePoint = (v: Wake, across: number) => {
            const width = (0.39 + v.age*(.060 + .08*v.effort)) *
                (1 + .085*Math.sin(v.z*3.1) + .045*Math.sin(v.z*7.3))
            const sternOffset = .65
            return {
                x: v.x + across*Math.cos(v.heading)*width - sternOffset*Math.sin(v.heading),
                y: .008,
                z: v.z - across*Math.sin(v.heading)*width - sternOffset*Math.cos(v.heading),
            }
        }
        const strength = (v: Wake) => (1-v.age/7)**2 * (.057+.16*v.effort)
        const wakeProfile = [-1,-.72,0,.72,1]
        const opacity = [0,1,.40,1,0]
        for (let i = 1; i < a.length; i++) {
            const p = a[i-1], q = a[i]
            if (Math.hypot(p.x-q.x,p.z-q.z) < .001) continue
            if (C.depth(p.x, p.z) < 0.1 || C.depth(q.x, q.z) < 0.1) continue
            const pStrength = strength(p), qStrength = strength(q)
            for (let j = 1; j < wakeProfile.length; j++) {
                const left = wakeProfile[j-1], right = wakeProfile[j]
                gpu.decal(
                    [wakePoint(p,left),wakePoint(q,left),wakePoint(q,right),wakePoint(p,right)],
                    colors.paper,
                    [pStrength*opacity[j-1],qStrength*opacity[j-1],qStrength*opacity[j],pStrength*opacity[j]],
                )
            }
        }
        for (const p of s.ripples) {
            const r = 0.1 + p.age * 0.75,
                pts = []
            for (let i = 0; i <= 28; i++) {
                const a = (i / 28) * C.TAU
                pts.push({
                    x: p.x + Math.cos(a) * r,
                    y: 0.02,
                    z: p.z + Math.sin(a) * r * 0.66,
                })
            }
            line3(pts, colors.paper, 1.25, (1 - p.age / 1.9) * 0.65)
        }
        const pp = C.paddle(s)
        if (pp.dip) {
            const p = C.local(s, pp.blade),
                entry = s.ripples[s.ripples.length - 1]
            ellipse(p.x, 0.021, p.z, 0.19, 0.11, colors.paper, 0.48)
            if (entry)
                line3(
                    [
                        { x: entry.x, y: 0.021, z: entry.z },
                        { x: p.x, y: 0.021, z: p.z },
                    ],
                    colors.paper,
                    1.8,
                    0.38
                )
        }
    }
    function shadow() {
        const dep = C.depth(s.x, s.z),
            offset = 0.06 + dep * 0.55,
            tr = (p: Point) => C.local(s, p),
            col = colors.shadow,
            points: Point[] = []
        for (let i = 0; i < 24; i++) {
            const a = (i / 24) * C.TAU,
                p = tr({ x: Math.cos(a) * 0.4, y: 0.001, z: Math.sin(a) * 1.8 })
            p.x += offset * 0.6
            p.z -= offset
            points.push(p)
        }
        if (points.every((p) => C.depth(p.x, p.z) > 0)) poly(points, col, 0.11)
        const pp = C.paddle(s),
            shaft = [pp.blade, pp.other].map((b) => {
                const p = tr(b)
                p.x += offset * 0.6
                p.z -= offset
                p.y = 0.002
                return p
            })
        if (shaft.every((p) => C.depth(p.x, p.z) > 0.12))
            line3(shaft, col, 1, 0.08)
        for (const b of [pp.blade, pp.other]) {
            const p = tr(b)
            p.x += offset * 0.6
            p.z -= offset
            if (C.depth(p.x, p.z) > 0.12)
                ellipse(p.x, 0.002, p.z, 0.13, 0.3, col, 0.08)
        }
    }
    function draw() {
        if (!w || !h || disposed || lost) return
        // Tall viewports see water directly beneath the camera. Start both
        // meshes behind it and let the GPU clip them at the near plane.
        const start = Math.floor((cam.z - 1) / 2) * 2
        const transition = Math.floor((s.z + 96) / 16) * 16
        const end = Math.ceil((s.z + 650) / 8) * 8
        gpu.begin()
        material = 1
        terrain(start, transition, end)
        material = 0
        vegetation()
        wildlife()
        shadow()
        wake()
        drawKayak(gpu, s)
        for (let z = start; z < end;) {
            const zz = z + (z < transition ? 2 : 8)
            gpu.water(z, zz, C.center(z), C.center(zz), shoreWidth(z), shoreWidth(zz))
            z = zz
        }
        gpu.draw(cam, w, h, Math.min(w, h) * FOCAL_RATIO, pitch, visualTime, C.islands(s.z + 110, 170))
        frames++
    }
    function resize() {
        if (disposed) return
        w = root.clientWidth
        h = root.clientHeight
        // Bound both Retina density and total backing-store area on large displays.
        dpr = Math.min(
            devicePixelRatio || 1,
            1.5,
            Math.sqrt(2400000 / Math.max(1, w * h))
        )
        canvas.width = Math.max(1, Math.round(w * dpr))
        canvas.height = Math.max(1, Math.round(h * dpr))
        draw()
    }
    function begin() {
        if (disposed) return
        if (!started) {
            started = true
            intro.hidden = true
            root.dataset.started = ""
            last = 0
            s.wake = []
        }
        canvas.focus({ preventScroll: true })
        schedule()
    }
    function input(side: number) {
        if (disposed || lost) return
        begin()
        C.input(s, side)
    }
    function resetStroke() {
        s.queue.length = 0
        s.stroke = null
        left.dataset.active = right.dataset.active = "false"
    }
    function frame(t: number) {
        raf = 0
        if (disposed || document.hidden || !visible) return
        // Keep elapsed-time physics independent of the rendering cadence.
        if (!last) nextFrame = t
        if (t + 0.1 < nextFrame) {
            schedule()
            return
        }
        nextFrame +=
            (Math.floor(Math.max(0, t - nextFrame) / FRAME_MS) + 1) * FRAME_MS
        const dt = last ? Math.min((t - last) / 1000, 0.25) : 0
        last = t
        sound.ambience(dt)
        if (!reduced) visualTime += dt
        if (started) {
            const beforeX = s.x,
                beforeZ = s.z,
                beforeContacts = s.contacts
            C.simulate(s, dt)
            sound.glide(s.speed)
            if (s.contacts > beforeContacts) sound.paddle(s.lastSide)
            tripDistance += Math.hypot(s.x - beforeX, s.z - beforeZ)
            if (statsOpen) refreshStats()
            updateDeer(dt)
            updateBirds(dt)
            const smooth = 1 - Math.exp(-dt * (reduced ? 2 : 3.2))
            cam.x += (s.x - cam.x) * smooth
            cam.z += (s.z - CAMERA_TRAIL - cam.z) * smooth
            const leftActive = String(s.stroke?.side === 1),
                rightActive = String(s.stroke?.side === -1)
            if (left.dataset.active !== leftActive)
                left.dataset.active = leftActive
            if (right.dataset.active !== rightActive)
                right.dataset.active = rightActive
        }
        draw()
        schedule()
    }
    function schedule() {
        if (
            !raf &&
            !disposed &&
            !lost &&
            !document.hidden &&
            visible &&
            (started || !reduced)
        )
            raf = requestAnimationFrame(frame)
    }
    {
        on(root, "pointerdown", (e) => {
            // Controls have their own handlers: never turn one button press into two strokes.
            const target = e.target
            if (
                target instanceof Element &&
                target.closest("button, a, [role='button']")
            )
                return
            if (e.button !== 0 || !e.isPrimary) return
            e.preventDefault()
            if (started || e.pointerType === "touch" || e.pointerType === "pen") {
                const bounds = root.getBoundingClientRect()
                if (!bounds.width || !bounds.height || !w || !h) return
                // Convert viewport coordinates to the canvas layout coordinates.
                const tapY = ((e.clientY - bounds.top) * h) / bounds.height
                if (tapY < h / 3 || tapY > h) {
                    if (!started) begin()
                    return
                }
                const boatX = project({ x: s.x, y: 0.2, z: s.z })?.x ?? w / 2
                const tapX = ((e.clientX - bounds.left) * w) / bounds.width
                // Keep a finger-width neutral strip centered on the kayak.
                if (tapX < 0 || tapX > w || Math.abs(tapX - boatX) <= 22) {
                    if (!started) begin()
                    return
                }
                input(tapX < boatX ? 1 : -1)
            } else {
                begin()
            }
        })
        on(root, "click", (e) => {
            if (e.target instanceof Element && e.target.closest("a")) return
            begin()
        })
        for (const [b, side] of [
            [left, 1],
            [right, -1],
        ] as Array<[HTMLButtonElement, number]>) {
            on(b, "pointerdown", (e) => {
                if (e.button !== 0) return
                e.preventDefault()
                input(side)
            })
            on(b, "click", (e) => {
                if (e.detail === 0) input(side)
            })
        }
        on(root, "keydown", (e) => {
            if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                e.preventDefault()
                e.stopPropagation()
                if (!e.repeat) input(e.key === "ArrowLeft" ? 1 : -1)
            } else if (!started && ["Enter", " "].includes(e.key) &&
                !(e.target instanceof Element && e.target.closest("a"))) {
                e.preventDefault()
                begin()
            }
        })
        on(document, "visibilitychange", () => {
            last = 0
            sound.setActive(visible && !document.hidden && !lost)
            if (document.hidden) {
                cancelAnimationFrame(raf)
                raf = 0
                resetStroke()
            } else schedule()
        })
        on(media, "change", () => {
            reduced = media.matches
            last = 0
            schedule()
        })
    }
    const ro = new ResizeObserver(resize)
    ro.observe(root)
    const io = new IntersectionObserver((es) => {
        visible = es[0].isIntersecting
        sound.setActive(visible && !document.hidden && !lost)
        last = 0
        if (visible) schedule()
        else {
            cancelAnimationFrame(raf)
            raf = 0
            resetStroke()
        }
    })
    io.observe(root)
    function destroy() {
        if (disposed) return
        disposed = true
        cancelAnimationFrame(raf)
        raf = 0
        ro.disconnect()
        io.disconnect()
        listeners.splice(0).forEach((f) => f())
        clearTimeout(statsTimer)
        sound.destroy()
        toolbar.remove()
        stats.remove()
        reedRoots.clear()
        reedBends.clear()
        habitats.clear()
        birds.clear()
        deer.clear()
        trees.clear()
        shadeCache.clear()
        s.wake = []
        s.ripples = []
        s.queue = []
        gpu.destroy()
        canvas.width = canvas.height = 1
    }
    on(window, "pagehide", (e) => {
        if (e.persisted) {
            sound.setActive(false)
            cancelAnimationFrame(raf)
            raf = 0
            last = 0
            resetStroke()
        } else destroy()
    })
    on(window, "pageshow", () => {
        last = 0
        sound.setActive(visible && !document.hidden && !lost)
        schedule()
    })
    updateDeer(0)
    updateBirds(0)
    on(canvas, "webglcontextlost", (event) => {
        event.preventDefault()
        lost = true
        sound.setActive(false)
        cancelAnimationFrame(raf)
        raf = 0
        resetStroke()
        root.dataset.renderer = "paused"
    })
    on(canvas, "webglcontextrestored", () => {
        try {
            gpu = new RiverRenderer(canvas)
            root.dataset.renderer = "webgl2"
            lost = false
            sound.setActive(visible && !document.hidden)
            last = 0
            draw()
            schedule()
        } catch (error) {
            root.dataset.renderer = "unavailable"
            console.error(error)
        }
    })
    resize()
    schedule()
    return {
        destroy,
        snapshot: () => ({
            started,
            x: s.x,
            z: s.z,
            heading: s.heading,
            speed: s.speed,
            queue: s.queue.length,
            wake: s.wake.length,
            ripples: s.ripples.length,
            distance: tripDistance,
            statsOpen,
            contacts: s.contacts,
            deer: Array.from(deer.values()).map(({ id, x, z, state, age }) => ({
                id,
                x,
                z,
                state,
                age,
            })),
            habitats: habitats.size,
            birds: Array.from(birds.values()).map(
                ({ key, large, flying, escaped, x, y, z }) => ({
                    key,
                    large,
                    flying,
                    escaped,
                    x,
                    y,
                    z,
                })
            ),
            trees: trees.size,
            bankDistance: C.bankDistance(s.x, s.z),
            reedRootBeds: reedRoots.size,
            targetFPS: 60,
            dpr,
            frames,
            disposed,

        }),
    }
}
