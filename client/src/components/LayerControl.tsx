import { LAYERS, getLayer, type LayerId } from "../lib/mapLayers";

interface Props {
  active: LayerId;
  onChange: (id: LayerId) => void;
}

const INK = "rgb(42,54,106)";
const PAPER = "#ece4d0";

/** The map legend, styled as a printed box on the sheet. */
export default function LayerControl({ active, onChange }: Props) {
  const layer = getLayer(active);

  return (
    <div
      className="absolute bottom-4 left-44 px-3 py-2 select-none"
      style={{
        background: PAPER,
        border: `1.5px solid rgba(42,54,106,0.85)`,
        boxShadow: `inset 0 0 0 3px ${PAPER}, inset 0 0 0 4px rgba(42,54,106,0.5)`,
        fontFamily: "Georgia, 'Times New Roman', serif",
        color: INK,
      }}
    >
      <div className="text-[9px] font-bold mb-1.5" style={{ letterSpacing: "0.3em" }}>
        LEGEND
      </div>
      <div className="flex gap-1">
        {LAYERS.map((l) => (
          <button
            key={l.id}
            onClick={() => onChange(l.id)}
            className="px-2 py-1 text-[10px] transition-opacity"
            style={{
              fontFamily: "inherit",
              letterSpacing: "0.1em",
              color: INK,
              border: `1px solid rgba(42,54,106,${active === l.id ? 0.85 : 0.25})`,
              background: active === l.id ? "rgba(42,54,106,0.12)" : "transparent",
              opacity: active === l.id ? 1 : 0.6,
            }}
          >
            {l.label.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-[9px] italic opacity-75">{layer.legend}</span>
        {layer.ramp && (
          <span
            className="h-1.5 w-16"
            style={{
              border: "0.5px solid rgba(42,54,106,0.3)",
              background: `linear-gradient(to right, ${PAPER}, rgb(${layer.ramp[0]},${layer.ramp[1]},${layer.ramp[2]}))`,
            }}
          />
        )}
      </div>
    </div>
  );
}
