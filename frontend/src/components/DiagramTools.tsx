const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4]

export type Zoom = number | 'fit'

interface Props {
  zoom: Zoom
  onZoom: (z: Zoom) => void
  /** the scale "Fit" currently shows, so − and + continue from it */
  fitScale: number
}

/** Zoom, in the top-right corner of the diagram card. */
export function DiagramTools({ zoom, onZoom, fitScale }: Props) {
  const step = (dir: 1 | -1) => {
    const z = zoom === 'fit' ? fitScale : zoom
    const next = dir > 0 ? ZOOMS.find((v) => v > z + 0.01) : [...ZOOMS].reverse().find((v) => v < z - 0.01)
    if (next) onZoom(next)
  }
  return (
    <div className="diagram-tools">
      <div className="zoom" role="group" aria-label="Zoom">
        <button onClick={() => step(-1)} title="Zoom out" aria-label="Zoom out">−</button>
        <button className="zoom-level mono" onClick={() => onZoom('fit')} title="Fit to the window">
          {zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}
        </button>
        <button onClick={() => step(1)} title="Zoom in" aria-label="Zoom in">+</button>
      </div>
    </div>
  )
}
