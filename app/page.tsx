import type { Metadata } from "next";
import PhaseZeroShell from "./phase-zero/PhaseZeroShell";

export const metadata: Metadata = {
  title: "Feature-Complete v1 | Aurelia Falling",
  description:
    "Build, fight, and deploy the Solar Spear against a rules-legal Normal AI.",
};

export default function Page() {
  return <PhaseZeroShell />;
}
