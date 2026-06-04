import { usePlayer } from "../hooks/usePlayer";
import { useAuth } from "../hooks/useAuth";
import { Droplets, MapPin, Clock, Trophy } from "lucide-react";
import { Link } from "wouter";

export default function PlayerHUD() {
  const { user } = useAuth();
  const { data: player } = usePlayer(!!user);

  return (
    <div className="absolute top-4 left-4 flex flex-col gap-2">
      {/* Title */}
      <div className="text-[10px] text-[#d97706]/50 tracking-[0.3em] uppercase font-mono">
        La Brea Madre
      </div>

      {user && player ? (
        <div className="bg-[#0f0b07]/90 border border-[#d97706]/30 rounded-sm p-3 font-mono text-[#e8dcc8] min-w-[180px]">
          <div className="text-xs text-[#d97706]/70 mb-2 tracking-wide">
            {player.displayName.toUpperCase()}
          </div>
          <div className="space-y-1.5">
            <Stat icon={<Droplets size={11} />} label="CRUDE" value={player.crude} />
            <Stat icon={<MapPin size={11} />} label="HEXES" value={player.totalHexes} />
            <div className="pt-1 border-t border-[#d97706]/10">
              {player.todayAction ? (
                <div className="flex items-center gap-1.5 text-[10px] text-[#888]">
                  <Clock size={10} />
                  <span>
                    ACTION USED · {player.todayAction.actionType.toUpperCase()}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[10px] text-[#86d97a]">
                  <Clock size={10} />
                  <span>ACTION READY</span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[#0f0b07]/90 border border-[#d97706]/20 rounded-sm p-3 font-mono">
          <a
            href="/api/login"
            className="text-xs text-[#d97706]/60 hover:text-[#d97706] tracking-widest"
          >
            LOGIN TO CLAIM TERRITORY →
          </a>
        </div>
      )}

      {/* Nav */}
      <div className="flex gap-2">
        <Link
          href="/"
          className="text-[10px] text-[#d97706]/40 hover:text-[#d97706]/70 font-mono tracking-widest"
        >
          MARKET
        </Link>
        {user && (
          <>
            <span className="text-[#d97706]/20">·</span>
            <Link
              href="/admin"
              className="text-[10px] text-[#d97706]/40 hover:text-[#d97706]/70 font-mono tracking-widest"
            >
              ADMIN
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="flex items-center gap-1 text-[#888]">
        {icon}
        {label}
      </span>
      <span className="text-[#d97706] tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}
