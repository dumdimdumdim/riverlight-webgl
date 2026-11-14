const paddleFiles = ["paddle-1.mp3", "paddle-2.mp3", "paddle-3.mp3"]

export function createRiverSound(button: HTMLButtonElement) {
    let context: AudioContext | undefined
    let volume: GainNode | undefined
    let hull: AudioBuffer | undefined
    let hullSource: AudioBufferSourceNode | undefined
    let hullGain: GainNode | undefined
    let hullLevel = 0
    let wings: AudioBuffer | undefined
    let riverBirds: AudioBuffer | undefined
    let untilBirdsong = 7
    let lastTakeoff = -Infinity
    let paddles: AudioBuffer[] = []
    let enabled = false
    let active = true
    let disposed = false
    let nextPaddle = 0
    let assets: Promise<AudioBuffer[]> | undefined
    let toggleVersion = 0
    const downloads = new AbortController()

    function sync() {
        if (!context || !volume || disposed) return
        const now = context.currentTime
        const audible = enabled && active
        volume.gain.setTargetAtTime(audible ? 1 : 0, now, audible ? 0.16 : 0.025)
        if (!audible && hullSource && !hullSource.onended) {
            const fading = hullSource
            fading.onended = () => {
                hullSource = undefined
                if (enabled && active) sync()
            }
            fading.stop(now + 0.15)
        } else if (audible && hull && hullGain && !hullSource) {
            hullSource = context.createBufferSource()
            hullSource.buffer = hull
            hullSource.loop = true
            hullSource.connect(hullGain)
            hullSource.start()
        }
    }

    async function load(context: AudioContext, file: string) {
        const response = await fetch(`./audio/${file}`, { signal: downloads.signal })
        if (!response.ok) throw new Error(`Could not load ${file}: ${response.status}`)
        return context.decodeAudioData(await response.arrayBuffer())
    }

    function play(buffer: AudioBuffer, level: number, balance: number, lowpass?: number) {
        if (!volume || context?.state !== "running" || !enabled || !active) return
        const source = context.createBufferSource()
        source.buffer = buffer
        source.playbackRate.value = 0.96 + Math.random() * 0.08
        const pan = context.createStereoPanner()
        pan.pan.value = balance
        const gain = context.createGain()
        gain.gain.value = level
        const filter = lowpass === undefined ? undefined : context.createBiquadFilter()
        if (filter && lowpass !== undefined) {
            filter.type = "lowpass"
            filter.frequency.value = lowpass
            filter.Q.value = 0.4
            source.connect(filter).connect(pan)
        } else source.connect(pan)
        pan.connect(gain).connect(volume)
        source.onended = () => {
            filter?.disconnect()
            pan.disconnect()
            gain.disconnect()
        }
        source.start()
    }

    return {
        async toggle() {
            if (disposed) return
            const version = ++toggleVersion
            enabled = !enabled
            button.setAttribute("aria-pressed", String(enabled))
            if (!enabled) {
                sync()
                return
            }
            try {
                if (!context) {
                    context = new AudioContext()
                    volume = context.createGain()
                    volume.gain.value = 0
                    volume.connect(context.destination)
                    hullGain = context.createGain()
                    hullGain.gain.value = hullLevel
                    hullGain.connect(volume)
                }
                // Safari requires resume to happen directly in the click handler.
                await context.resume()
                if (disposed || version !== toggleVersion) return
                if (!hull) {
                    const audioContext = context
                    assets ??= Promise.all(
                        ["hull.mp3", "wings.mp3", "river-birds.mp3", ...paddleFiles].map(
                            file => load(audioContext, file)
                        )
                    ).catch(error => {
                        assets = undefined
                        throw error
                    })
                    const [hullWater, takeoff, birdsong, ...splashes] = await assets
                    if (disposed || version !== toggleVersion) return
                    hull = hullWater
                    wings = takeoff
                    riverBirds = birdsong
                    paddles = splashes
                }
                sync()
            } catch (error) {
                if (disposed || version !== toggleVersion) return
                enabled = false
                button.setAttribute("aria-pressed", "false")
                console.warn("Riverlight audio could not start.", error)
            }
        },
        setActive(value: boolean) {
            if (value === active) return
            active = value
            sync()
        },
        glide(speed: number) {
            if (!hullGain || !context || !enabled || !active) return
            // Silence at rest. Fade in the water against the hull as the boat glides.
            const motion = Math.min(1, Math.max(0, (speed - 0.35) / 3.4))
            const level = Math.round(motion * motion * 24) / 100
            if (level === hullLevel) return
            hullLevel = level
            hullGain.gain.setTargetAtTime(level, context.currentTime, 0.32)
        },
        paddle(side: number) {
            if (!enabled || !active || !paddles.length) return
            play(paddles[nextPaddle], 0.25, side > 0 ? -0.15 : 0.15, 2500)
            nextPaddle = (nextPaddle + 1) % paddles.length
        },
        takeoff(distance: number, lateral: number) {
            if (!wings || context?.state !== "running" || !enabled || !active) return
            // Birds from the same patch can take off almost simultaneously.
            if (context.currentTime - lastTakeoff < 0.85) return
            lastTakeoff = context.currentTime
            const balance = Math.max(-0.55, Math.min(0.55, lateral / 15))
            play(wings, 0.28 / (1 + distance / 12), balance)
            untilBirdsong = Math.max(untilBirdsong, 9)
        },
        ambience(dt: number) {
            if (!riverBirds || context?.state !== "running" || !enabled || !active) return
            untilBirdsong -= dt
            if (untilBirdsong > 0) return
            play(riverBirds, 0.18, (Math.random() - 0.5) * 0.5)
            untilBirdsong = riverBirds.duration + 21 + Math.random() * 18
        },
        destroy() {
            disposed = true
            downloads.abort()
            void context?.close()
        },
    }
}
