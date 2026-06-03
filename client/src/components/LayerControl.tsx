import { LAYERS, getLayer, type LayerId } from "../lib/mapLayers";

interface Props {
  active: LayerId;
  onChange: (id: LayerId) => void;
}

export default function LayerControl({ active, onChange }: Props) {
  const layer = getLayer(active);

  return (
    <div className="absolute bottom-4 left-4 bg-[#0f0b07]/90 border border-[#d97706]/30 rounded-sm p-2 font-mono">
      <div className="text-[9px] text-[#d97706]/50 tracking-[0.3em] uppercase mb-1.5">
        Layer
      </div>
      <div className="flex gap-1">
        {LAYERS.map((l) => (
          <button
            key={l.id}
            onClick={() => onChange(l.id)}
            className={`px-2 py-1 text-[10px] tracking-wide rounded-sm border transition-colors ${
              active === l.id
                ? "border-[#d97706]/70 bg-[#d97706]/20 text-[#d97706]"
                : "border-[#d97706]/15 text-[#d97706]/40 hover:text-[#d97706]/70 hover:border-[#d97706]/40"
            }`}
          >
            {l.label.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-[9px] text-[#888] tracking-wide">{layer.legend}</span>
        {layer.ramp && (
          <span
            className="h-1.5 w-16 rounded-full"
            style={{
              background: `linear-gradient(to right, #0e0a07, rgb(${layer.ramp[0]},${layer.ramp[1]},${layer.ramp[2]}))`,
            }}
          />
        )}
      </div>
    </div>
  );
}
