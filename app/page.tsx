import type { Metadata } from "next";
import PhaseZeroShell from "./phase-zero/PhaseZeroShell";

export const metadata: Metadata = {
  title: "Movement Sandbox",
  description:
    "Command Meridian Coalition formations across the deterministic Golden Scar movement sandbox.",
};

export default function Page() {
  return <PhaseZeroShell />;
}
