import { AuditLogModel } from '../../models/auditLog.model.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const getAuditLogs = async (query: Record<string, string>) => {
    const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));

    const filter: Record<string, unknown> = {};

    if (query.action) filter.action = query.action;
    if (query.targetType) filter.targetType = query.targetType;
    if (query.actor) filter.actor = query.actor;

    if (query.from || query.to) {
        filter.createdAt = {} as Record<string, Date>;
        if (query.from) (filter.createdAt as Record<string, Date>).$gte = new Date(query.from);
        if (query.to) (filter.createdAt as Record<string, Date>).$lte = new Date(query.to);
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
