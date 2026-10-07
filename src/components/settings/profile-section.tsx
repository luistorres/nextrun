"use client";

import { useState } from "react";
import { useProfile, useUpdateProfile } from "@/lib/query/settings-hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

export function ProfileSection() {
  const { data, isLoading, error } = useProfile();
  const updateProfile = useUpdateProfile();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");

  const profile = data?.profile;

  const startEditing = () => {
    setName(profile?.name ?? "");
    setIsEditing(true);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    updateProfile.mutate(
      { name: name.trim() },
      {
        onSuccess: () => setIsEditing(false),
      },
    );
  };

  const handleCancel = () => {
    setIsEditing(false);
    updateProfile.reset();
  };

  if (isLoading) {
    return <div className="skeleton h-40 rounded-md" />;
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-ink">Profile</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          Your display name and email
        </p>
      </CardHeader>

      <CardContent>
        {error && (
          <div className="rounded-md bg-red-soft px-3 py-2">
            <p className="text-sm text-pencil-red-deep">
              Failed to load profile. Reload the page to try again.
            </p>
          </div>
        )}

        {profile && (
          <div className="divide-y divide-rule">
            <div className="pb-4">
              <p className="mb-1.5 text-sm text-ink-faint">Display name</p>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                      maxLength={100}
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={updateProfile.isPending}
                    onClick={handleSave}
                    disabled={!name.trim()}
                  >
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={updateProfile.isPending}
                    onClick={handleCancel}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-ink">
                    {profile.name ?? "Not set"}
                  </p>
                  <Button variant="ghost" size="sm" onClick={startEditing}>
                    Edit
                  </Button>
                </div>
              )}
              {updateProfile.isError && (
                <p className="mt-1 text-sm text-pencil-red-deep">
                  {updateProfile.error.message}
                </p>
              )}
            </div>

            <div className="pt-4">
              <p className="mb-1.5 text-sm text-ink-faint">Email</p>
              <p className="text-sm text-ink-soft">
                {profile.email ?? "No email"}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
