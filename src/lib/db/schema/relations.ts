import { relations } from "drizzle-orm";
import { users, userPreferences } from "./auth";
import { garminConnections } from "./garmin";
import {
  dailySummaries,
  sleepRecords,
  hrvRecords,
  stressRecords,
} from "./health";
import { activities, activityLaps } from "./activities";
import { shoes } from "./gear";
import {
  userGoals,
  trainingPlans,
  plannedWorkouts,
  adaptations,
  athleteResponsePatterns,
  workoutFeedback,
  coachMessages,
} from "./training";

// ─── User Relations ─────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  garminConnection: one(garminConnections, {
    fields: [users.id],
    references: [garminConnections.userId],
  }),
  preferences: one(userPreferences, {
    fields: [users.id],
    references: [userPreferences.userId],
  }),
  dailySummaries: many(dailySummaries),
  sleepRecords: many(sleepRecords),
  hrvRecords: many(hrvRecords),
  stressRecords: many(stressRecords),
  activities: many(activities),
  shoes: many(shoes),
  goals: many(userGoals),
  trainingPlans: many(trainingPlans),
  responsePatterns: one(athleteResponsePatterns, {
    fields: [users.id],
    references: [athleteResponsePatterns.userId],
  }),
  feedback: many(workoutFeedback),
  coachMessages: many(coachMessages),
}));

// ─── Garmin Connection Relations ────────────────────────────────────────────

export const garminConnectionsRelations = relations(
  garminConnections,
  ({ one }) => ({
    user: one(users, {
      fields: [garminConnections.userId],
      references: [users.id],
    }),
  })
);

// ─── Health Relations ───────────────────────────────────────────────────────

export const dailySummariesRelations = relations(dailySummaries, ({ one }) => ({
  user: one(users, {
    fields: [dailySummaries.userId],
    references: [users.id],
  }),
}));

export const sleepRecordsRelations = relations(sleepRecords, ({ one }) => ({
  user: one(users, {
    fields: [sleepRecords.userId],
    references: [users.id],
  }),
}));

export const hrvRecordsRelations = relations(hrvRecords, ({ one }) => ({
  user: one(users, {
    fields: [hrvRecords.userId],
    references: [users.id],
  }),
}));

export const stressRecordsRelations = relations(stressRecords, ({ one }) => ({
  user: one(users, {
    fields: [stressRecords.userId],
    references: [users.id],
  }),
}));

// ─── Activity Relations ─────────────────────────────────────────────────────

export const activitiesRelations = relations(activities, ({ one, many }) => ({
  user: one(users, {
    fields: [activities.userId],
    references: [users.id],
  }),
  plannedWorkout: one(plannedWorkouts, {
    fields: [activities.plannedWorkoutId],
    references: [plannedWorkouts.id],
  }),
  shoe: one(shoes, {
    fields: [activities.shoeId],
    references: [shoes.id],
  }),
  laps: many(activityLaps),
}));

export const activityLapsRelations = relations(activityLaps, ({ one }) => ({
  activity: one(activities, {
    fields: [activityLaps.activityId],
    references: [activities.id],
  }),
}));

// ─── Shoe Relations ─────────────────────────────────────────────────────────

export const shoesRelations = relations(shoes, ({ one, many }) => ({
  user: one(users, {
    fields: [shoes.userId],
    references: [users.id],
  }),
  activities: many(activities),
}));

// ─── Training Relations ─────────────────────────────────────────────────────

export const userGoalsRelations = relations(userGoals, ({ one, many }) => ({
  user: one(users, {
    fields: [userGoals.userId],
    references: [users.id],
  }),
  trainingPlans: many(trainingPlans),
}));

export const trainingPlansRelations = relations(
  trainingPlans,
  ({ one, many }) => ({
    user: one(users, {
      fields: [trainingPlans.userId],
      references: [users.id],
    }),
    goal: one(userGoals, {
      fields: [trainingPlans.goalId],
      references: [userGoals.id],
    }),
    workouts: many(plannedWorkouts),
    adaptations: many(adaptations),
  })
);

export const plannedWorkoutsRelations = relations(
  plannedWorkouts,
  ({ one, many }) => ({
    plan: one(trainingPlans, {
      fields: [plannedWorkouts.planId],
      references: [trainingPlans.id],
    }),
    completedActivity: one(activities, {
      fields: [plannedWorkouts.completedActivityId],
      references: [activities.id],
    }),
    /** All activities linked via plannedWorkoutId (primary + secondary) */
    linkedActivities: many(activities),
    feedback: many(workoutFeedback),
  })
);

export const adaptationsRelations = relations(adaptations, ({ one }) => ({
  plan: one(trainingPlans, {
    fields: [adaptations.planId],
    references: [trainingPlans.id],
  }),
}));

export const athleteResponsePatternsRelations = relations(
  athleteResponsePatterns,
  ({ one }) => ({
    user: one(users, {
      fields: [athleteResponsePatterns.userId],
      references: [users.id],
    }),
  })
);

// ─── Workout Feedback Relations ────────────────────────────────────────────

export const workoutFeedbackRelations = relations(
  workoutFeedback,
  ({ one }) => ({
    user: one(users, {
      fields: [workoutFeedback.userId],
      references: [users.id],
    }),
    plannedWorkout: one(plannedWorkouts, {
      fields: [workoutFeedback.plannedWorkoutId],
      references: [plannedWorkouts.id],
    }),
  })
);

// ─── User Preferences Relations ────────────────────────────────────────────

export const userPreferencesRelations = relations(
  userPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [userPreferences.userId],
      references: [users.id],
    }),
  })
);

// ─── Coach Message Relations ───────────────────────────────────────────────

export const coachMessagesRelations = relations(coachMessages, ({ one }) => ({
  user: one(users, {
    fields: [coachMessages.userId],
    references: [users.id],
  }),
}));
