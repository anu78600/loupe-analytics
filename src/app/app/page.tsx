/**
 * Workspace route ("/app"): the client-side analysis app. The page itself is a
 * server component that only hands the current version to the client shell.
 */
import type { Metadata } from "next";
import { CURRENT_VERSION } from "@/content/changelog";
import { Workspace } from "@/ui/workspace/Workspace";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Upload a clean table and get an analyst-grade dashboard. Everything runs in your browser.",
};

export default function WorkspacePage() {
  return <Workspace version={CURRENT_VERSION} />;
}
