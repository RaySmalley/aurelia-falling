import type { Metadata } from "next";
import PhaseZeroShell from "./phase-zero/PhaseZeroShell";

export const metadata: Metadata = {
  title: "Complete Skirmish | Aurelia Falling",
  description:
    "Command the Meridian Coalition through fog of war against a rules-legal Normal AI.",
};

export default function Page() {
  return <PhaseZeroShell />;
}
