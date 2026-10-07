"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

export function DangerZone() {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-pencil-red-deep">
          Danger zone
        </h2>
        <p className="mt-0.5 text-sm text-ink-soft">Irreversible actions</p>
      </CardHeader>

      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">Delete account</p>
            <p className="text-sm text-ink-soft">
              Permanently removes your account, training plans, and all data
            </p>
          </div>

          {!showConfirm ? (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="shrink-0 text-sm font-medium text-pencil-red-deep transition-colors duration-150 hover:underline"
            >
              Delete account
            </button>
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-sm text-ink-soft">Not available yet</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
