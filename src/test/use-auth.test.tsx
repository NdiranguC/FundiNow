import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/use-auth";

const { getSession, from } = vi.hoisted(() => ({
  getSession: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession },
    from,
  },
}));

function AuthSummary() {
  const { user, roles, loading } = useAuth();
  if (loading) return <p>Loading account</p>;
  return <p>{`${user?.id ?? "signed-out"}:${roles.join(",")}`}</p>;
}

describe("useAuth", () => {
  beforeEach(() => {
    getSession.mockReset();
    from.mockReset();
  });

  it("shares session and role lookups between mounted consumers", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
    const roleQuery = Promise.resolve({ data: [{ role: "artisan" }], error: null });
    from.mockReturnValue({
      select: () => ({ eq: () => roleQuery }),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    render(
      <>
        <AuthSummary />
        <AuthSummary />
      </>,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getAllByText("user-1:artisan")).toHaveLength(2);
    });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });
});
