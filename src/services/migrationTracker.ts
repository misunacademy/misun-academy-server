import { Schema, model } from 'mongoose';

export interface IMigration {
    migrationId: string;
    appliedAt: Date;
    checksum?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

const migrationSchema = new Schema<IMigration>(
    {
        migrationId: { type: String, required: true, unique: true },
        appliedAt: { type: Date, required: true, default: Date.now },
        checksum: { type: String },
    },
    { timestamps: true }
);

migrationSchema.index({ appliedAt: -1 });

export const MigrationModel = model<IMigration>('Migration', migrationSchema);

/**
 * Tracks applied migrations to prevent re-application.
 * Idempotent: recording the same migration twice is a no-op.
 */
export class MigrationTracker {
    async recordMigration(migrationId: string, checksum?: string) {
        const existing = await MigrationModel.findOne({ migrationId }).lean();
        if (existing) {
            return { applied: false, skipped: true, migrationId };
        }

        await MigrationModel.create({
            migrationId,
            appliedAt: new Date(),
            checksum,
        });

        return { applied: true, skipped: false, migrationId };
    }

    async getAppliedMigrations() {
        return MigrationModel.find().sort({ appliedAt: 1 }).lean();
    }

    async getPendingMigrations(allMigrationIds: string[]) {
        const applied = await MigrationModel.find().distinct('migrationId').lean();
        const appliedSet = new Set(applied);
        return allMigrationIds.filter(id => !appliedSet.has(id));
    }

    async isMigrationApplied(migrationId: string) {
        const existing = await MigrationModel.findOne({ migrationId }).lean();
        return !!existing;
    }
}

export const migrationTracker = new MigrationTracker();
