import type { Metadata } from "next";
import PhaseZeroShell from "./phase-zero/PhaseZeroShell";

export const metadata: Metadata = {
  title: "Phase 0",
  description: "A deterministic browser RTS framework spike.",
};

export default function Page() {
  return <PhaseZeroShell />;
}
