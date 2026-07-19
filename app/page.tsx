import type { Metadata } from "next";
import PhaseZeroShell from "./phase-zero/PhaseZeroShell";

export const metadata: Metadata = {
  title: "Combat Slice | Aurelia Falling",
  description:
    "Command a Meridian Coalition strike group in a deterministic Golden Scar combat exercise.",
};

export default function Page() {
  return <PhaseZeroShell />;
}
