"use client";

import { useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { UploadModal } from "@/components/upload-modal";
import { CollectEvidenceModal } from "@/components/collect-evidence-modal";
import { logoutAdminAction } from "../actions";

export function SourcesShell({ children }: { children: React.ReactNode }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        onUploadClick={() => setUploadOpen(true)}
        onCollectEvidenceClick={() => setCollectOpen(true)}
      />
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <CollectEvidenceModal open={collectOpen} onClose={() => setCollectOpen(false)} />

      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <TopBar
          breadcrumb={
            <>
              <span className="text-on-surface font-semibold">Sources</span>
              <span className="text-outline-variant">·</span>
              <form action={logoutAdminAction} className="inline">
                <button
                  type="submit"
                  className="text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  Sign out
                </button>
              </form>
            </>
          }
        />
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-4xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
