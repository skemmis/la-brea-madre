import { LAYERS, getLayer, type LayerId } from "../lib/mapLayers";

interface Props {
  active: LayerId;
  onChange: (id: LayerId) => void;
}

const PAPER = "#ece4d0";

/** The map legend, styled as a printed box on the sheet. */
export default function LayerControl({ active, onChange }: Props) {
  const layer = getLayer(active);

  return (
    <div className="plate absolute bottom-4 left-44 px-3 py-2 select-none">
      <div className="plate-title text-[9px] mb-1.5">LEGEND</div>
      <div className="flex gap-1">
        {LAYERS.map((l) => (
          <button
            key={l.id}
            onClick={() => onChange(l.id)}
            className="btn-ink px-2 py-1 text-[10px]"
            data-active={active === l.id}
            style={{ opacity: active === l.id ? 1 : 0.65 }}
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
