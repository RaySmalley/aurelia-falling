import type { Metadata } from "next";
import PhaseZeroShell from "./phase-zero/PhaseZeroShell";

export const metadata: Metadata = {
  title: "Economy and Base Slice | Aurelia Falling",
  description:
    "Build a powered Meridian Coalition base, harvest Aurelite, and destroy the opposing Citadel.",
};

export default function Page() {
  return <PhaseZeroShell />;
}
