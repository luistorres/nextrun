"use client";

import { useState } from "react";
import {
  useShoes,
  useCreateShoe,
  useUpdateShoe,
  useDeleteShoe,
  SHOE_CATEGORY_LABELS,
  type Shoe,
  type ShoeCategory,
} from "@/lib/query/shoe-hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

// 500–800 km replacement guidance is a convention, not science
const REPLACE_WARN_KM = 500;
const REPLACE_STRONG_KM = 800;

function mileageColor(totalKm: number): string | null {
  if (totalKm >= REPLACE_STRONG_KM) return "var(--pencil-red-deep)";
  if (totalKm >= REPLACE_WARN_KM) return "var(--amber-pencil)";
  return null;
}

function replacementNote(totalKm: number): string | null {
  if (totalKm >= REPLACE_STRONG_KM) {
    return "Past the typical 500–800 km replacement range — many runners would have swapped this pair by now. Worth checking how it feels.";
  }
  if (totalKm >= REPLACE_WARN_KM) {
    return "Approaching the typical 500–800 km replacement range — a convention rather than a hard rule.";
  }
  return null;
}

const CATEGORY_OPTIONS = (
  Object.entries(SHOE_CATEGORY_LABELS) as [ShoeCategory, string][]
).map(([value, label]) => ({ value, label }));

export function ShoesSection() {
  const { data, isLoading, error } = useShoes();
  const updateShoe = useUpdateShoe();
  const deleteShoe = useDeleteShoe();

  const [showForm, setShowForm] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const [retireTarget, setRetireTarget] = useState<Shoe | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Shoe | null>(null);

  if (isLoading) {
    return <div className="skeleton h-40 rounded-md" />;
  }

  const shoes = data?.shoes ?? [];
  const coverage = data?.coverage;
  const activeShoes = shoes.filter((s) => !s.retiredAt);
  const retiredShoes = shoes.filter((s) => s.retiredAt);

  const totalRecentKm = activeShoes.reduce((sum, s) => sum + s.recentKm, 0);
  const busySuperShoe = activeShoes.find(
    (s) =>
      s.category === "super_shoe" &&
      totalRecentKm > 0 &&
      s.recentRunCount >= 3 &&
      s.recentKm / totalRecentKm > 0.5,
  );

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Shoes</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            Garmin doesn&apos;t share gear data, so runs are assigned to shoes
            manually from your activity feed
          </p>
        </div>
        {!showForm && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowForm(true)}
            className="shrink-0 whitespace-nowrap"
          >
            Add shoe
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {error && (
          <div className="rounded-md bg-red-soft px-3 py-2">
            <p className="text-sm text-pencil-red-deep">
              Failed to load shoes. Reload the page to try again.
            </p>
          </div>
        )}

        {!error &&
          coverage &&
          activeShoes.length > 0 &&
          coverage.totalRuns > 0 && (
            <p className="mb-3 text-sm text-ink-soft">
              {coverage.assignedRuns} of {coverage.totalRuns} runs in the last{" "}
              {coverage.windowDays} days have a shoe assigned
              {coverage.assignedRuns < coverage.totalRuns &&
                " — assign the rest to keep mileage counts honest"}
              .
            </p>
          )}

        {showForm && <AddShoeForm onClose={() => setShowForm(false)} />}

        {!error && activeShoes.length === 0 && !showForm && (
          <div className="py-2">
            <div className="h-8 border-b border-rule" />
            <div className="flex h-8 items-center border-b border-rule">
              <p className="text-sm text-ink-faint">
                No shoes on record. Add your pairs to track mileage and get
                replacement guidance.
              </p>
            </div>
            <div className="h-8 border-b border-rule" />
          </div>
        )}

        {activeShoes.length > 0 && (
          <div className="divide-y divide-rule">
            {activeShoes.map((shoe) => (
              <ShoeRow
                key={shoe.id}
                shoe={shoe}
                onRetire={() => setRetireTarget(shoe)}
                onDelete={() => setDeleteTarget(shoe)}
              />
            ))}
          </div>
        )}

        {activeShoes.length >= 2 && (coverage?.totalRuns ?? 0) > 0 && (
          <p className="mt-3 text-sm text-ink-soft">
            In observational research, runners who rotate multiple pairs show
            ~39% lower injury hazard. An association, not proven cause — but
            mixing pairs is a reasonable habit.
          </p>
        )}

        {busySuperShoe && (
          <p className="mt-2 text-sm text-amber-pencil">
            {busySuperShoe.name} is carrying{" "}
            {Math.round((busySuperShoe.recentKm / totalRecentKm) * 100)}% of
            your recent mileage. Super shoes are usually saved for races and
            the occasional key session, with roughly 80% of volume in daily
            trainers.
          </p>
        )}

        {retiredShoes.length > 0 && (
          <div className="mt-4 border-t border-rule pt-3">
            <button
              type="button"
              onClick={() => setShowRetired(!showRetired)}
              className="flex items-center gap-1.5 text-sm font-medium text-ink-soft transition-colors duration-150 hover:text-ink"
            >
              <svg
                className="h-3 w-3 transition-transform duration-150"
                style={{ transform: showRetired ? "rotate(90deg)" : undefined }}
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4.5 3l3 3-3 3" />
              </svg>
              Retired shoes ({retiredShoes.length})
            </button>

            {showRetired && (
              <div className="mt-2 divide-y divide-rule">
                {retiredShoes.map((shoe) => (
                  <div
                    key={shoe.id}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-soft">
                        {shoe.name}
                      </p>
                      <p className="text-sm text-ink-faint">
                        {Math.round(shoe.totalKm)} km ·{" "}
                        {SHOE_CATEGORY_LABELS[shoe.category]}
                        {shoe.retiredAt &&
                          ` · retired ${new Date(shoe.retiredAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={updateShoe.isPending}
                        onClick={() =>
                          updateShoe.mutate({ id: shoe.id, retired: false })
                        }
                      >
                        Reactivate
                      </Button>
                      {shoe.activityCount === 0 && (
                        <button
                          type="button"
                          disabled={deleteShoe.isPending}
                          onClick={() => setDeleteTarget(shoe)}
                          className="px-3 py-1.5 text-sm font-medium text-pencil-red-deep transition-colors duration-150 hover:underline disabled:opacity-50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {(updateShoe.isError || deleteShoe.isError) && (
          <div className="mt-3 rounded-md bg-red-soft px-3 py-2">
            <p className="text-sm text-pencil-red-deep">
              {(updateShoe.error ?? deleteShoe.error)?.message ??
                "Something went wrong. Try again."}
            </p>
          </div>
        )}

        <ConfirmDialog
          open={retireTarget !== null}
          onOpenChange={(open) => !open && setRetireTarget(null)}
          title="Retire shoe?"
          description={`${retireTarget?.name ?? "This shoe"} will be moved to your retired list. Its mileage and run history are kept, and you can reactivate it anytime.`}
          confirmLabel="Retire"
          onConfirm={() => {
            if (retireTarget) {
              updateShoe.mutate({ id: retireTarget.id, retired: true });
            }
          }}
        />

        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title="Delete shoe?"
          description={`${deleteTarget?.name ?? "This shoe"} will be permanently removed. This only works for shoes with no runs assigned.`}
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={() => {
            if (deleteTarget) {
              deleteShoe.mutate(deleteTarget.id);
            }
          }}
        />
      </CardContent>
    </Card>
  );
}

function ShoeRow({
  shoe,
  onRetire,
  onDelete,
}: {
  shoe: Shoe;
  onRetire: () => void;
  onDelete: () => void;
}) {
  const color = mileageColor(shoe.totalKm);
  const note = replacementNote(shoe.totalKm);
  const barPct = Math.min((shoe.totalKm / REPLACE_STRONG_KM) * 100, 100);

  const brandModel = [shoe.brand, shoe.model].filter(Boolean).join(" ");

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-semibold text-ink">
            {shoe.name}
          </span>
          <span className="shrink-0 text-xs uppercase tracking-wide text-ink-faint">
            {SHOE_CATEGORY_LABELS[shoe.category]}
          </span>
          {brandModel && (
            <span className="truncate text-sm text-ink-soft">{brandModel}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {shoe.activityCount === 0 && (
            <button
              type="button"
              onClick={onDelete}
              className="px-3 py-1.5 text-sm font-medium text-pencil-red-deep transition-colors duration-150 hover:underline"
            >
              Delete
            </button>
          )}
          <Button variant="ghost" size="sm" onClick={onRetire}>
            Retire
          </Button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="relative h-1.5 rounded-full bg-paper-shade">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: `${barPct}%`,
                background: color ?? "var(--rule-strong)",
              }}
            />
            <span
              aria-hidden="true"
              className="absolute -bottom-0.5 -top-0.5 w-px bg-rule-strong"
              style={{
                left: `${(REPLACE_WARN_KM / REPLACE_STRONG_KM) * 100}%`,
              }}
            />
          </div>
          <div
            className="relative mt-1 h-3 font-mono text-[10px] tabular-nums text-ink-faint"
            aria-hidden="true"
          >
            <span className="absolute left-0">0</span>
            <span
              className="absolute -translate-x-1/2"
              style={{
                left: `${(REPLACE_WARN_KM / REPLACE_STRONG_KM) * 100}%`,
              }}
            >
              500
            </span>
            <span className="absolute right-0">800 km</span>
          </div>
        </div>
        <span
          className="shrink-0 font-mono text-sm font-semibold tabular-nums"
          style={{ color: color ?? "var(--ink)" }}
        >
          {Math.round(shoe.totalKm)} km
        </span>
      </div>

      <p className="mt-1.5 text-sm text-ink-soft">
        {shoe.activityCount} {shoe.activityCount === 1 ? "run" : "runs"} logged
        {shoe.startingKm > 0 &&
          ` (+${Math.round(shoe.startingKm)} km before tracking)`}
        {shoe.lastUsedAt && ` · last used ${formatRelativeDay(shoe.lastUsedAt)}`}
      </p>

      {note && (
        <p className="mt-1 text-sm" style={{ color: color ?? undefined }}>
          {note}
        </p>
      )}
    </div>
  );
}

function AddShoeForm({ onClose }: { onClose: () => void }) {
  const createShoe = useCreateShoe();
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [category, setCategory] = useState<ShoeCategory>("daily_trainer");
  const [startingKm, setStartingKm] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const km = startingKm === "" ? 0 : Number(startingKm);
    createShoe.mutate(
      {
        name: name.trim(),
        brand: brand.trim() || undefined,
        model: model.trim() || undefined,
        category,
        startingKm: Number.isFinite(km) && km >= 0 ? km : 0,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 space-y-3 border-b border-rule pb-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Name"
          placeholder="e.g. Pegasus 41"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
        />
        <Select
          label="Category"
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(e) => setCategory(e.target.value as ShoeCategory)}
        />
        <Input
          label="Brand (optional)"
          placeholder="e.g. Nike"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          maxLength={100}
        />
        <Input
          label="Model (optional)"
          placeholder="e.g. Air Zoom Pegasus 41"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          maxLength={100}
        />
        <Input
          label="Starting km (optional)"
          type="number"
          min={0}
          max={5000}
          step="1"
          placeholder="0"
          value={startingKm}
          onChange={(e) => setStartingKm(e.target.value)}
          helperText="Mileage already on the shoe before tracking here"
        />
      </div>

      {createShoe.isError && (
        <div className="rounded-md bg-red-soft px-3 py-2">
          <p className="text-sm text-pencil-red-deep">
            {createShoe.error?.message ?? "Failed to add shoe. Try again."}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={createShoe.isPending}
          disabled={!name.trim()}
        >
          Add shoe
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={createShoe.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function formatRelativeDay(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);

  const diff = Math.floor((today.getTime() - day.getTime()) / 86_400_000);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `${diff} days ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
