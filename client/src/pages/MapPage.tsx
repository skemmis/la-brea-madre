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

  const hasActionToday = !!player?.todayAction;
  const viewerCrude = player?.crude ?? 0;

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-[#0a0a0a]">
      {/* Full-screen map */}
      <HexMap
        viewerUserId={user?.id}
        onSelectHex={setSelectedHex}
        selectedHex={selectedHex}
      />

      {/* HUD overlay */}
      <PlayerHUD />

      {/* Hex detail panel */}
      {selectedHex && (
        <HexPanel
          hex={selectedHex}
          viewerUserId={user?.id}
          hasActionToday={hasActionToday}
          viewerCrude={viewerCrude}
          onClose={() => setSelectedHex(null)}
        />
      )}

      {/* Leaderboard toggle */}
      <Leaderboard />

      {/* Tick legend */}
      <div className="absolute bottom-4 right-4 text-[9px] font-mono text-[#d97706]/30 text-right space-y-0.5">
        <div>DAILY TICK · MIDNIGHT PT</div>
        <div>♦ CRUDE · REAL LA DATA</div>
      </div>
    </div>
  );
}
