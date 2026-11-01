import mongoose from 'mongoose';
import { AuditLogModel } from '../../models/auditLog.model.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

// Query allowlist: arbitrary keys (and $-operators, depending on the query
// parser) must never reach the Mongo filter.
const ALLOWED_STRING_FILTERS = ['action', 'targetType'] as const;

const toValidDate = (value?: string): Date | undefined => {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
};

const getAuditLogs = async (query: Record<string, string>) => {
    const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));

    const filter: Record<string, unknown> = {};

    for (const key of ALLOWED_STRING_FILTERS) {
        if (query[key]) filter[key] = query[key];
    }
    if (query.actor && mongoose.Types.ObjectId.isValid(query.actor)) {
        filter.actor = new mongoose.Types.ObjectId(query.actor);
    }

    const from = toValidDate(query.from);
    const to = toValidDate(query.to);
    if (from || to) {
        filter.createdAt = {} as Record<string, Date>;
        if (from) (filter.createdAt as Record<string, Date>).$gte = from;
        if (to) (filter.createdAt as Record<string, Date>).$lte = to;
    }

    const [items, total] = await Promise.all([
        AuditLogModel.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .populate('actor', 'name email role')
            .lean(),
        AuditLogModel.countDocuments(filter),
    ]);

    return {
        items,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};

export const AuditLogService = {
    getAuditLogs,
};
