import { mountRiverlight } from "./game"

const root = document.querySelector<HTMLElement>(".riverlight-game")!
try {
    const game = mountRiverlight(root)
    // Opt-in state inspection for browser checks and tuning.
    if (new URLSearchParams(location.search).has("debug"))
        Object.assign(window, { riverlight: game })
} catch (error) {
    root.dataset.renderer = "unavailable"
    root.querySelector<HTMLElement>("[data-render-status]")!.textContent =
        "Riverlight needs WebGL 2. Try another browser or enable hardware acceleration."
    console.error(error)
}
