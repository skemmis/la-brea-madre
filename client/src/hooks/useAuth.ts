import { useQuery } from "@tanstack/react-query";

interface AuthUser {
  id: number;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  crude: number;
  totalHexes: number;
}

export function useAuth() {
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: async () => {
      const res = await fetch("/api/auth/user", { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Auth check failed");
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  return { user: user ?? null, isLoading };
}
