import { useState } from "react";
import HexMap, { type HexData } from "../components/HexMap";
import HexPanel from "../components/HexPanel";
import PlayerHUD from "../components/PlayerHUD";
import Leaderboard from "../components/Leaderboard";
import { useAuth } from "../hooks/useAuth";
import { usePlayer } from "../hooks/usePlayer";

export default function MapPage() {
  const { user } = useAuth();
  const { data: player } = usePlayer(!!user);
  const [selectedHex, setSelectedHex] = useState<HexData | null>(null);

  const workOrders = player?.workOrders ?? 0;
  const viewerCash = player?.crude ?? 0;

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-[#ece4d0]">
      {/* Full-screen map */}
      <HexMap
        viewerUserId={user?.id}
        onSelectHex={setSelectedHex}
        selectedHex={selectedHex}
      />

      {/* Title cartouche, like the old sheets' corner block */}
      <div className="plate absolute top-4 right-4 px-4 py-3 text-right select-none">
        <div className="text-base font-bold" style={{ letterSpacing: "0.35em" }}>
          LOS ANGELES
        </div>
        <div className="text-[10px]" style={{ letterSpacing: "0.2em" }}>
          LA BREA MADRE
        </div>
        <div className="text-[8px] mt-1 opacity-70" style={{ letterSpacing: "0.1em" }}>
          DAILY TICK · MIDNIGHT PT
          <br />
          DRAWN FROM REAL CITY RECORDS
        </div>
      </div>

      {/* HUD overlay */}
      <PlayerHUD />

      {/* Hex detail panel */}
      {selectedHex && (
        <HexPanel
          hex={selectedHex}
          viewerUserId={user?.id}
          workOrders={workOrders}
          viewerCash={viewerCash}
          onClose={() => setSelectedHex(null)}
        />
      )}

      {/* Leaderboard toggle */}
      <Leaderboard />
    </div>
  );
}
