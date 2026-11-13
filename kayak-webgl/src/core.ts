import type { Island, Point, Trip } from "./types"

export const KayakCore = (() => {
    const TAU = Math.PI * 2,
        clamp = (x: number, a: number, b: number) =>
            Math.max(a, Math.min(b, x)),
        rand = (n: number) => {
            const v = Math.sin(n * 127.1 + 311.7) * 43758.5453
            return v - Math.floor(v)
        },
        lerp = (a: number, b: number, t: number) => a + (b - a) * t
    const angleDelta = (a: number, b: number) =>
        Math.atan2(Math.sin(a - b), Math.cos(a - b))
    function simulate(s: Trip, elapsed: number) {
        let remaining = clamp(elapsed, 0, 0.25)
        while (remaining > 1e-9) {
            const dt = Math.min(remaining, 1 / 120)
            step(s, dt)
            remaining -= dt
        }
    }
    const center = (z: number) =>
            8.5 * Math.sin(z / 57) + 3.4 * Math.sin(z / 137 + 0.5),
        slope = (z: number) =>
            (8.5 / 57) * Math.cos(z / 57) +
            (3.4 / 137) * Math.cos(z / 137 + 0.5),
        half = (z: number) =>
            15 + 1.6 * Math.sin(z / 83 + 2) + 0.8 * Math.sin(z / 41),
        sand = (z: number) =>
            1.3 + 0.45 * Math.sin(z / 21) + 0.3 * Math.sin(z / 47)
    function island(i: number): Island {
        const z = 110 + i * 230 + rand(i + 87) * 35
        return {
            i,
            z,
            x: center(z) + (rand(i + 29) - 0.5) * 8,
            rx: 2.3 + rand(i + 64) * 1.2,
            rz: 5.4 + rand(i + 88) * 3,
            phase: rand(i + 11) * TAU,
        }
    }
    function islands(z: number, range = 100): Island[] {
        const a = []
        for (
            let i = Math.floor((z - range - 145) / 230);
            i <= Math.ceil((z + range - 110) / 230);
            i++
        ) {
            const o = island(i)
            if (Math.abs(o.z - z) < range) a.push(o)
        }
        return a
    }
    function radius(o: Island, a: number) {
        return (
            1 +
            0.1 * Math.sin(a * 3 + o.phase) +
            0.05 * Math.cos(a * 5 - o.phase)
        )
    }
    function islandDistance(x: number, z: number, o: Island) {
        const dx = x - o.x,
            dz = z - o.z,
            a = Math.atan2(dz / o.rz, dx / o.rx),
            r = radius(o, a),
            len = Math.hypot(dx / o.rx, dz / o.rz)
        const nx = dx / (o.rx * o.rx),
            nz = dz / (o.rz * o.rz),
            nl = Math.hypot(nx, nz) || 1
        return { d: (len - r) * Math.min(o.rx, o.rz), nx: nx / nl, nz: nz / nl }
    }
    function bankDistance(x: number, z: number) {
        return (
            (half(z) - Math.abs(x - center(z))) / Math.sqrt(1 + slope(z) ** 2)
        )
    }
    function depth(x: number, z: number) {
        let d = bankDistance(x, z)
        for (const o of islands(z, 15))
            d = Math.min(d, islandDistance(x, z, o).d)
        return clamp(d / 2, 0, 1)
    }
    function paddle(s: Trip) {
        const active = !!s.stroke,
            u = active ? clamp(s.stroke!.age / 0.9, 0, 1) : 0,
            side = active ? s.stroke!.side : 1
        // One continuous path: place the blade, pull through water, lift and recover.
        // Shared tangents keep the blade moving naturally across phase boundaries.
        const ease = (t: number) => {
                t = clamp(t, 0, 1)
                return t * t * (3 - 2 * t)
            },
            path = (values: number[], tangents: number[]) => {
                const times = [0, 0.18, 0.68, 0.84, 1]
                let i = 0
                while (i < times.length - 2 && u > times[i + 1]) i++
                const span = times[i + 1] - times[i],
                    t = clamp((u - times[i]) / span, 0, 1),
                    t2 = t * t,
                    t3 = t2 * t
                return (
                    (2 * t3 - 3 * t2 + 1) * values[i] +
                    (t3 - 2 * t2 + t) * span * tangents[i] +
                    (-2 * t3 + 3 * t2) * values[i + 1] +
                    (t3 - t2) * span * tangents[i + 1]
                )
            },
            dip = active && u >= 0.18 && u <= 0.73
        const y = path([0.46, -0.08, -0.09, 0.27, 0.46], [0, -0.35, 0.6, 2, 0]),
            z = path([0, 0.55, -0.6, -0.38, 0], [0, 0, 0, 2.6, 0])
        const x = Math.sqrt(1.48 * 1.48 - (y - 0.46) ** 2 - z * z),
            yaw = active
                ? side * 0.24 * Math.sin(TAU * u) * Math.sin(Math.PI * u)
                : 0,
            co = Math.cos(yaw),
            si = Math.sin(yaw),
            bx = -side * x * co + z * si,
            bz = side * x * si + z * co,
            reach = active
                ? u < 0.18
                    ? ease(u / 0.18)
                    : u <= 0.84
                      ? 1
                      : 1 - ease((u - 0.84) / 0.16)
                : 0,
            center = {
                x: -side * 0.16 * reach,
                y: 0.46,
                z: -0.32 + 0.14 * reach,
            },
            blade = { x: center.x + bx, y, z: center.z + bz },
            other = { x: center.x - bx, y: 0.92 - y, z: center.z - bz }
        return { blade, other, dip, u, side, yaw, center }
    }

    function local(s: Trip, p: Point): Point {
        return {
            x: s.x + p.x * Math.cos(s.heading) + p.z * Math.sin(s.heading),
            y: p.y,
            z: s.z - p.x * Math.sin(s.heading) + p.z * Math.cos(s.heading),
        }
    }
    function create(): Trip {
        return {
            x: center(0),
            z: 0,
            heading: 0,
            speed: 0,
            angular: 0,
            time: 0,
            stroke: null,
            queue: [],
            ripples: [],
            wake: [],
            wakeClock: 0,
            lastSide: 0,
            lastTime: -10,
            course: 0,
            desired: 0,
            contacts: 0,
        }
    }
    function input(s: Trip, side: number) {
        if (!s.stroke) s.stroke = { side, age: 0, pushed: false }
        else if (s.queue.length < 2) s.queue.push(side)
    }
    function guide(s: Trip, dt: number) {
        const margin = 1.95 + 0.9 * Math.abs(Math.sin(s.heading)),
            sl = slope(s.z),
            norm = Math.sqrt(1 + sl * sl),
            c = center(s.z),
            side = Math.sign(s.x - c) || 1,
            d = bankDistance(s.x, s.z),
            f = clamp((margin + 2 - d) / 2, 0, 1)
        if (f) {
            const target = Math.atan(sl),
                delta = Math.atan2(
                    Math.sin(target - s.heading),
                    Math.cos(target - s.heading)
                )
            if (side * Math.sin(s.heading - target) > 0)
                s.heading += delta * (1 - Math.exp(-dt * 3.2 * f))
            // Constrain only steering into the bank; preserve every outward paddle command.
            if (side * Math.sin(s.desired - target) > 0) {
                s.desired = s.heading + angleDelta(target, s.heading)
                s.course = s.desired
            }
            s.angular *= Math.exp(-dt * 7 * f)
            if (d < margin) {
                s.x -= (side * (margin - d)) / norm
                s.z += (side * (margin - d) * sl) / norm
            }
        }
        for (const o of islands(s.z, 26)) {
            const q = islandDistance(s.x, s.z, o),
                m = 2.15,
                f = clamp((m + 7 - q.d) / 7, 0, 1)
            if (!f) continue
            let tx = -q.nz,
                tz = q.nx
            if (tz < 0) {
                tx = -tx
                tz = -tz
            }
            const target = Math.atan2(tx, Math.max(0.12, tz)),
                delta = Math.atan2(
                    Math.sin(target - s.heading),
                    Math.cos(target - s.heading)
                )
            if (Math.sin(s.heading) * q.nx + Math.cos(s.heading) * q.nz < 0)
                s.heading += clamp(delta, -0.45 * dt * f, 0.45 * dt * f)
            if (Math.sin(s.desired) * q.nx + Math.cos(s.desired) * q.nz < 0) {
                const turn = Math.atan2(
                    Math.sin(target - s.desired),
                    Math.cos(target - s.desired)
                )
                s.desired += clamp(turn, -0.65 * dt * f, 0.65 * dt * f)
                s.course = s.desired
            }
            s.angular *= Math.exp(-dt * 8 * f)
            if (q.d < m) {
                for (let k = 0; k < 5; k++) {
                    const r = islandDistance(s.x, s.z, o)
                    if (r.d >= m) break
                    s.x += r.nx * (m - r.d)
                    s.z += r.nz * (m - r.d)
                }
            }
        }
    }
    function step(s: Trip, dt: number) {
        s.time += dt
        let remaining = dt
        while (s.stroke && remaining > 0) {
            const st = s.stroke,
                part = Math.min(remaining, 0.9 - st.age)
            st.age += part
            remaining -= part
            if (!st.pushed && st.age >= 0.162) {
                st.pushed = true
                s.speed = Math.min(8, s.speed + 1.65)
                const alternating =
                    s.lastSide &&
                    st.side !== s.lastSide &&
                    s.time - s.lastTime < 1.3
                if (alternating) {
                    s.desired = s.course
                } else {
                    s.course = s.desired
                    s.desired += st.side * 0.155
                }
                s.lastSide = st.side
                s.lastTime = s.time
                const pt = local(s, paddle(s).blade)
                s.ripples.push({ x: pt.x, z: pt.z, age: 0, side: st.side })
                s.contacts++
            }
            if (st.age >= 0.9 - 1e-8) {
                s.stroke = s.queue.length
                    ? { side: s.queue.shift()!, age: 0, pushed: false }
                    : null
            }
        }
        s.speed *= Math.pow(0.5, dt / 1.6)
        s.heading += angleDelta(s.desired, s.heading) * (1 - Math.exp(-dt * 10))
        const sl = slope(s.z),
            n = Math.sqrt(1 + sl * sl)
        s.x += (Math.sin(s.heading) * s.speed + (1.35 * sl) / n) * dt
        s.z += (Math.cos(s.heading) * s.speed + 1.35 / n) * dt
        guide(s, dt)
        s.wakeClock += dt
        if (s.wakeClock >= 0.055) {
            s.wakeClock = 0
            const p = local(s, { x: 0, y: 0, z: -0.05 })
            s.wake.push({
                x: p.x,
                z: p.z,
                heading: s.heading,
                age: 0,
                effort: s.speed / 8,
            })
        }
        for (const p of s.wake) p.age += dt
        for (const p of s.ripples) p.age += dt
        s.wake = s.wake.filter((p) => p.age < 7).slice(-132)
        s.ripples = s.ripples.filter((p) => p.age < 1.9).slice(-18)
    }
    return {
        angleDelta,
        simulate,
        TAU,
        clamp,
        rand,
        lerp,
        center,
        slope,
        half,
        sand,
        island,
        islands,
        radius,
        islandDistance,
        bankDistance,
        depth,
        paddle,
        local,
        create,
        input,
        step,
        guide,
    }
})()

// A foreleg has shoulder, elbow, carpus and hoof; a hind leg has hip,
// stifle, hock and hoof. The upper joints remain close to the body.
export function deerLegPose(
    cycle: number,
    side: number,
    front: number,
    effort: number,
    bounce: number
) {
    // Rotary gallop: RH -> LH -> LF -> RF, followed by gathered flight.
    // Timings are a stylized cycle based on the cited motion references.
    const contact = front < 0 ? (side > 0 ? 0 : 0.09) : side < 0 ? 0.38 : 0.47,
        phase = (((cycle - contact) % 1) + 1) % 1,
        stance = 0.24,
        swing = Math.max(0, (phase - stance) / (1 - stance)),
        // Stride * stance / 2: a supporting hoof travels backwards at body speed.
        reach = (2.1 * stance) / 2,
        keys = [
            [0, -reach, 0],
            [0.18, -0.33, 0.16],
            [0.48, -0.08, 0.43],
            [0.76, 0.27, 0.25],
            [1, reach, 0],
        ],
        sample = (column: number) => {
            let i = 0
            while (i < keys.length - 2 && swing > keys[i + 1][0]) i++
            const t = (swing - keys[i][0]) / (keys[i + 1][0] - keys[i][0]),
                smooth = t * t * (3 - 2 * t)
            return (
                keys[i][column] +
                (keys[i + 1][column] - keys[i][column]) * smooth
            )
        },
        offset =
            (phase < stance ? reach * (1 - (2 * phase) / stance) : sample(1)) *
            effort,
        lift =
            (phase < stance ? 0 : sample(2)) * effort * (front < 0 ? 0.7 : 1),
        isFront = front > 0,
        hip = {
            x: side * (isFront ? 0.16 : 0.185),
            y: (isFront ? 1.13 : 1.08) - (isFront ? 0.18 : 0.07) * effort,
            z: front * 0.42,
        },
        // The elbow points back; the true hind knee points forward.
        upperAngle = isFront
            ? -0.34 - offset * 0.7
            : Math.max(0.35, Math.min(1.12, 0.66 + offset * 1.6 + lift * 0.8)),
        upperLength = isFront ? 0.34 : 0.5,
        knee = {
            x: hip.x,
            y: hip.y - Math.cos(upperAngle) * upperLength,
            z: hip.z + Math.sin(upperAngle) * upperLength,
        },
        foot = {
            x: hip.x,
            y: 0.04 + lift - bounce,
            z: hip.z + (isFront ? 0.015 : 0.035) + offset,
        },
        dy = foot.y - knee.y,
        dz = foot.z - knee.z,
        distance = Math.hypot(dy, dz),
        upper = isFront ? 0.4 : 0.34,
        lower = isFront ? 0.4 : 0.49,
        along =
            (upper * upper - lower * lower + distance * distance) /
            (2 * distance),
        bend = Math.sqrt(Math.max(0, upper * upper - along * along)),
        direction = isFront ? -1 : 1,
        hock = {
            x: hip.x,
            y:
                knee.y +
                (dy * along) / distance -
                (direction * dz * bend) / distance,
            z:
                knee.z +
                (dz * along) / distance +
                (direction * dy * bend) / distance,
        }
    return { hip, knee, hock, foot }
}
